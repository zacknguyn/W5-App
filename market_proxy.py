#!/usr/bin/env python3
"""
Laptop-side proxy server. Exposes vnstock price_board over HTTP for Lambda to call via ngrok.

Setup:
  pip install flask vnstock
  python3 market_proxy.py

Then in another terminal:
  ngrok http 5050

Copy the ngrok URL and set it on the Lambda:
  aws lambda update-function-configuration \
    --function-name MarketUpdater \
    --region us-west-2 \
    --environment "Variables={VNSTOCK_PROXY_URL=https://<ngrok-id>.ngrok-free.app/price-board,...}"
"""

from flask import Flask, request, jsonify
from vnstock import Trading
import os

app = Flask(__name__)
SOURCE = os.environ.get("VNSTOCK_SOURCE", "KBS")


@app.post("/price-board")
def price_board():
    symbols = request.json.get("symbols", [])
    if not symbols:
        return jsonify({"error": "symbols required"}), 400
    trading = Trading(source=SOURCE, symbol=symbols[0])
    board = trading.price_board(symbols_list=symbols)
    return jsonify(board.to_dict(orient="records"))


if __name__ == "__main__":
    app.run(port=5050)
