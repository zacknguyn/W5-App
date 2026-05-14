from __future__ import annotations

from datetime import datetime, timedelta, timezone
from threading import Lock
from time import monotonic
from typing import Any

from .config import (
    CACHE_TTL_SECONDS,
    COMPANY_METADATA_TTL_DAYS,
    VNSTOCK_API_KEY,
    VNSTOCK_SOURCE,
    load_monitored_symbols,
)
from .store import (
    add_snapshot,
    get_company_metadata,
    is_watched,
    record_anomalies,
    save_company_metadata,
)


class MarketProviderError(RuntimeError):
    pass


class VnstockMarketProvider:
    def __init__(self) -> None:
        self._cached_assets: list[dict[str, Any]] = []
        self._cached_at = 0.0
        self._refresh_lock = Lock()

    def get_assets(self, force_refresh: bool = False) -> list[dict[str, Any]]:
        if self._cache_is_fresh(force_refresh):
            return self._cached_assets

        with self._refresh_lock:
            if self._cache_is_fresh(force_refresh):
                return self._cached_assets

            try:
                assets = self._refresh_assets()
            except Exception as error:
                if self._cached_assets:
                    return self._cached_assets

                if isinstance(error, MarketProviderError):
                    raise
                raise MarketProviderError(str(error)) from error

            self._cached_assets = assets
            self._cached_at = monotonic()
            return assets

    def set_watch(self, ticker: str, watched: bool) -> dict[str, Any] | None:
        from .store import set_watched

        set_watched(ticker, watched)
        for asset in self.get_assets():
            if asset["ticker"] == ticker.upper():
                asset["watched"] = watched
                return asset
        return None

    def _cache_is_fresh(self, force_refresh: bool) -> bool:
        if (
            not force_refresh
            and self._cached_assets
            and monotonic() - self._cached_at < CACHE_TTL_SECONDS
        ):
            return True

        return False

    def _refresh_assets(self) -> list[dict[str, Any]]:
        symbols = load_monitored_symbols()
        if not symbols:
            raise MarketProviderError(
                "No monitored symbols configured. Set MONITORED_SYMBOLS or edit backend/config/monitored_symbols.txt."
            )

        board = self._fetch_price_board(symbols)
        assets = [self._row_to_asset(row) for row in board]
        self._enrich_and_rank_assets(assets)

        for asset in assets:
            history = add_snapshot(asset)
            asset["chart"] = history
            asset["trend"] = [point["price"] for point in history]
            asset["watched"] = is_watched(asset["ticker"])
            del asset["referencePrice"]
            del asset["volume"]

        return assets

    def _fetch_price_board(self, symbols: list[str]) -> list[dict[str, Any]]:
        try:
            import vnai
            from vnstock import Trading
        except ImportError as error:
            raise MarketProviderError(
                "vnstock is not installed. Run: pip install -r requirements.txt"
            ) from error

        if VNSTOCK_API_KEY:
            vnai.setup_api_key(VNSTOCK_API_KEY)

        trading = Trading(source=VNSTOCK_SOURCE, symbol=symbols[0])
        board = trading.price_board(symbols_list=symbols)
        if hasattr(board, "to_dict"):
            return board.to_dict(orient="records")

        raise MarketProviderError("vnstock returned an unsupported price_board result")

    def _row_to_asset(self, row: dict[str, Any]) -> dict[str, Any]:
        symbol = str(self._pick(row, "symbol", "listing_symbol")).upper()
        reference_price = self._number(
            self._pick(row, "reference_price", "ref_price", "listing_ref_price"),
            default=0,
        )
        price = self._number(
            self._pick(row, "close_price", "match_price", "match_match_price"),
            default=reference_price,
        )
        change_percent = self._number(
            self._pick(row, "percent_change", "change_percent"),
            default=((price - reference_price) / reference_price * 100) if reference_price else 0,
        )
        volume = self._number(
            self._pick(row, "total_trades", "total_volume", "match_match_vol"),
            default=0,
        )

        return {
            "ticker": symbol,
            "title": str(self._pick(row, "organ_name", "listing_organ_name", default=symbol)),
            "price": price,
            "changePercent": change_percent,
            "marketCap": "N/A",
            "peRatio": None,
            "rank": None,
            "watched": is_watched(symbol),
            "lastUpdated": datetime.now(timezone.utc).astimezone().isoformat(),
            "trend": [],
            "chart": [],
            "referencePrice": reference_price or price,
            "volume": volume,
        }

    def _enrich_and_rank_assets(self, assets: list[dict[str, Any]]) -> None:
        for asset in assets:
            metadata = self._get_or_fetch_company_metadata(asset["ticker"])
            outstanding_shares = metadata.get("outstandingShares") if metadata else None
            if metadata and metadata.get("companyName"):
                asset["title"] = metadata["companyName"]

            if outstanding_shares and asset["price"]:
                market_cap = asset["price"] * outstanding_shares
                asset["marketCap"] = self._format_vnd_market_cap(market_cap)
                asset["_marketCapValue"] = market_cap
            else:
                asset["_marketCapValue"] = 0

        ranked_assets = sorted(
            assets,
            key=lambda asset: asset.get("_marketCapValue", 0),
            reverse=True,
        )
        for index, asset in enumerate(ranked_assets, start=1):
            asset["rank"] = index if index <= 30 and asset.get("_marketCapValue", 0) > 0 else None

        assets.sort(key=lambda asset: asset["rank"] or 10_000)
        for asset in assets:
            del asset["_marketCapValue"]

    def _get_or_fetch_company_metadata(self, symbol: str) -> dict[str, Any] | None:
        metadata = get_company_metadata(symbol)
        if metadata and not self._metadata_is_stale(metadata):
            return metadata

        try:
            return self._fetch_company_metadata(symbol)
        except Exception:
            return metadata

    def _metadata_is_stale(self, metadata: dict[str, Any]) -> bool:
        updated_at = metadata.get("updatedAt")
        if not updated_at:
            return True

        try:
            updated = datetime.fromisoformat(str(updated_at))
        except ValueError:
            updated = datetime.strptime(str(updated_at), "%Y-%m-%d %H:%M:%S")
            updated = updated.replace(tzinfo=timezone.utc)

        if updated.tzinfo is None:
            updated = updated.replace(tzinfo=timezone.utc)

        return datetime.now(timezone.utc) - updated > timedelta(days=COMPANY_METADATA_TTL_DAYS)

    def _fetch_company_metadata(self, symbol: str) -> dict[str, Any] | None:
        try:
            import vnai
            from vnstock import Company
        except ImportError as error:
            raise MarketProviderError(
                "vnstock is not installed. Run: pip install -r requirements.txt"
            ) from error

        if VNSTOCK_API_KEY:
            vnai.setup_api_key(VNSTOCK_API_KEY)

        overview = Company(source=VNSTOCK_SOURCE, symbol=symbol).overview()
        if not hasattr(overview, "to_dict") or overview.empty:
            return None

        row = overview.to_dict(orient="records")[0]
        outstanding_shares = self._number(row.get("outstanding_shares"), default=0) or None
        company_name = self._pick(
            row,
            "short_name",
            "organ_name",
            "company_name",
            "symbol",
            default=symbol,
        )
        as_of_date = row.get("as_of_date")
        save_company_metadata(
            symbol,
            outstanding_shares,
            str(company_name) if company_name else symbol,
            str(as_of_date) if as_of_date else None,
        )
        return get_company_metadata(symbol)

    def _format_vnd_market_cap(self, value: float) -> str:
        if value >= 1_000_000_000_000:
            return f"VND {value / 1_000_000_000_000:.1f}T"
        if value >= 1_000_000_000:
            return f"VND {value / 1_000_000_000:.1f}B"
        return f"VND {value:,.0f}"

    def _pick(self, row: dict[str, Any], *keys: str, default: Any = None) -> Any:
        normalized = {self._normalize_key(key): value for key, value in row.items()}

        for key in keys:
            value = normalized.get(self._normalize_key(key))
            if value is not None:
                return value

        return default

    def _normalize_key(self, key: Any) -> str:
        if isinstance(key, tuple):
            return "_".join(str(part) for part in key).lower()
        return str(key).lower()

    def _number(self, value: Any, default: float) -> float:
        try:
            if value != value:
                return default
            return float(value)
        except (TypeError, ValueError):
            return default


market_provider = VnstockMarketProvider()
