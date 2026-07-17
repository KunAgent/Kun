# Common Mistakes and Correct Patterns — Index

Read `reference/pitfalls/pandas.md` before writing code. After the code is written, run the checklist below.

## Self-Check Checklist (5 Critical Checks)

Every item includes a concrete verification method. **You must actually execute the check; do not just tell yourself "I checked it."**

```python
"""
[ ] 1. Query alignment: compare the code line by line with the user's original request.
       Check whether buy/sell conditions, position sizing, stop-loss / take-profit,
       execution timing, and stock universe all match the request. Any parameter
       that the user did not explicitly specify but the code had to choose anyway
       must be explained in the final reply.

[ ] 2. No future data: grep the code for every `shift(-` and `iloc[i+` pattern.
       Any hit is a look-ahead bug. This includes signal generation, size
       calculation, stop prices, and take-profit prices — not just the signal lines.

[ ] 3. size > 0: grep all order-placement logic. Every such block must be guarded
       by `if size > 0:` immediately above it; otherwise, high-priced stocks +
       small capital will silently produce size=0 and no trade.

[ ] 4. Warmup segment is correct (mandatory for indicator strategies; all three together):
       (a) Data-loading start < evaluation start — grep the data-source call and
           confirm the start date is moved earlier (MA120 ≈ 180 days,
           EMA200 ≈ 300 days)
       (b) Gate trading side effects before the evaluation start — grep the
           backtest loop and confirm:
           - Allowed: indicators, streak counters, `highest_since_entry`,
             state-machine counters
           - Forbidden: `pending_buy/pending_sell`, cash/position changes,
             `trade_history.append(...)`, `equity_curve.append(...)`
           - `if pd.isna(...)` alone is not enough; the evaluation-start gate
             must still be explicit
       (c) export_results passes start/end — grep `export_results\(` and
           confirm both start and end are explicitly passed. If omitted,
           Sharpe / annualized return will be calculated over the full span,
           including warmup.

[ ] 5. Output language is consistent: dashboard, matplotlib chart titles,
       custom_html modules, and the final reply must all use the same language.
       A Chinese query must not produce English module titles, and an English
       query about Chinese stocks must still produce English output; showing the
       ticker code is the default safe choice.
"""
```
