# Special Rules for U.S. Stocks

The easiest mistakes in U.S. stock backtests are:
- incorrectly applying A-share T+1 rules
- mixing `Adj Close` with raw `OHLC`
- or silently ignoring short selling and premarket / after-hours semantics

## 1. Do Not Apply A-Share-Style T+1

- U.S. stocks do not use A-share-style T+1 by default
- Same-day round trips and short-then-cover sequences are allowed
- Only model cash-account settlement, settled funds, GFV, or PDT if the user explicitly asks for that realism

## 2. The Minimum Trading Unit Is Usually 1 Share

- Individual U.S. stocks and ETFs are typically bought from 1 share upward
- If the user does not explicitly ask for fractional shares, default to integer-share backtests

```python
size = int(cash / price)
if size > 0:
    # buy
```

## 3. Short Selling Is Allowed by Default, but Do Not Invent Borrow Realism

- Individual U.S. equities are shortable by default in the simplified model (mark short trades with `side="short"`)
- Do not automatically model:
  - borrow availability
  - borrow fee
  - SSR / uptick rule
  - hard-to-borrow restrictions

If the user explicitly asks for realistic borrow constraints, model them separately.

## 4. Default Trading Session = Regular U.S. Hours

- Regular session: 09:30 - 16:00 `America/New_York`
- Premarket / after-hours should only be included if the user explicitly mentions `extended hours`, `premarket`, or `after-hours`
- Minute-level data must have the correct timezone; do not treat Eastern timestamps as local time

## 5. Do Not Mix Raw `OHLC` and `Adj Close`

Common U.S. stock data behavior:

- `OHLC` is raw price
- `Adj Close` is adjusted for splits / dividends

Rules:

- The default for technical-indicator strategies is **fully adjustment-consistent OHLC**
- If the data source directly provides complete adjusted / forward-adjusted OHLC, it can be used; do not require an A-share-specific `qfq` field name in U.S. data
- If only `Adj Close` is adjusted while `OHLC` is raw, do not mix them directly
- If the strategy cares about total return, either use total-return-style prices or explicitly model dividend cash flow

## 6. Fees Can Be Low, but Friction Is Not Zero

- If the user did not specify a fee, `commission=0.0` is acceptable
- But for high-frequency, minute-level, or short-selling strategies, you should at least disclose unmodeled items such as:
  - spread
  - slippage
  - SEC / FINRA sell-side fees
  - borrow fee

## 7. Do Not Ignore Halts, LULD, and Low Liquidity Too Casually

Daily-bar backtests may ignore these in a simplified first pass, but if the strategy depends on:

- minute-level breakouts
- low-priced stocks / meme stocks / microcaps
- heavily intraday-sensitive execution

then do not assume every signal can be cleanly filled on the next bar.

## 8. Multi-Symbol and Suggested Defaults

Use a dict to manage multiple symbols:

```python
data_files = {
    "AAPL": "/path/to/apple_daily.csv",
    "MSFT": "/path/to/microsoft_daily.csv",
}
data = {symbol: pd.read_csv(file_path) for symbol, file_path in data_files.items()}
```

Suggested defaults:

```python
initial_cash = 100_000
commission = 0.0       # common zero-commission simplification
slippage = 0.0
lot_size = 1           # minimum 1 share
```
