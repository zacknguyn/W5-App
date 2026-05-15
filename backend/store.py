import json
import os
from datetime import datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

import boto3

from .config import DEFAULT_THRESHOLD_PERCENT, RECORD_ALERTS_AFTER_HOURS, VN30_SYMBOLS
from .db import connect, initialize_database

EFS_ROOT = os.environ.get("EFS_MOUNT_PATH", "/mnt/efs")
SNS_TOPIC_ARN = os.environ.get("SNS_TOPIC_ARN")

DEFAULT_SETTINGS: dict[str, Any] = {
    "thresholdPercent": DEFAULT_THRESHOLD_PERCENT,
    "emailEnabled": True,
    "smsEnabled": False,
}


def get_settings() -> dict[str, Any]:
    # In AWS, this would typically read from RDS
    try:
        with connect() as connection:
            rows = connection.execute("SELECT key, value FROM settings").fetchall()
    except Exception:
        return DEFAULT_SETTINGS

    values = DEFAULT_SETTINGS.copy()
    for row in rows:
        if row["key"] == "thresholdPercent":
            values[row["key"]] = float(row["value"])
        elif row["key"] in {"emailEnabled", "smsEnabled"}:
            values[row["key"]] = row["value"] == "1"

    return values


def set_settings(next_settings: dict[str, Any]) -> dict[str, Any]:
    values = {
        "thresholdPercent": str(float(next_settings["thresholdPercent"])),
        "emailEnabled": "1" if next_settings["emailEnabled"] else "0",
        "smsEnabled": "1" if next_settings["smsEnabled"] else "0",
    }

    with connect() as connection:
        connection.executemany(
            """
            INSERT INTO settings (key, value)
            VALUES (%s, %s)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            values.items(),
        )

    return get_settings()


def write_to_efs(assets: list[dict[str, Any]]) -> str:
    """Appends current market snapshot to date-based CSV in EFS."""
    import pandas as pd
    
    now = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))
    folder_path = os.path.join(EFS_ROOT, "history", now.strftime("%Y"), now.strftime("%m"))
    file_name = f"{now.strftime('%Y-%m-%d')}.csv"
    full_path = os.path.join(folder_path, file_name)

    os.makedirs(folder_path, exist_ok=True)
    
    df = pd.DataFrame(assets)
    df['capture_time'] = now.isoformat()
    
    header = not os.path.exists(full_path)
    df.to_csv(full_path, mode='a', index=False, header=header)
    return full_path


def publish_to_sns(anomaly: dict[str, Any]) -> None:
    """Publishes a detected anomaly to the SNS topic."""
    if not SNS_TOPIC_ARN:
        print(f"DEBUG: SNS_TOPIC_ARN not set. Would publish: {anomaly}")
        return

    sns = boto3.client('sns')
    priority = "high" if anomaly["ticker"] in VN30_SYMBOLS else "standard"
    
    sns.publish(
        TopicArn=SNS_TOPIC_ARN,
        Message=json.dumps(anomaly),
        MessageAttributes={
            'priority': {
                'DataType': 'String',
                'StringValue': priority
            }
        }
    )


def save_alert_to_db(alert: dict[str, Any]) -> dict[str, Any]:
    """Writes an alert received from SQS/SNS to the RDS alert_history table."""
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO alert_history (
              id, ticker, price_at_event, message, priority, created_at, read
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                alert["id"],
                alert["ticker"],
                alert["priceAtEvent"],
                alert["message"],
                alert["priority"],
                alert["createdAt"],
                0
            )
        )
    return alert


def is_watched(symbol: str) -> bool:
    with connect() as connection:
        row = connection.execute(
            "SELECT watched FROM watchlist WHERE ticker = %s",
            (symbol.upper(),),
        ).fetchone()

    return bool(row and row["watched"])


def set_watched(symbol: str, watched: bool) -> None:
    normalized = symbol.upper()

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO watchlist (ticker, watched, updated_at)
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT(ticker) DO UPDATE SET
              watched = excluded.watched,
              updated_at = CURRENT_TIMESTAMP
            """,
            (normalized, 1 if watched else 0),
        )


def add_snapshot(asset: dict[str, Any]) -> list[dict[str, Any]]:
    settings = get_settings()
    symbol = asset["ticker"]
    reference_price = asset["referencePrice"]
    threshold = settings["thresholdPercent"] / 100
    label = datetime.now(timezone.utc).astimezone().strftime("%H:%M")

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO asset_snapshots (
              ticker, label, price, threshold_high, threshold_low, volume
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                symbol,
                label,
                asset["price"],
                reference_price * (1 + threshold),
                reference_price * (1 - threshold),
                asset.get("volume") or 0,
            ),
        )
        rows = connection.execute(
            """
            SELECT label, price, threshold_high, threshold_low, volume
            FROM asset_snapshots
            WHERE ticker = %s
            ORDER BY id DESC
            LIMIT 7
            """,
            (symbol,),
        ).fetchall()

    return [
        {
            "label": row["label"],
            "price": row["price"],
            "thresholdHigh": row["threshold_high"],
            "thresholdLow": row["threshold_low"],
            "volume": row["volume"],
        }
        for row in reversed(rows)
    ]


def get_alerts() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT id, ticker, price_at_event, message, priority, created_at, read
            FROM alert_history
            ORDER BY created_at DESC
            LIMIT 100
            """
        ).fetchall()

    return [_alert_from_row(row) for row in rows]


def mark_alert_read(alert_id: str) -> dict[str, Any] | None:
    with connect() as connection:
        connection.execute(
            "UPDATE alert_history SET read = 1 WHERE id = %s",
            (alert_id,),
        )
        row = connection.execute(
            """
            SELECT id, ticker, price_at_event, message, priority, created_at, read
            FROM alert_history
            WHERE id = %s
            """,
            (alert_id,),
        ).fetchone()

    return _alert_from_row(row) if row else None


def record_anomalies(assets: list[dict[str, Any]], priority_symbols: set[str]) -> None:
    if not RECORD_ALERTS_AFTER_HOURS and not _is_vn_market_open():
        return

    settings = get_settings()
    threshold = settings["thresholdPercent"]
    trading_date = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).date().isoformat()
    rows: list[tuple[Any, ...]] = []

    for asset in assets:
        change_percent = abs(asset["changePercent"])
        if change_percent < threshold:
            continue

        direction = "up" if asset["changePercent"] >= 0 else "down"
        alert_id = f"{asset['ticker']}-{trading_date}-{threshold:g}-{direction}"
        rows.append(
            (
                alert_id,
                asset["ticker"],
                asset["price"],
                (
                    f"{asset['ticker']} moved {asset['changePercent']:.2f}% "
                    f"against the {threshold:g}% threshold."
                ),
                "high" if asset["ticker"] in priority_symbols else "standard",
                asset["lastUpdated"],
                0,
            )
        )

    if not rows:
        return

    with connect() as connection:
        connection.executemany(
            """
            INSERT OR IGNORE INTO alert_history (
              id, ticker, price_at_event, message, priority, created_at, read
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )


def get_company_metadata(symbol: str) -> dict[str, Any] | None:
    with connect() as connection:
        row = connection.execute(
            """
            SELECT ticker, outstanding_shares, company_name, as_of_date, updated_at
            FROM company_metadata
            WHERE ticker = %s
            """,
            (symbol.upper(),),
        ).fetchone()

    if not row:
        return None

    return {
        "ticker": row["ticker"],
        "outstandingShares": row["outstanding_shares"],
        "companyName": row["company_name"],
        "asOfDate": row["as_of_date"],
        "updatedAt": row["updated_at"],
    }


def save_company_metadata(
    symbol: str,
    outstanding_shares: float | None,
    company_name: str | None,
    as_of_date: str | None,
) -> None:
    with connect() as connection:
        connection.execute(
            """
            INSERT INTO company_metadata (
              ticker, outstanding_shares, company_name, as_of_date, updated_at
            )
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT(ticker) DO UPDATE SET
              outstanding_shares = excluded.outstanding_shares,
              company_name = excluded.company_name,
              as_of_date = excluded.as_of_date,
              updated_at = CURRENT_TIMESTAMP
            """,
            (symbol.upper(), outstanding_shares, company_name, as_of_date),
        )


def _alert_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "ticker": row["ticker"],
        "priceAtEvent": row["price_at_event"],
        "message": row["message"],
        "priority": row["priority"],
        "createdAt": row["created_at"],
        "read": bool(row["read"]),
    }


def _is_vn_market_open() -> bool:
    now = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))
    if now.weekday() >= 5:
        return False

    current_time = now.time()
    morning_open = time(9, 0) <= current_time <= time(11, 30)
    afternoon_open = time(13, 0) <= current_time <= time(15, 0)
    return morning_open or afternoon_open


initialize_database()
