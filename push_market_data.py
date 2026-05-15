#!/usr/bin/env python3
"""
Laptop-side cron script: fetches price board from KBS/VCI and POSTs to Lambda.
Run every minute during market hours (09:00-15:00 VN time).

Setup:
  pip install vnstock requests
  export MARKET_PUSH_URL=https://<api-id>.execute-api.us-west-2.amazonaws.com/Prod/market-push

Cron (every minute, Mon-Fri):
  * 9-14 * * 1-5 cd /path/to/Week5 && python3 push_market_data.py
"""

import os
import sys
import json
import requests
from vnstock import Trading
from backend.config import load_monitored_symbols, VNSTOCK_SOURCE

PUSH_URL = os.environ["MARKET_PUSH_URL"]
SYMBOLS = load_monitored_symbols()


def main():
    if not SYMBOLS:
        print("No monitored symbols configured.", file=sys.stderr)
        sys.exit(1)

    trading = Trading(source=VNSTOCK_SOURCE, symbol=SYMBOLS[0])
    board = trading.price_board(symbols_list=SYMBOLS)
    rows = board.to_dict(orient="records") if hasattr(board, "to_dict") else board

    resp = requests.post(PUSH_URL, json={"rows": rows}, timeout=15)
    resp.raise_for_status()
    print(json.dumps(resp.json()))


if __name__ == "__main__":
    main()
