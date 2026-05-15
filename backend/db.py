from __future__ import annotations

import os
import sqlite3
import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import boto3

from .config import SQLITE_DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  ticker TEXT PRIMARY KEY,
  watched INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alert_history (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  price_at_event REAL NOT NULL,
  message TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'standard')),
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  label TEXT NOT NULL,
  price REAL NOT NULL,
  threshold_high REAL NOT NULL,
  threshold_low REAL NOT NULL,
  volume REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_metadata (
  ticker TEXT PRIMARY KEY,
  outstanding_shares REAL,
  company_name TEXT,
  as_of_date TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alert_history_created_at
  ON alert_history(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_asset_snapshots_ticker_id
  ON asset_snapshots(ticker, id DESC);
"""


def initialize_database() -> None:
    if os.environ.get("DB_SECRET_ARN"):
        # For RDS, schema should be managed via external migrations.
        # But for this project, we assume the tables are created.
        return

    SQLITE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(SQLITE_DB_PATH) as connection:
        connection.executescript(f"PRAGMA journal_mode = WAL;\n{SCHEMA}")


@contextmanager
def connect() -> Iterator[Any]:
    db_secret_arn = os.environ.get("DB_SECRET_ARN")
    
    if db_secret_arn and db_secret_arn.startswith("arn:aws:secretsmanager"):
        # --- PRODUCTION: RDS (PostgreSQL) ---
        import psycopg2
        from psycopg2.extras import RealDictCursor
        
        secret = _get_db_secret(db_secret_arn)
        connection = psycopg2.connect(
            host=os.environ.get("DB_HOST", secret.get("host", "localhost")),
            port=int(os.environ.get("DB_PORT", secret.get("port", 5432))),
            dbname=os.environ.get("DB_NAME", secret.get("dbname", "postgres")),
            user=secret['username'],
            password=secret['password'],
            cursor_factory=RealDictCursor
        )
        try:
            yield _PsycopgCursorWrapper(connection.cursor())
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
    else:
        # --- DEVELOPMENT: SQLite ---
        initialize_database()
        connection = sqlite3.connect(SQLITE_DB_PATH)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()


class _PsycopgCursorWrapper:
    """Makes a psycopg2 cursor behave like a sqlite3 connection for store.py compatibility.
    sqlite3: connection.execute(sql, params).fetchone()
    psycopg2: cursor.execute(sql, params); cursor.fetchone()
    """
    def __init__(self, cursor: Any) -> None:
        self._cursor = cursor

    def execute(self, sql: str, params: tuple = ()) -> "_PsycopgCursorWrapper":
        self._cursor.execute(sql, params)
        return self

    def executemany(self, sql: str, params_seq: Any) -> "_PsycopgCursorWrapper":
        self._cursor.executemany(sql, params_seq)
        return self

    def fetchone(self) -> Any:
        row = self._cursor.fetchone()
        return dict(row) if row else None

    def fetchall(self) -> list[Any]:
        return [dict(r) for r in self._cursor.fetchall()]

    @property
    def lastrowid(self) -> Any:
        return self._cursor.lastrowid


def _get_db_secret(secret_arn: str) -> dict[str, Any]:
    client = boto3.client('secretsmanager')
    response = client.get_secret_value(SecretId=secret_arn)
    return json.loads(response['SecretString'])
