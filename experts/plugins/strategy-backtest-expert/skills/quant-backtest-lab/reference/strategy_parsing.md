# Strategy Parsing Checklist

Force the user's natural-language description into the structured table below. **Any ambiguous or missing field must be marked explicitly**; do not silently skip it.

## Parsing Template

| Dimension | Content | Status |
|------|------|------|
| Symbol / universe | Ticker + name | ✅ Provided by user / ⚠️ Assumed |
| Data frequency | Daily / 60min / 5min ... | ✅ / ⚠️ |
| Backtest range | YYYY-MM-DD to YYYY-MM-DD | ✅ / ⚠️ |
| Initial capital | Numeric value | ✅ / ⚠️ |
| Position per trade | Fixed amount / % of equity / full position | ✅ / ⚠️ |
| Max concurrent positions | Maximum number of symbols held simultaneously | ✅ / ⚠️ |
| Commission | 0.0003 / 0.0005 / 0 | ✅ / ⚠️ |
| Slippage | Numeric value or 0 | ✅ / ⚠️ |
| T+1 constraint | Yes / No | ✅ / ⚠️ |
| Execution semantics | Next-day open / same-day close / daily-bar stop approximation / requires intraday precision | ✅ / ⚠️ |
| Event lifecycle | First occurrence / repeatable / reset after exit / reset condition | ✅ / ⚠️ |

## Buy Conditions (List Each One Separately; Do Not Merge)

```text
1. [Condition 1] — pseudo-logic translated into code
2. [Condition 2] — ...
...
N. [Condition N] — ...

Combination rule: all AND / at least X conditions / score >= X
```

## Sell Conditions (List Each One Separately; Do Not Merge)

```text
1. [Condition 1] — action after trigger (sell all / sell half / sell fixed amount)
2. [Condition 2] — ...
...
N. [Condition N] — ...

Trigger rule: execute if any condition is met / execute only if all are met
```

## Mandatory Parsing Rules

1. **Do not merge conditions.** "Bullish moving-average alignment" must be split into separate rules such as `MA5 > MA20` and `MA20 > MA60`, so they can later be checked one by one against the code.

2. **Make "today / yesterday / the day before yesterday" explicit.**
   - "today" = current bar (`df.iloc[i]`)
   - "yesterday" = previous bar (`df.iloc[i-1]` or `shift(1)`)
   - "the day before yesterday" = two bars back (`df.iloc[i-2]` or `shift(2)`)

3. **Make the comparison operator explicit.** "Gain greater than 4%" -> `(close - prev_close) / prev_close > 0.04`; do not silently turn it into `>= 0.04`.

4. **Make the percentage base explicit.** "Down 3%" or "up 8%" usually means relative to the **entry price**, not the previous close. If the user did not specify, use entry price and mark it explicitly.

5. **R multiples are not percentages.** If the strategy says 0.5R / 1R / 2R, then `R = |entry_price - stop_price|`, which is an absolute price difference, not a percentage.

6. **Golden cross / death cross / crossing above / crossing below are point-in-time events**, not state checks. See `pitfalls/pandas.md`.

7. **Score-based multi-condition strategies**: every condition needs an explicit score, and the final trigger is based on total score meeting the threshold. Do not silently simplify such a strategy into AND / OR logic.

8. **Make the event lifecycle explicit.** If the prompt includes words like "first", "first buy point", "buy again on the next golden cross", or "sell on the opposite signal", you must spell out:
   - whether the event triggers only once
   - whether buying becomes allowed again after exit
   - what exactly resets the eligibility

9. **If an entry condition is compound, clarify what "reverse signal" means on exit.** If entry is `A and B and C`, and the user says "exit / reverse on the opposite signal", you must say whether that means:
   - the full mirrored condition
   - or only one sub-condition flipping (for example, "only the death cross")

   Do not silently reduce "reverse signal" to a single crossover event.

10. **Clarify whether approximation is acceptable.** If the user writes "stop out when Low touches the stop" or "fill as soon as the intraday breakout happens" while still using daily bars, you must mark whether this is:
   - a daily-bar approximation
   - or a request that really requires higher-frequency data / more precise order semantics

11. **Clarify delivery scope.** If the user asks to "write the .py file and run it", mark whether the script must be self-contained and fetch data on its own, whether it depends on existing local files, and whether an HTML dashboard is required.

## Multi-Strategy Interaction (Mandatory When Two or More Strategies Are Involved)

When the user describes multiple strategies (priority strategy, secondary strategy, rotation, hedging, switching across symbols, and so on), **you must answer the questions below before writing code**. Do not improvise while coding.

### Priority and Preemption

| Question | Must be answered clearly |
|---|---|
| Priority order | Which strategy has higher priority? If both trigger together, which runs first? |
| High-priority preemption | If the high-priority strategy triggers a buy while the low-priority strategy already holds a position, what happens? Three common options: **immediately liquidate the low-priority position and enter** / wait for the low-priority strategy to exit naturally / hold both at the same time |
| Low-priority re-entry | After the high-priority strategy exits, should the low-priority strategy be checked **immediately** or only on the next rebalance day? |

### Ownership of Constraints

| Question | Common mistake |
|---|---|
| Rebalance frequency | Does "rebalance every Monday" apply only to one strategy or to all strategies globally? **Do not apply a single-strategy rule to the full system by default.** |
| Stop-loss / take-profit | Are stop rules separate for each strategy or shared globally? |
| T+1 | After selling strategy A, can strategy B be bought on the same day? (In A shares, T+1 only blocks same-day round trips in the same symbol; different symbols are not restricted.) |

### Switching Timeline

```text
High-priority sell -> [gap?] -> check and buy low-priority
Low-priority holding -> high-priority signal triggers -> [sell low-priority first?] -> buy high-priority
```

You must draw this timeline explicitly and state whether each step happens:
- on the same bar
- on the next bar
- on the next rebalance day

### Example Output Format (Multi-Strategy)

```text
## Multi-Strategy Interaction

| Dimension | Content |
|------|------|
| Number of strategies | 2 (primary + secondary) |
| Priority | Strategy A > Strategy B |
| Preemption | When Strategy A triggers, Strategy B is liquidated immediately before buying A |
| Switching delay | After Strategy A exits, Strategy B is checked on the same bar (not delayed to the next rebalance day) |
| Rebalance frequency | Strategy A: every Monday; Strategy B: daily |
| Stop-loss | Strategy A: none; Strategy B: none |
```

**Write this table before writing code.** If any field cannot be answered, ask the user.

## Default Values for Missing Fields

| Field | Default | Note |
|------|--------|------|
| Initial capital | 1,000,000 | |
| Commission | 0.0003 | A shares default = 3 bps |
| Slippage | 0 | |
| Data frequency | Daily | |
| Position per trade | Full position for single-symbol strategies | Multi-symbol / portfolio tasks must clarify or ask |
| Max concurrent positions | 1 | Single-symbol strategy |
| T+1 | Enabled for A shares | Disabled for futures / crypto |
| Stop-loss | None | Do not add one if the user did not ask |
| Take-profit | None | Do not add one if the user did not ask |

## Example Output Format

```text
## Strategy Parsing

| Dimension | Content |
|------|------|
| Symbol | 600519 Kweichow Moutai ✅ |
| Frequency | Daily ✅ |
| Range | 2023-01-01 to 2025-12-31 ✅ |
| Initial capital | 1,000,000 ✅ |
| Position | Full position ⚠️ Assumed default (single-symbol) |
| Max positions | 1 ✅ |
| T+1 | Enabled ✅ |
| Commission | 0.0003 ⚠️ Assumed |

## Buy Conditions (score >= 6)

Prerequisite: close > EMA200

| # | Condition | Score | Code logic |
|---|------|------|---------|
| 1 | RSI14 < 30 | +3 | `row['rsi'] < 30` |
| 2 | RSI14 crosses above SMA(RSI,3) | +2 | `(df['rsi'].shift(1) < df['rsi_sma'].shift(1)) & (df['rsi'] > df['rsi_sma'])` |
| 3 | MA5 > MA20 > MA60 | +2 | `row['ma5'] > row['ma20'] > row['ma60']` |
...

## Sell Conditions (exit fully if any one condition triggers, unless specified otherwise)

1. Loss >= 3% -> sell all
2. Gain >= 8% -> sell half
3. Gain >= 12% -> liquidate fully
4. RSI > 70 and RSI crosses below SMA(RSI,3) -> sell all
5. close < EMA200 -> sell all
```
