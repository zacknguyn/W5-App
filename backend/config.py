from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def load_env_file(path: Path = ROOT_DIR / ".env") -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


load_env_file()

VN30_SYMBOLS_FILE = Path(
    os.environ.get("VN30_SYMBOLS_FILE", BASE_DIR / "config" / "vn30_symbols.txt")
)
MONITORED_SYMBOLS_FILE = Path(
    os.environ.get(
        "MONITORED_SYMBOLS_FILE", BASE_DIR / "config" / "monitored_symbols.txt"
    )
)
VNSTOCK_SOURCE = os.environ.get("VNSTOCK_SOURCE", "KBS")
VNSTOCK_API_KEY = os.environ.get("VNSTOCK_API_KEY")
CACHE_TTL_SECONDS = int(os.environ.get("MARKET_CACHE_TTL_SECONDS", "60"))
COMPANY_METADATA_TTL_DAYS = int(os.environ.get("COMPANY_METADATA_TTL_DAYS", "30"))
DEFAULT_THRESHOLD_PERCENT = float(os.environ.get("DEFAULT_THRESHOLD_PERCENT", "5"))
SQLITE_DB_PATH = Path(
    os.environ.get("SQLITE_DB_PATH", BASE_DIR / "data" / "market_monitor.sqlite3")
)
RECORD_ALERTS_AFTER_HOURS = os.environ.get("RECORD_ALERTS_AFTER_HOURS", "0") == "1"


def load_vn30_symbols() -> list[str]:
    env_symbols = os.environ.get("VN30_SYMBOLS")
    if env_symbols:
        return normalize_symbols(env_symbols.split(","))

    if not VN30_SYMBOLS_FILE.exists():
        return []

    lines = VN30_SYMBOLS_FILE.read_text(encoding="utf-8").splitlines()
    return normalize_symbols(line for line in lines if not line.strip().startswith("#"))


def load_vn30_rank_map() -> dict[str, int]:
    return {symbol: index + 1 for index, symbol in enumerate(load_vn30_symbols())}


def load_monitored_symbols() -> list[str]:
    env_symbols = os.environ.get("MONITORED_SYMBOLS")
    if env_symbols:
        return normalize_symbols(env_symbols.split(","))

    if MONITORED_SYMBOLS_FILE.exists():
        lines = MONITORED_SYMBOLS_FILE.read_text(encoding="utf-8").splitlines()
        symbols = normalize_symbols(
            line for line in lines if not line.strip().startswith("#")
        )
        if symbols:
            return symbols

    return load_vn30_symbols()


def normalize_symbols(symbols: list[str] | tuple[str, ...] | object) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for symbol in symbols:
        item = str(symbol).strip().upper()
        if not item or item in seen:
            continue
        seen.add(item)
        normalized.append(item)

    return normalized
