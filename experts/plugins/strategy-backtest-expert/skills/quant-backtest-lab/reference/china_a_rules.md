# Special Rules for A Shares

The A-share market is different from futures or crypto markets, and those differences must be reflected in code.

## 1. T+1

You cannot sell on the same day you buy. Selling is only allowed from the next day onward. Typical implementation: record `entry_bar` and check `current_bar > entry_bar` before selling.

## 2. Minimum Trading Unit

- A shares: 100 shares per lot; order size must be a multiple of 100
- Hong Kong stocks: board lot size differs by symbol; common values are 100 / 500 / 1000 / 2000
- ETFs: 100 units minimum, in multiples of 100

```python
size = int(cash / price)
size = (size // 100) * 100
```

## 3. Limit Up / Limit Down

- Main board: ±10%
- ChiNext / STAR: ±20%
- ST stocks: ±5%
- Beijing Stock Exchange: ±30%

You cannot buy at limit-up and cannot sell at limit-down. If the strategy is sensitive to execution details, add checks like:

```python
pct = (row['close'] - prev_close) / prev_close
if pct >= 0.099:   # limit up, cannot buy
    continue
if pct <= -0.099:  # limit down, cannot sell
    continue
```

Simple backtests may ignore this, but that choice must be disclosed in the final reply.

## 4. Fees

Standard A-share fee structure:
- Commission: about 2.5 to 3 bps each side (brokers often enforce a minimum charge)
- Stamp duty: 0.05% on sells only
- Transfer fee: 0.001% each side

A simplified setup may use a flat 3 bps (`0.0003`).
If a strategy parameter uses `sell_tax`, its default meaning is **A-share sell-side stamp duty**. Do not carry that default straight into U.S. or Hong Kong backtests: U.S. equities default to 0 here, and Hong Kong fees are not captured by a single A-share-style `sell_tax`.

## 5. Trading Hours

- Morning: 09:30 - 11:30
- Afternoon: 13:00 - 15:00

Daily-bar backtests usually do not need to model this explicitly.

## 6. Price Adjustment

- **Forward-adjusted (qfq)**: historical prices are adjusted relative to the latest price
- **Backward-adjusted (hfq)**: later prices are adjusted relative to the earliest price
- **Unadjusted**: raw prices

A backtest **must use either forward-adjusted or backward-adjusted prices**. Otherwise, ex-rights / ex-dividend days will create artificial gaps and distort technical indicators. The default for technical-indicator strategies is **forward-adjusted prices**. Only use backward-adjusted prices when the user explicitly asks for them. **Never use unadjusted prices for a technical-indicator backtest.**

⚠️ Data-source differences: different vendors can produce very different adjusted absolute price levels. Always inspect the actual price level before writing size logic, or `(size // 100) * 100 == 0` may silently prevent buying.

## 7. Delisting Risk

A shares have delisting rules. If you are using a historical universe, make sure delisted symbols still have complete historical data.

## 8. Short Selling Is Generally Not Allowed

Individual A-share stocks are generally not directly shortable (securities lending exists but is constrained and costly). **Any strategy that contains "open short", "short sell", or similar logic for individual A shares must be redesigned.**

Instruments that can support short exposure include:
- Index futures (IF, IC, IH)
- 50ETF / 300ETF options
- Eligible securities-lending symbols (limited)

In an A-share long-only backtest, the code should not produce any trade with `side="short"`. When calling `export_results(...)`, pass `market="china_a"` so the export step hard-fails if any `side="short"` trade is present before writing `trades.csv`.

## 9. Multi-Symbol Strategies

For multi-symbol strategies, manage data with a dict:

```python
data_files = {
    "600519.SH": "/path/to/maotai_daily.csv",
    "000858.SZ": "/path/to/wuliangye_daily.csv",
}
data = {}
for symbol, file_path in data_files.items():
    data[symbol] = pd.read_csv(file_path)
```

Do not assume the local filename must equal the ticker code; then process each symbol separately inside the backtest loop.

## 10. Suggested Default Parameters

```python
initial_cash = 1_000_000
commission = 0.0003    # 3 bps
slippage = 0.0
lot_size = 100         # 100 shares per lot
```
