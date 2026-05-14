import os
import pandas as pd
from datetime import datetime
from zoneinfo import ZoneInfo

from .market_provider import MarketProviderError, market_provider
from .config import CACHE_TTL_SECONDS, VNSTOCK_SOURCE, load_monitored_symbols, load_vn30_symbols, VN30_SYMBOLS
from .store import (
    get_alerts as read_alerts,
    get_settings as read_settings,
    mark_alert_read as update_alert_read,
    set_settings,
    write_to_efs,
    publish_to_sns,
    save_alert_to_db,
    EFS_ROOT
)


JSON_HEADERS = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type",
}


def response(status_code: int, body: Any) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": JSON_HEADERS,
        "body": json.dumps(body),
    }


def read_json(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body")
    if not body:
        return {}
    if isinstance(body, dict):
        return body
    return json.loads(body)


# --- 1. MARKET UPDATER (1 MIN) ---

def market_updater_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Triggered every 1 min. Fetches prices and appends to EFS."""
    try:
        # Force refresh from external API
        assets = market_provider.get_assets(force_refresh=True)
        
        # 1. Store in RDS (indirectly via market_provider logic if it writes to DB)
        # Actually VnstockMarketProvider should be updated to write to RDS if needed.
        # 2. Append to EFS for the batch scanner
        path = write_to_efs(assets)
        
        return {"status": "success", "assets_count": len(assets), "efs_path": path}
    except Exception as e:
        print(f"Error in market_updater: {e}")
        return {"status": "error", "message": str(e)}


# --- 2. ANOMALY LOGGING SERVICE (BATCH) ---

def anomaly_logging_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Triggered at 11:30 and 15:00. Scans EFS CSV for breaches."""
    try:
        settings = read_settings()
        threshold = settings["thresholdPercent"]
        
        now = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))
        path = os.path.join(EFS_ROOT, "history", now.strftime("%Y"), now.strftime("%m"), f"{now.strftime('%Y-%m-%d')}.csv")
        
        if not os.path.exists(path):
            return {"status": "skipped", "reason": f"No data file at {path}"}
            
        df = pd.read_csv(path)
        anomalies_found = 0
        
        # Scan for threshold breaches per ticker
        # Note: In a real app, you'd compare current price vs open or previous close
        for ticker, group in df.groupby('ticker'):
            # Simple logic: compare max vs min of the session
            max_p = group['price'].max()
            min_p = group['price'].min()
            move = ((max_p - min_p) / min_p) * 100
            
            if move >= threshold:
                anomaly = {
                    "id": f"{ticker}-{now.date().isoformat()}-{direction_suffix(group)}",
                    "ticker": ticker,
                    "priceAtEvent": group['price'].iloc[-1],
                    "message": f"{ticker} move of {move:.2f}% detected in session scan.",
                    "priority": "high" if ticker in VN30_SYMBOLS else "standard",
                    "createdAt": now.isoformat()
                }
                publish_to_sns(anomaly)
                anomalies_found += 1
                
        return {"status": "success", "anomalies_found": anomalies_found}
    except Exception as e:
        # Pattern 3 deliverable: Failure here will be caught by DLQ if properly configured in template.yaml
        raise e 

def direction_suffix(group: pd.DataFrame) -> str:
    return "up" if group['price'].iloc[-1] >= group['price'].iloc[0] else "down"


# --- 3. DATA AGGREGATION WORKER (SQS CONSUMER) ---

def data_worker_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Triggered by SQS. Consumes anomaly and writes to RDS."""
    processed = 0
    for record in event.get("Records", []):
        try:
            # SNS message inside SQS body
            sns_msg = json.loads(record["body"])
            anomaly = json.loads(sns_msg["Message"])
            
            # Write to alert_history table
            save_alert_to_db(anomaly)
            processed += 1
        except Exception as e:
            print(f"Error processing SQS record: {e}")
            
    return {"status": "success", "processed": processed}


# --- 4. ASSET READER (API PROVIDER) ---

def asset_reader_handler(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    """Entry point for API Gateway. Routes to sub-handlers."""
    path = event.get("path", "")
    method = event.get("httpMethod", "GET")
    
    if method == "GET" and path == "/assets":
        return get_assets(event)
    elif method == "GET" and path == "/meta":
        return get_meta(event)
    elif method == "GET" and path == "/alerts":
        return get_alerts(event)
    elif method == "GET" and path == "/settings":
        return get_settings(event)
    elif method == "PUT" and path == "/settings":
        return save_settings(event)
    elif method == "OPTIONS":
        return options(event)
    
    return response(404, {"message": "Not found"})


# --- EXISTING SUB-HANDLERS (REUSED BY ASSET READER) ---

def get_assets(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    try:
        force_refresh = (event.get("queryStringParameters") or {}).get("refresh") == "1"
        return response(200, market_provider.get_assets(force_refresh=force_refresh))
    except MarketProviderError as error:
        return response(503, {"message": str(error)})


def get_meta(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    monitored_symbols = load_monitored_symbols()
    vn30_symbols = load_vn30_symbols()

    return response(
        200,
        {
            "monitoredCount": len(monitored_symbols),
            "vn30Count": len(vn30_symbols),
            "cacheTtlSeconds": CACHE_TTL_SECONDS,
            "source": VNSTOCK_SOURCE,
        },
    )


def get_alerts(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    return response(200, read_alerts())


def get_settings(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    return response(200, read_settings())


def update_asset_watch(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    ticker = (event.get("pathParameters") or {}).get("ticker")
    body = read_json(event)
    watched = body.get("watched")

    if not isinstance(watched, bool):
        return response(400, {"message": "watched must be a boolean"})

    asset = market_provider.set_watch(str(ticker), watched)
    if asset is None:
        return response(404, {"message": f"Unknown asset {ticker}"})

    return response(200, asset)


def mark_alert_read(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    alert_id = (event.get("pathParameters") or {}).get("id")
    alert = update_alert_read(str(alert_id))

    if alert is None:
        return response(404, {"message": f"Unknown alert {alert_id}"})

    return response(200, alert)


def save_settings(event: dict[str, Any], context: Any = None) -> dict[str, Any]:
    body = read_json(event)

    try:
        threshold_percent = float(body.get("thresholdPercent"))
    except (TypeError, ValueError):
        return response(400, {"message": "thresholdPercent must be between 1 and 50"})

    if threshold_percent < 1 or threshold_percent > 50:
        return response(400, {"message": "thresholdPercent must be between 1 and 50"})

    settings = set_settings(
        {
            "thresholdPercent": threshold_percent,
            "emailEnabled": bool(body.get("emailEnabled")),
            "smsEnabled": bool(body.get("smsEnabled")),
        }
    )

    return response(200, settings)


def options(event: dict[str, Any] | None = None, context: Any = None) -> dict[str, Any]:
    return {
        "statusCode": 204,
        "headers": JSON_HEADERS,
        "body": "",
    }
