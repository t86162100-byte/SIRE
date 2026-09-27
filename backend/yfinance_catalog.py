import json
import yfinance as yf

# yfinance exposes Yahoo Finance's predefined screeners. We use all available
# predefined screens and deduplicate the returned Yahoo symbols. Yahoo caps
# custom screen results at 250 per request; this is therefore a broad discovery
# catalogue, not a claim that Yahoo exposes every symbol through one endpoint.
names = list(getattr(yf, "PREDEFINED_SCREENER_QUERIES", {}).keys())
rows = {}
for name in names:
    try:
        payload = yf.screen(name, count=250)
        for q in payload.get("quotes", []) or []:
            symbol = str(q.get("symbol") or "").strip()
            if not symbol:
                continue
            quote_type = str(q.get("quoteType") or "").upper()
            category = {
                "EQUITY": "Stocks",
                "ETF": "ETFs",
                "MUTUALFUND": "Funds",
                "INDEX": "Indices",
                "CRYPTOCURRENCY": "Crypto",
                "CURRENCY": "Forex",
            }.get(quote_type, "Other")
            rows[symbol] = {
                "symbol": symbol,
                "name": str(q.get("longName") or q.get("shortName") or symbol),
                "category": category,
                "marketType": str(q.get("exchange") or q.get("fullExchangeName") or "Yahoo Finance"),
                "quote": str(q.get("currency") or "").strip(),
                "type": quote_type or category,
            }
    except Exception:
        continue

print(json.dumps(list(rows.values()), separators=(",", ":")))
