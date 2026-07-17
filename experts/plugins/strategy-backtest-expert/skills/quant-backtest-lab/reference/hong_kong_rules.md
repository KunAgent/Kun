# Special Rules for Hong Kong Stocks

The most common mistakes in Hong Kong stock backtests are:
- treating them like A shares with fixed 100-share lots and T+1
- or treating them like U.S. stocks with unrestricted shorting and a single commission line

## 1. Do Not Apply A-Share-Style T+1

- Hong Kong stocks can generally be round-tripped intraday; do not add an `entry_bar` restriction by default
- Exchange-level settlement is T+2
- A simplified backtest may allow same-day buy and sell without modeling cash lock-up until settlement

## 2. The Minimum Trading Unit Is the Symbol's Own `board lot`

- There is no universal lot size in Hong Kong stocks
- Common values are 100 / 500 / 1000 / 2000 shares, but you must not assume they are all the same
- If the data provides `board_lot`, round to that
- If it does not, do not hardcode 100 shares

```python
size = int(cash / price)
size = (size // lot_size) * lot_size
if size > 0:
    # buy
```

### Odd Lots

- Holdings smaller than one board lot are odd lots
- Odd-lot execution is not the same as normal round-lot matching
- If you ignore the odd-lot difference, say so in code comments or in the report

## 3. Do Not Assume Unlimited Short Selling

- Cash shorting in Hong Kong is not freely available by default the way many people think of U.S. equities
- Ordinary Hong Kong stock backtests should default to long-only
- Only implement short logic if the user explicitly asks for a Hong Kong short strategy
- Even then, do not automatically model:
  - designated securities validation
  - borrow availability / borrow fee
  - tick rule

### In Long-Only Scenarios, Do Not Produce `side="short"` Trades

The same principle applies as in A-share long-only backtests. Passing `export_results(market="china_a")` enforces it for A shares. **Hong Kong strategies do not currently have an equivalent export-layer hard-fail**, so if a Hong Kong strategy is meant to stay long-only, the backtest logic and self-check must ensure it never emits `side="short"` trades.

## 4. Trading Hours: Watch the Lunch Break and CAS

- Morning: 09:30 - 12:00
- Afternoon: 13:00 - 16:00
- CAS: 16:00 - 16:10 for eligible securities

Rules:

- Daily-bar backtests usually do not need separate CAS handling
- Minute-level backtests must account for the 12:00 - 13:00 lunch break
- If the data includes CAS, specify whether it is included in execution logic

## 5. Do Not Collapse Fees into "Commission Only"

Common Hong Kong trading costs include:

- Commission
- Stamp duty
- Trading levy / exchange fee
- Other settlement-related fees

Key points:

- Ordinary Hong Kong stock trades currently pay stamp duty on both buy and sell sides
- Do not blindly reuse ordinary-stock stamp-duty rules for ETFs and similar products

If the user did not specify an exact fee schedule, a simplified approximation is acceptable, but it must be disclosed as an approximation rather than a complete fee model.

## 6. Do Not Ignore Adjustments / Ex-Dividend Effects

- Hong Kong stocks also have splits, reverse splits, placements, rights issues, and dividends
- The default for technical-indicator strategies is **forward-adjusted prices**; if the data source does not explicitly expose a Hong Kong `qfq` concept, at minimum the full OHLC set must be adjusted consistently
- Do not mix raw OHLC with a separately adjusted close

## 7. Multi-Symbol, Multi-Currency, and Default Parameters

- Multi-symbol handling is the same as other markets: manage separate data feeds per symbol
- If the strategy crosses HKD / RMB / USD counters, make clear whether everything is converted into a single base currency
- Do not blindly apply ordinary-stock rules to ETFs, REITs, or leveraged / inverse products

Suggested defaults:

```python
initial_cash = 5_000_000
commission = 0.001     # adjust by user request or broker cost model
slippage = 0.0
# lot_size depends on the symbol; do not hardcode it
```
