# Common Mistakes in Pure-Python Backtesting

These are the easiest places to make mistakes when writing a backtest in pandas. Read this once at the start of every backtest task.

---

## Look-Ahead Bias

This is the most fatal bug in backtesting. Signal generation may only use the current bar and earlier data. Execution must use the next bar's price.

**Common wrong patterns**:

```python
# ❌ shift(-N) reads future data
df['signal'] = (df['close'].shift(-1) > df['close']).astype(int)

# ❌ using iloc[i+1] inside a for loop
for i in range(len(df)):
    if df.iloc[i+1]['open'] > df.iloc[i]['close']:  # tomorrow's open
        buy()

# ❌ buying at today's close (unknown at the open)
entry_price = df.iloc[i]['close']  # signal and fill happen on the same bar
```

**Verification**: grep for all `shift(-` and `iloc[i+` patterns. Any hit is a bug.

**Correct pattern**: signal on bar i -> execution at bar i+1 open.

```python
# ✅ signal uses current and historical data only
df['signal'] = ((df['ma5'] > df['ma10']) & (df['ma5'].shift(1) <= df['ma10'].shift(1))).astype(int)

# ✅ execution uses the next bar
if signal_yesterday:
    entry_price = today['open']  # next-day-open fill
```

---

## Golden Cross / Death Cross Are Point-in-Time Events, Not States

`df['ma5'] > df['ma10']` checks whether "MA5 is currently above MA10" (a bullish state), not whether a golden cross happened. A golden cross is the instant of moving from below to above:

```python
# ❌ state check: fires every day while MA5 stays above MA10
buy_signal = df['ma5'] > df['ma10']

# ✅ event check: fires only on the crossing day
buy_signal = (df['ma5'].shift(1) <= df['ma10'].shift(1)) & (df['ma5'] > df['ma10'])
```

---

## The 5 Complexities of Stop-Loss / Take-Profit

Do not think stop-loss / take-profit is just one `if` statement. On daily bars there are 5 issues that must be handled:

1. **Use `low/high`, not `close`**. If the bar's high touched +8% but the close came back to +3%, using `close` will miss the take-profit.
   ```python
   # ❌ misses intraday trigger
   if close <= entry_price * 0.95: sell()
   # ✅ use low to check whether the stop was touched intraday
   if low <= entry_price * 0.95: sell()
   ```

2. **Both stop-loss and take-profit can trigger on the same bar** (`low` breaks the stop while `high` also hits the take-profit). Daily bars do not tell you which happened first. Default to stop-loss priority, and disclose that in the assumptions.

3. **Gap-through**. Suppose the stop is 95, but the next day's open gaps directly to 90. The execution price should be 90 (or `open`), not 95.

4. **Trailing stop**. Track the highest price reached during the holding period and update the stop line. **You must update the highest price only after the stop check**, otherwise a new intraday high on the same bar lifts the stop first and causes a real stop trigger to be missed.

5. **Partial take-profit**. Example: sell half at +5% -> move stop to breakeven -> fully exit at +10%. This requires state flags to avoid double-triggering and requires tracking remaining position size.

---

## Trade Records Must Be Written After Execution, Not When the Signal Fires

```python
# ❌ Wrong: record the trade when the signal fires (uses signal date and close)
if sell_signal:
    trade_history.append({
        "exit_date": today,         # signal day, not execution day
        "exit_price": row['close'], # signal price, not execution price
    })
    pending_sell = True

# ✅ Correct: record when the pending signal is executed (uses execution date and open)
if pending_sell and position > 0:
    price = row['open']             # actual fill price
    trade_history.append({
        "exit_date": today,         # execution day (= signal day + 1)
        "exit_price": price,        # actual fill price
    })
```

If the signal happens on bar i and execution happens at bar i+1 open, then the trade date, execution price, and PnL **must all be based on the execution time**, not the signal time. Otherwise `exit_date` is one day too early and `exit_price` uses `close` instead of `open`, which breaks PnL.

---

## The Basis of Stop-Loss / Take-Profit

When the user says "lose 3%" or "gain 8%", the **basis is the entry price**, not the previous bar's close.

---

## R Multiples ≠ Percentages

If the strategy mentions 0.5R / 1R / 2R, then `R = |entry_price - stop_price|`, which is an absolute price difference, not a percentage.

---

## Position Sizing + `size > 0`

```python
size = int(cash * position_pct / price)
size = (size // 100) * 100   # A shares round to 100-share lots
if size > 0:                  # mandatory check
    # place order
```

If `size = 0` and you do not check it, the order silently does not execute and the backtest shows zero trades.

---

## Fee Calculation

Fees must be deducted separately on buy and sell. Do not ignore them. Use parameterization; do not hardcode rates for one market:

```python
def run(df, initial_cash, buy_commission=0.0003, sell_commission=0.0003,
        sell_tax=0.0005, lot_size=100, t_plus_1=True):
```

**At buy time**: actual cost = `size * price * (1 + buy_commission)`. Reserve commission when computing size:

```python
size = int(cash / (price * (1 + buy_commission)))
cash -= size * price * (1 + buy_commission)
```

**At sell time**: actual proceeds = `size * price * (1 - sell_commission - sell_tax)`:

```python
proceeds = position * price * (1 - sell_commission - sell_tax)
cash += proceeds
```

**PnL must be net of fees**:

```python
pnl = proceeds - position * entry_price * (1 + buy_commission)
```

Common pitfalls:
- **A-share stamp duty is sell-side only** -> `sell_tax=0.0005`; do not add it on the buy side
- **ETFs are exempt from stamp duty** -> pass `sell_tax=0`
- **U.S. zero-commission case** -> `buy_commission=0, sell_commission=0, sell_tax=0`
- **Minimum commission (e.g. 5 RMB)**: A-share brokers often have one. It is commonly ignored in backtests, but should be disclosed
- **Do not hardcode `* 0.0003`**: pass it as a parameter so the market can change

---

## Handling Open Positions at the End of the Backtest

If there is still an open position on the last bar, **you must handle it explicitly**. Three reasonable approaches:

1. **Forced close** (recommended): close at the final bar's `close`, record a trade, and deduct fees
   ```python
   # after the for loop
   if position > 0:
       price = df.iloc[-1]['close']
       proceeds = position * price * (1 - sell_commission - sell_tax)
       pnl = proceeds - position * entry_price * (1 + buy_commission)
       trade_history.append({...})
       cash += proceeds
       position = 0
   ```

2. **Exclude it from trade stats**: do not record a trade, but explicitly say "the last position remained open and was not included in closed-trade statistics"

3. **Mixed disclosure**: closed trades = N, win rate = X%; one open trade remains with floating PnL = Y%

**Forbidden behavior**: silently ignore it, so that total return in `equity_curve` includes unrealized PnL while `trades.csv` has no matching trade record.

Also note: if there is still a pending signal on the final bar with no next bar to execute it, that signal is dropped.

---

## Warmup Period (Mandatory for Indicator Strategies)

If the user says "Backtest the 2024 MA120 strategy", then `2024-01-01` is the **evaluation start**, not the **data-load start**. The first 119 rows of MA120 are NaN. If you load only from the evaluation start, the first four months will have no valid signal. You must load an earlier warmup segment.

### Three Typical Wrong Patterns

**Wrong pattern 1: no warmup segment is loaded at all**

```python
# ❌ start_date equals the evaluation start
df = load_data("600519.SH", start="2024-01-01", end="2024-12-31")
df["ma120"] = df["close"].rolling(120).mean()  # first 119 rows are NaN
```

**Wrong pattern 2: warmup is loaded, but the loop is not gated**

```python
# ❌ warmup bars still produce signals -> positions may open before the evaluation window
df = load_data("600519.SH", start="2023-07-01", end="2024-12-31")
df["ma120"] = df["close"].rolling(120).mean()
for i in range(len(df)):
    row = df.iloc[i]
    if pd.isna(row["ma120"]):    # only skips NaN, not the evaluation start
        continue
    # -> signals may appear in 2023-11 instead of starting at 2024-01-01
```

**Wrong pattern 3: gating is correct, but `start/end` are not passed into `export_results`**

```python
# ❌ summary is computed over the whole span (including warmup) -> wrong Sharpe / annualized return
export_results(equity_curve, trade_history, "ma120", initial_cash=1_000_000)
```

### Correct Pattern

Warmup gating should block **trading side effects**, not all state updates. Things like "N consecutive days meeting a condition", "highest price since entry", and "state-machine counters" are **pure historical state** and should still update during warmup. Otherwise the evaluation window starts from a cold state and the strategy semantics change.

```python
import pandas as pd

backtest_start = "2024-01-01"   # evaluation start
backtest_end   = "2024-12-31"
# data-load start = evaluation start - max(indicator_window) * 1.5
# MA120 -> 180 days, EMA200 -> 300 days, MA5/MA10 only -> 15 days
data_start = (pd.Timestamp(backtest_start) - pd.Timedelta(days=180)).strftime("%Y-%m-%d")

df = load_data("600519.SH", start=data_start, end=backtest_end)
df["ma120"] = df["close"].rolling(120).mean()

streak_above_ma = 0

for i in range(len(df)):
    row = df.iloc[i]
    date = str(row["date"])[:10]

    # ★ update pure historical state first; this is allowed during warmup
    above_ma = pd.notna(row["ma120"]) and row["close"] > row["ma120"]
    streak_above_ma = streak_above_ma + 1 if above_ma else 0
    # similar state: highest_since_entry / consecutive high-volume days / state-machine counters ...

    in_eval_window = date >= backtest_start
    indicators_ready = pd.notna(row["ma120"])

    # ★ gating only blocks trading side effects:
    # no orders / no equity records / no trade records during warmup or unready-indicator bars
    if not in_eval_window or not indicators_ready:
        continue

    # normal backtest logic ...

export_results(
    equity_curve, trade_history, "ma120", initial_cash=1_000_000,
    start=backtest_start, end=backtest_end, market="china_a",
)
```

Key points:
- Do **not** place a top-of-loop `continue` that also skips all state counters
- Warmup may update indicators, streak counters, and pure historical state
- Warmup may **not** update `pending_buy/pending_sell`, cash/position, `trade_history.append(...)`, or `equity_curve.append(...)`

---

## Suspensions / Mid-Sample NaN Handling

If the dataset contains suspended days (`close` / `volume` are NaN), **you must handle them explicitly**. Otherwise three failures happen at once:
- `rolling(20).mean()` touches NaN -> the next 19 MA rows become NaN -> the strategy stops working for a while
- `equity = cash + position * NaN = NaN` -> `equity_curve` gets polluted -> Sharpe / annualized return become wrong
- `NaN > threshold` silently becomes False -> the signal is missed without any error

**Default approach**: keep raw data + gate inside the loop (do not forward-fill the raw market data itself; let the code handle suspensions explicitly).

```python
# initialize before the loop: first valid close used as mark-to-market reference on suspension days
last_valid_close = df["close"].dropna().iloc[0]

for i in range(len(df)):
    row = df.iloc[i]
    date = str(row["date"])[:10]
    close = row["close"]

    # ★ suspension gate: place it before all business logic
    if pd.isna(close):
        # keep holding unchanged, do not place orders; use last valid close for mark-to-market
        value = cash + position * last_valid_close
        equity_curve.append({"date": date, "value": round(value, 2)})
        continue
    last_valid_close = close

    # normal backtest logic ...
```

Key points:
- **Gate at the top of the loop**, after warmup gating if present, and before all trading logic
- update `last_valid_close` on every valid bar
- still append to `equity_curve` on suspension days, but **do not let NaN enter the `value` field**
- do not write fake trades on suspension days

### ❌ Common Wrong Patterns

```python
# wrong pattern 1: do nothing; NaN infects everything
value = cash + position * row["close"]  # row["close"] is NaN -> value is NaN
equity_curve.append({"date": date, "value": value})

# wrong pattern 2: skip only at indicator level but ignore equity handling
if pd.isna(row["ma20"]): continue
# ↑ this misses the raw-close NaN case and also skips equity records entirely
```

### Minimal Shortcut (A, only for short ranges + suspension ratio < 5%)

At the cleaning layer, directly drop suspended rows:
`df = df.dropna(subset=["close"]).reset_index(drop=True)`

Tradeoff: the timeline stops being true calendar time. That may be acceptable for multi-year backtests with a few suspension days, but not for short-range tests.

---

## Score-Based Systems Cannot Be Collapsed into AND / OR

Each condition must contribute an explicit score. Sum the scores and trigger only if the threshold is met.

---

## "Reverse Signal" Under Compound Conditions

If the entry condition is A and B and C, then "exit on reverse signal" should by default mean the full mirrored condition (A' and B' and C'), not "one sub-condition flips".

---

## The Stock Universe Must Not Be Silently Rewritten

If the user asks for "free-float market cap < 300 billion", do not silently replace that with "CSI 300 + CSI 500 combined". Cross-sectional screening + historical backtesting inherently involves survivor bias and must be disclosed.

---

## Parameters Not Explicitly Mentioned in the Prompt Must Not Be Silently Assumed

For event-study tasks ("sell after 30 days and compute average return"), default to no commission / no slippage. Other unspecified parameters must be disclosed in the final reply.

---

## Incomplete Data Coverage Must Not Be Silently Accepted

If the screener returns N stocks but only M are successfully loaded (`M < N`), that must be explicitly stated in the reply. Do not silently continue as if M = N.

---

## Signal Timing ≠ Execution Timing

The signal is confirmed on bar i -> execution happens at bar i+1 open. That one-bar gap must be consistent with the user's expectation. If the user explicitly says "fill at the same-day close", then signal and execution happen on the same bar, and the reply must disclose that this is a cheat-on-close assumption.

---

## Grid Trading: A Bar That Crosses Multiple Grid Levels Must Not Be Compressed into One Trade

If price jumps from 0.760 to 0.722 and crosses three grid levels, that should be modeled as 3 separate fills of 100 shares each, not one 300-share fill at the close.
