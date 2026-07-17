---
name: quant-backtest-lab
description: 把「自然语言描述的交易策略」转成可运行的 Python+pandas 回测脚本，并产出标准三件套（equity/trades/summary）+ HTML 仪表盘 + 结果解读。覆盖规则型策略回测、事件研究、多标的选股、组合再平衡四种形态；A 股/港股/美股/ETF/指数全市场支持，自动处理 T+1、手数、复权、warmup、look-ahead 等坑。当用户描述买卖条件、事件后收益、股票池筛选回测等量化场景时触发。区别于语义搜索类技能，本 skill 输出的是可执行代码 + 标准化数据文件 + 离线可看的 HTML 报告。
---

# Quant Backtest Lab

## TL;DR — 60-second mental model

每次回测任务，按这个形状走，一次跑通：

1. **取数走 westock**：`westock-data kline / finance / quote / sector / macro` 等结构化 CLI 拿到完整时序，**不要**用语义搜索类 skill 当回测数据源。
2. **写一个自包含的 `<prefix>_backtest.py`**：纯 Python + pandas，不用 backtrader / vectorbt 之类框架；signal-on-bar-i / execute-on-bar-i+1 防 look-ahead；最后调 `export_results(...)` 落 3 个标准文件到 `cwd`。
3. **渲染 `index.html` 到 `cwd`**：复用 `reference/render_dashboard.py` + `reference/dashboard_template.html`，不要手写 HTML，不要手写导航页。
4. **完成 4 步自检**：跑得起来 / 5 项 pitfalls 检查 / sanity + 对抗式审查 / 仪表盘本地渲染检查。任何一步红，**不允许交付**。
5. **回复 A/B/C 三段**：实现细节 / 已知偏差 / 结果解读。先讲结论，再列证据；不要列文件名清单，不要喊"已完成 xx 文件生成"。

完整契约在下面。**不要漏读「Mandatory」「Hard rule」「Iron rule」标记的小节**。

## Output-language lock (hard rule)

- 最终回复 + 仪表盘 + 图表 + 表格 + custom_html 全部跟随**用户最新提问的语言**，不跟标的所在市场。
- 英文提问 + 中港股 → 全英文输出；标的统一用 ticker（`600519.SH` / `0700.HK`），不写中文股票名。
- 中文提问 → 全中文输出；已知中文股票名优先用中文名。
- 渲染仪表盘时**显式传 `language="zh"|"en"`**，不要靠隐式 fallback。
- 容易踩的坑：HTML 是英文但口头回复切回中文 / HTML 是中文但 KPI 卡和图例是英文模板默认值。

## Trigger Conditions

Trigger this skill when **any** of the following is true:

- The user asks for a backtest
- The user provides quantitative descriptions such as entry/exit rules, symbols, frequency, or time range
- The user asks for backtest metrics or a report
- The user describes an event / signal / condition and wants to know the subsequent performance. Typical phrasing:
  - "Buy after XX and hold for N days; how did it perform?"
  - "What was the return after event XX?"
  - "After the signal triggers, hold N days and sell"
  - "Run an event study"
  - "Is this strategy effective?"
  - "Screen stocks that satisfy XX and check later performance"
- The user wants multi-symbol stock-selection backtests or portfolio rebalancing

## Out of Scope

- **Intraday / minute / tick backtesting**: this skill only supports daily or lower-frequency data (daily, weekly, monthly). If the user asks for minute bars, 5-minute bars, ticks, and so on, state directly that it is unsupported
- Pricing for special derivatives such as options and convertible bonds
- Full cross-sectional factor stock-selection strategies

## User-Facing Communication Rules

**During clarification and in the final reply, do not expose code variable names, implementation details, or framework jargon.** Everything should be communicated in natural language:

- ❌ "Use pandas rolling to compute MA120"
- ✅ "Calculated the 120-day moving average"
- ❌ "Signal is generated on bar i and executed on bar i+1"
- ✅ "After the signal is confirmed, buy at the next day's open"
- ❌ "A-share T+1 is enforced by entry_bar"
- ✅ "In A shares, you cannot sell on the same day you buy; the earliest sell is the next day"

Implementation details are internal. **They must never appear in user-facing text** (clarification or result interpretation).

### Output-Language Resolution (Hard Rule)

- **Output language follows the user's latest query, not the market**
- If the user explicitly requests a language, follow that request
- Decide a single `output_language = "zh" | "en"` first, and route every user-visible string through it
- **This rule applies to both layers**: 1. the final conversation reply to the user; 2. dashboards / charts / tables and every other deliverable. **Do not make the HTML English while the actual reply switches back to Chinese**
- When generating the dashboard, always call `build_dashboard_data(..., language=output_language)` explicitly
- **Simplified display rule**:
  - `output_language="en"`: all deliverables stay in English; China / Hong Kong stocks default to ticker code such as `600519.SH` / `0700.HK`
  - `output_language="zh"`: all deliverables stay in Chinese; if a Chinese stock name is known, prefer the Chinese name instead of preserving an English stock name

## Decide First: Do You Need Clarification?

**Principle**: only ask questions that are truly necessary to avoid being wrong. Do not dump eight questions on the user at once. Use defaults whenever that is safe. Keep clarification to 1-3 questions.

### Must Ask (Wrong if You Don't)

If the information below is missing, the result can change completely. **Do not guess; ask.**

- **Signal definition is ambiguous**: the user says "breakout", "volume surge", or "uptrend". Is this a point-in-time event (the instant of crossing) or a persistent state? Without clarification, the generated strategy may be fundamentally different
- **Lifecycle is unclear**: the prompt says "first", "first buy point", or "buy again on the next golden cross" but does not define reset conditions. Is the event one-time only, or repeatable?
- **Compound-exit semantics are unclear**: entry is A and B and C, but the user only says "exit on reverse signal". Does "reverse" mean the full mirror condition, or only one sub-condition?

### Should Ask (Ask if Ambiguous; Otherwise Use Defaults)

- Backtest range — ask if the user did not specify one; if they say "last three years", it can be inferred
- Position sizing — for single-symbol strategy backtests, default to full position and disclose it; for multi-symbol / portfolio tasks, clarify or ask about weights. If the user mentions "partial allocation", "10%", etc., confirm the actual number
- Execution timing — default is next-day open; if the user says "buy the same day", ask whether that means same-day close or next-day open

### Use Defaults Directly (Do Not Ask)

- Fees / slippage: 3 bps for continuous strategies; 0 for event-study style setups
- Data frequency: daily
- T+1 / lot size: enabled automatically for A shares
- Dashboard: generate by default

If the task involves **multiple strategies / multiple symbols** (priority vs secondary, rotation, hedging, switching), **immediately read the "Multi-Strategy Interaction" section in `reference/strategy_parsing.md`** and check priority, preemption, switching timing, and ownership of constraints item by item. If any answer is unclear, ask the user.

The following descriptions **implicitly introduce look-ahead bias**, so you must point that out and confirm how to handle them:

- "Buy when today's return exceeds X%" -> today's return is only known at the close, not at the open. Two reasonable treatments: (1) buy at the next day's open (no look-ahead), or (2) buy at the same-day close (user must explicitly accept this)
- "Buy when the stock hits limit-up / limit-down today" -> same issue; limit-up state is only final at the close
- "Buy when there is a volume breakout today" -> volume is accumulated throughout the day and is not final before the close
- "Select the top N stocks by this year's / this quarter's return" -> cross-sectional look-ahead; you only know the top performers after the fact. This must be rephrased as "use prior-period ranking" or explicitly disclosed as survivor / hindsight bias
- "Buy at today's close when the close moves above the moving average" -> `close > MA` is known only at the close; using the close as execution requires user confirmation

Handling principle: **do not silently work around the issue**. Tell the user: "Your description cannot avoid look-ahead on daily bars; which approximation do you accept?"

The following cases should not be assumed by default:

- A daily-bar strategy that still requires exact intraday execution -> state directly that it is unsupported
- **A-share symbols with a strategy description that includes short selling / opening shorts / reversing into shorts**: you must ask first. There are three reasonable paths:
  1. The user confirms this is only a theoretical backtest ignoring securities-lending constraints -> implement shorting, but do **not** pass `market="china_a"` into `export_results` (to disable short hard-fail). In the reply, explicitly say: "Naked short selling is not actually allowed in A shares; this backtest ignores borrowing constraints and is for theoretical validation only."
  2. The user wants borrowing semantics -> model borrowing cost, margin requirements, and restrict to borrowable symbols
  3. The user confirms long-only -> reinterpret short signals as exit signals and proceed on the normal `market="china_a"` path

## Quick Flow

1. **Mandatory first step**: read `reference/pitfalls/pandas.md` (common pure-Python backtest mistakes) and `reference/common_pitfalls.md` (the checklist).
2. Read `reference/strategy_parsing.md` and convert the strategy into a structured form.
3. Write the backtest in pure Python + pandas. Do not use backtrader or any other backtesting framework. The LLM is free to choose the code structure; there is no required template.
4. Load additional references on demand; do not read everything every time.
5. Formal export, dashboard rendering, and strategy-specific modules all follow the later contract sections: strategy backtests use `export_results(...)` under "**Standard Output Files**"; event studies write event-level `trades.csv` directly; dashboards default to the "**HTML Dashboard**" section; strategy-specific content goes into the main dashboard via `custom_html`. **Do not** output a second standalone HTML page. `reference/render_dashboard.py` is a copyable example, not a mandatory library.
6. Assumptions and known bias should be explained directly in the reply to the user (see part A/B of item 10 and the "Assumptions and Bias" section).
7. **HTML dashboard is mandatory after the backtest runs.** Once the script produces the 3 standard files, you must render an `index.html` through `build_dashboard_data(...)` + the bundled `dashboard_template.html` (see the "**HTML Dashboard**" section). This step is not optional — skip it only if the user has explicitly said they do not want a dashboard. Do not hand over results without the rendered HTML.
8. **Self-check is mandatory after coding** (see the "Self-Check" section): all 4 steps must be completed before delivery — operability (run in cwd + files produced) / pitfalls checklist / sanity check + adversarial review / post-deploy dashboard self-check. **Adversarial review cannot be skipped.**
9. Default deliverables are defined by the three sections "**Standard Output Files / HTML Dashboard / Matplotlib Charts**". Only skip the dashboard if the user explicitly says they do not want one. Only skip charts if the user explicitly says they do not want charts.
10. **The final reply must include result analysis**. This is user-facing text in the conversation. **Do not dump the full reply verbatim into the dashboard**; however, stable and reviewable parts (such as conclusion summary, key assumptions, limitations, and optimization ideas) may be summarized into `text` modules in the dashboard. **Do not list deliverable files** (for example "generated xx.csv / xx.json / xx.html"). Go straight to analysis. The reply must include the following three parts:

    **Language-lock addendum** — Before sending the final reply, check it once: if `output_language="en"`, then sections A/B/C must all be in English, and China / Hong Kong stock references should default to ticker code; if `output_language="zh"`, then sections A/B/C must all be in Chinese, and known Chinese stock names should stay in Chinese.

    **A. Implementation Details** — Tell the user exactly how the code works. It is not enough to say "stop-loss was implemented" without explaining how. **Any parameter that the prompt did not explicitly specify but the code had to choose must also be explained here, not hidden in comments.** You must cover:
    - Which data fields were used for signal evaluation (`close` / `high` / `low` / `open`) and why
    - Execution timing: next-day open or same-day close, and whether that matches the user's likely expectation
    - Stop-loss / take-profit trigger semantics: use `low/high` as an intraday approximation, or only use `close`
    - Position sizing: how size is computed and what the effective exposure becomes after lot rounding
    - The `equity_curve` accounting convention: how single-name / portfolio / short exposure / negative cash / `liabilities` are aggregated; rotation, short, and leverage strategies must explain this explicitly instead of just saying "daily equity was recorded"
    - Other key implementation choices: how T+1 is handled, how compound conditions are combined, how the state machine resets, and so on

    **B. Limitations and Known Bias** — Explain why the backtest should not be taken as reality at face value. Common bias sources include survivor bias, look-ahead, data coverage, and warmup slicing:
    - Daily-bar limitations: stop-loss / take-profit cannot precisely reconstruct intraday order, and the order of `high` vs `low` inside one bar is unknown
    - Execution-assumption bias: next-day-open execution can differ substantially from the signal price in volatile periods
    - Slippage and liquidity: the backtest does not model market impact; large real trades will incur slippage
    - Data bias: adjustment method, survivor bias, data coverage, and so on
    - Strategy-specific weakness: which market environments it may fail in, whether parameters may be overfit, and so on
    - You do not need to list everything. Pick the 2-3 items that matter most for this specific run

    **C. Result Interpretation** — After reading `summary.json` + `trades.csv`, choose the 3-5 most informative angles from the list below (you do not need to use all of them):
    - Return attribution: which trades contributed most? Is it a few large wins with many small losses (trend-following), or a high win-rate / small-profit profile?
    - Drawdown analysis: when did the worst drawdown occur? Did the stop mechanism actually help?
    - Trade frequency: how many buys and sells separately (do not just say "N total trades"; break it into "X buys, Y sells"), and is the holding period sensible?
    - Signal quality: how many signals fired? How many were skipped because of capital / lot-size / position constraints?
    - Time-segment performance: are there obvious differences by year or quarter?
    - Strategy limitation: in what market regime is it likely to fail?
    - Event-driven specific: which events contributed the best and worst results? Is the return distribution skewed?
    - Portfolio-specific: is the rebalance frequency or deviation threshold sensible?

    Writing requirement: lead with the conclusion -> support it with concrete trade data -> if the result is poor, say so plainly instead of dressing it up. Parts A/B/C are all required; do not only write C and omit A/B. **Keep the answer concise.**

## On-Demand Loading

- `reference/pitfalls/pandas.md` — **mandatory read** (before writing code)
- `reference/common_pitfalls.md` — **mandatory read** (self-check after coding)
- `reference/china_a_rules.md` — for A shares / ETFs / ST / T+1 / lot size / price limits / adjustment
- `reference/us_stock_rules.md` — for U.S. stocks
- `reference/hong_kong_rules.md` — for Hong Kong stocks
- `reference/export_results.py` — called by default after the backtest
- `examples/*.py` — when the query is clearly a known pattern such as moving averages / grid strategy
- `reference/dashboard_schema.md` — when generating a dashboard (JSON format, module types, replacement method)
- `reference/render_dashboard.py` — copyable dashboard example
- `reference/dashboard_locales.py` — usually not needed for a standard dashboard; read it only when customizing visible copy or adding new modules. Copy it together when reusing `render_dashboard.py`
- `reference/dashboard_template.html` — **do not read** (2000+ lines of CSS/JS intended for the browser; code only needs `open + replace`)

## Core Rules

### First Decide: Strategy Backtest or Event Study?

| | Strategy backtest | Event study |
|---|---|---|
| Typical query | "Buy on MA golden cross and sell on death cross" | "Buy on the second day after a podcast release and hold for 30 days" |
| Capital / positions | Yes, e.g. 1,000,000 initial cash, compute portfolio equity | **No**, compute price-change percentage directly |
| Commission / lot size | Yes | **Default = no commission**, otherwise "average return" gets distorted |
| Core metrics | Portfolio-level: total return, annualized return, Sharpe, drawdown | **Event-level**: average return, median, win rate, max / min single-event result |
| `equity_curve` | Portfolio NAV over time | Can be omitted (or replaced with a virtual equal-weight curve) |
| `trades.csv` | Paired entry/exit trades with monetary PnL | One row = one event; **`pnl_pct` is the core field**, not monetary PnL |

### Mandatory Checklist by Scenario (Missing Items = Unreliable Results / Broken Dashboard)

After classifying the task, check the list below item by item. Each item points to where the detailed rule lives.

**Mandatory for strategy backtests**:
- [ ] Handle warmup exactly as defined in the "Warmup vs Evaluation Window" section: load earlier data, gate the evaluation start, and pass `export_results(..., start=..., end=...)`
- [ ] Handle suspension NaNs (see the suspension / mid-sample NaN section in `pitfalls/pandas.md`)
- [ ] Parameterize commissions and deduct them from PnL / equity (see the fees section in `pitfalls/pandas.md`)
- [ ] Force liquidation at the end of the sample (see the open-position handling section in `pitfalls/pandas.md`)
- [ ] Execute signals at next-day open (pending-signal pattern; prevents look-ahead)
- [ ] For A shares, pass `market="china_a"` so short trades hard-fail

**Mandatory for event studies**:
- [ ] **Every event must have a non-empty `label` field** (for example "PBOC rate cut by 25bp") — by default the main chart draws one marker per event row; without a label the user cannot interpret it
- [ ] Do not simulate cash / position / pending signals; compute `pnl_pct = (sell/buy - 1) * 100` directly
- [ ] Both the reply and the dashboard must use event-level metrics: average / median / win rate / best / worst event; **do not** report Sharpe / annualized return / max drawdown
- [ ] Use event-level metrics in `metric_table`, and custom `columns` in `trades_table` (event / buy date / sell date / return)
- [ ] **Event-study dashboards must pass `event_overview_mode` explicitly** instead of relying on inference: for average / median / win rate / best / worst event questions, pass `event_overview_mode="stats"`; for cumulative performance / curve / time-evolution questions, pass `event_overview_mode="timeline"`; if you want both stats and time evolution visible, pass `event_overview_mode="both"`
- [ ] If the user's first question **did not** explicitly ask for cumulative / curve / time-evolution output and the current reply stays in `stats` mode, add one final sentence offering it: for example, "If you also want cumulative performance / a curve / time evolution, I can add a timeline view as well."
- [ ] If an `overview_chart` exists, validate before rendering that **the number of displayable event markers equals the number of event rows where `show_marker != False`**. If not, it means `event_date` (default = `entry_date`, but it may also be explicitly anchored to `exit_date`) does not align to chart `points.date`
- [ ] Do not call `export_results`; export requirements are defined in the "Standard Output Files" section and the event-study section of `dashboard_schema.md`

---

**For event-study implementation, remember only two things**:

- Do not model cash / position / pending signals; each event should directly become one trade row, with `pnl_pct` and `label` as the core fields
- Statistics, reply text, and the dashboard all use event-level interpretation; do not quote portfolio-level summary metrics
- If the dashboard directly calls `build_dashboard_data(...)`, event studies **must pass** `event_overview_mode="stats"`, `"timeline"`, or `"both"` explicitly. In `timeline/both` mode, if no `equity_curve` is passed, a cumulative event PnL curve is synthesized from `trade_history`

```python
for event in events:
    buy_price = df.loc[buy_date, 'open']
    sell_price = df.loc[sell_date, 'close']
    return_pct = (sell_price / buy_price - 1) * 100
    trades.append({"entry_date": buy_date, "exit_date": sell_date,
                   "entry_price": buy_price, "exit_price": sell_price,
                   "pnl_pct": return_pct, "label": event_desc, ...})
```

---

### How to Write Strategy-Backtest Code

- Use pure Python + pandas; do not use any backtesting framework
- The LLM is free to choose the code structure, but it **must** follow the patterns below:

**Separate signal generation from execution** (the core anti-look-ahead mechanism):

```text
bar i: generate signals using current and past data -> store in pending_buy / pending_sell
bar i+1: execute pending signals using the open price
```

Do not "see the signal and fill immediately on the same bar" — on daily bars, that is effectively using the close as an execution price and is a look-ahead shortcut. The code structure should look like this:

```python
for i in range(len(df)):
    row = df.iloc[i]
    # 1. Execute yesterday's pending signal first
    if pending_buy:
        price = row['open']  # next-day-open fill
        ...
        pending_buy = False
    # 2. Generate today's signal (to be executed tomorrow)
    if buy_condition:
        pending_buy = True
    # 3. Record equity
    equity_curve.append({"date": date, "value": cash + position * row['close']})
```

**Indicator calculation**: use pandas vectorization. Do not hand-write `for` loops for MA / RSI / ATR:

```python
df['ma20'] = df['close'].rolling(20).mean()
df['rsi'] = ...  # can be written by hand or via ta-lib
```

`rolling()` creates NaNs for the first N-1 rows. Signal generation must skip them (for example `if pd.isna(row['ma20']): continue`).

**Equity calculation**: record account equity at the end of every bar. For simple single-name long-only strategies, `cash + position * close` is fine; for **cash equity / ETF** rotation, portfolio, rebalancing, short, and leverage strategies, prefer the unified form `cash + Σ(position_i × close_i)`. Represent short exposure with negative position size. If margin borrowing, stock borrow, or other leverage-related liabilities are **not already reflected in `cash`**, rewrite it as `cash + Σ(position_i × close_i) - liabilities`. Financing interest, borrow fee, and other costs must be explicitly reflected in `cash` or `liabilities`; do not leave them implicit. **This convention does not automatically cover futures, options, perpetuals, or other derivatives.** **Do not just write "record daily equity" without explaining the accounting convention.**

**Fees**: subtract `buy_commission` at buy time, and `sell_commission + sell_tax` at sell time. Use parameterized design (do not hardcode market-specific rates). PnL must be net of fees. See the fee section in `pitfalls/pandas.md`.

**Trade records**: every time a position is closed, append to `trade_history`. Fields must include: `entry_date, exit_date, side, size, entry_price, exit_price, pnl, pnl_pct, holding_bars, symbol`. PnL is net after commission. **Records must be written after execution, not when the signal is generated** (see `pitfalls/pandas.md`). For A shares / Hong Kong stocks, if the stock name is known, **prefer writing `symbol_name` inside `trade_history.append({...})` in the generated code**; if the code only has `name` / `stock_name` / `security_name` / `display_name`, `export_results` will normalize those aliases into the standard display fields, but do not rely on that fallback instead of the standard key. **Final dashboard display still follows the language lock**: under English output, China / Hong Kong stocks should default to ticker code; under Chinese output, known Chinese names should stay in Chinese.

**Forced liquidation at the end**: if there is still an open position on the final bar, **by default close it at the final bar's `close`**, record a trade, and subtract fees. In the final reply, explicitly say "the last trade is an end-of-sample forced close".

**Golden cross / death cross**: use the `(shift(1) <=) & (current >)` pattern to detect the crossing moment. Do not mistake a persistent state for an event.

### Strategy Logic

#### Warmup Segment vs Evaluation Segment (Mandatory for Indicator Strategies)

If the user says "Backtest the 2024 MA120 strategy", then `2024-01-01` is the **evaluation start**, not the **data-load start**. The first 119 rows of MA120 are NaN, so if you only load from the evaluation start, the first four months will have no valid signal. You **must** load an earlier warmup segment.

1. **Data-load start = evaluation start - max(indicator_window) × 1.5** (rule of thumb; MA120 -> 180 days earlier; EMA200 -> 300 days earlier; MA5 / MA10 only -> 15 days earlier). When calling the data source, `start_date` must use this earlier date, not the user-facing backtest range start
2. **Warmup bars must not create trading side effects, but they are not forbidden from updating all state**. Before the evaluation start, bars may continue to update indicators, streak counters, `highest_since_entry`, and similar **pure historical state**. But they **must not** create trades / equity records, and they must not create future-changing side effects such as `pending_buy/pending_sell=True` or cash/position changes
3. **`equity_curve` and `trade_history` should only record evaluation-window data**. When calling `export_results()`, you **must** pass `start / end` (= the evaluation window), so Sharpe / annualized return / total return / max drawdown are recomputed on the sliced evaluation window and not polluted by warmup

See `reference/pitfalls/pandas.md` for the full code skeleton and three typical wrong patterns.

#### Other Strategy Rules

- Under compound entry conditions, "reverse signal / reverse position" should by default be interpreted as the full mirrored condition. If ambiguous, clarify first
- When the user asks to "write the .py file and run it", the deliverable should be self-contained and runnable in the current environment. Do not hardcode personal paths and do not silently depend on undeclared external CSV files
- By default, save the backtest implementation as a `.py` script so it can be run with `python <script>.py`, inspected with `rg/grep`, adversarially reviewed, and reproduced later
- If the script depends on existing local CSV files, **do not assume the filename must equal `symbol`**; maintain an explicit `symbol -> file_path` mapping, or read the symbol from file contents
- The formal export contract is defined in the "Standard Output Files" section. Strategy backtests must use `export_results()`. Event studies must not. Whether a dashboard is generated is governed by the "HTML Dashboard" section
- **All output languages must be consistent**, and they must follow the user's query / explicit language request rather than the market. **Do not rely on implicit Chinese fallback**: dashboard generation must explicitly pass `build_dashboard_data(..., language="zh"|"en")`
- Under English output, any Chinese stock name should be replaced by ticker code; under Chinese output, known Chinese stock names should be shown in Chinese
- For A shares, default to 100-share lots and T+1. Do not impose these rules on non-A-share markets
- U.S. stocks default to 1-share minimum and no A-share-style T+1. If the strategy includes short selling, it is allowed by default, but do not automatically model borrow fee / locate / SSR. See `reference/us_stock_rules.md`
- Hong Kong stocks do not default to A-share-style T+1, but they also should not be treated like unconstrained U.S.-style short-selling. `board lot` is issuer-specific, and the fee structure is not equivalent to a single commission. See `reference/hong_kong_rules.md`
- Individual A-share stocks are **long-only by default**. If the user explicitly asks for A-share shorting, you must clarify first (see the three A-share shorting paths in "Decide First: Do You Need Clarification?"). Do not silently implement it
- For A-share long-only export parameters, follow the "Standard Output Files" section. If the user explicitly confirms the "theoretical backtest ignoring securities-lending constraints" path, then **do not** pass `market="china_a"` so short trades can pass — but this must be explicitly disclosed in the reply
- **Short naming convention**: strategies that contain short exposure (U.S./Hong Kong compliant shorting, or theoretical A-share shorting) must use the following field conventions. Otherwise dashboard rendering and export validation break:
  - `trade_history[i].side`: `"long"` for long trades (default), `"short"` for short trades
  - dashboard marker `action`: `"buy"` for opening a long, `"sell"` for closing a long, `"short"` for opening a short, `"cover"` for closing a short
  - the dashboard template recognizes these four actions and renders the corresponding marker types; `side="short"` is displayed as a short-side pill in `trades_table`

## Assumptions and Bias (Fold into A/B in the Final Reply)

- Do not create a separate fourth section; fold it into the A/B sections above
- **Implementation choices belong to A**. At minimum, check and explain the following items when relevant:
  - Position-sizing rule (% of equity / fixed amount / lot-based / full position)
  - Fees / slippage / stamp duty (default 0 for event-study-style tasks)
  - Holding-period definition (calendar days / trading days; whether entry day is included)
  - Execution timing (next-day open / same-day close)
  - Lot-size rule (A shares 100-share lots / Hong Kong `board lot` / U.S. 1 share)
  - Universe source, snapshot date, whether survivor bias exists
  - Adjustment method (A shares / Hong Kong default = forward-adjusted; U.S. default = adjustment-consistent OHLC; write N/A if it cannot be proven from the data source)
- **Reliability biases belong to B**: survivor bias, look-ahead, data coverage, warmup slicing

## Self-Check (Mandatory After Coding)

All 4 steps must be completed before delivery. **Step 3 cannot be skipped** — the checklist always lags behind, and adversarial review is there to catch bugs the checklist did not cover. **Step 4 cannot be skipped** — code without bugs still does not guarantee a correct dashboard.

### Step 1: Operability

1. **Run in cwd**: `python <script>.py`. Fix any error immediately
2. **Three files exist**: `ls *_equity.csv *_trades.csv *_summary.json`. All must exist and be non-empty

### Step 2: The 5 Key Checks

Run the 5-item checklist at the end of `reference/common_pitfalls.md`. Item 1 is matched against the user's original words; the rest are verified via grep or direct checks.

### Step 3: Sanity Check + Adversarial Review

If a number is outside common sense, you must find the root cause before delivery:

| Metric | Alarm threshold | Typical root cause |
|---|---|---|
| Sharpe / annualized return / win rate | > 3 / > 50% / > 70% (single symbol) | missed look-ahead; forgot commission |
| Max drawdown / Calmar | = 0 / > 5 | almost never in position; broken `equity_curve`; warmup pollution |
| Total trades | < 3 or > 252 (per year) | signals never trigger (indicator NaN); treating a state as an event |
| Average PnL | every trade exactly = ± stop or take-profit % | using `close` as the implementation price with no slippage variation |

**Inspect the first 5 and last 5 rows of `trades.csv`**: entry-price magnitude (Moutai should be around 1500, not 13000, or size may silently round to zero), holding-period distribution (all 1s or all identical values are suspicious), `side` (A-share long-only should not have `short`), and whether the first trade date falls inside the evaluation window.

**If there is a buy-and-hold baseline**: total return should be in the same order of magnitude as buy-and-hold (a 10x difference almost always means a bug). If the strategy is much better than buy-and-hold, you must be able to explain why.

**Adversarial review**: look for bugs the checklist did not cover. Temporarily forget the checklist and assume there is exactly one bug somewhere in the code. Read through the code from the top and ask four questions on every line:

- **Production realism**: could this data be known at decision time tomorrow? Is any time `t` decision using information from time `> t`?
- **Boundary values**: what happens when a variable is `None` / `0` / `nan` / negative / empty list? Is it silently swallowed or does it raise?
- **Mental arithmetic**: can the result of this line be checked by hand? If PnL = 100, can you reverse it from entry price / exit price / size?
- **Prompt sensitivity**: if one word in the prompt changes ("open" -> "close", "daily" -> "weekly", "liquidate fully" -> "sell half"), is this line still correct?

**High-risk auxiliary logic** (the signal itself is often fine; the bug usually hides here):

- Is size calculation using future data (`shift(-N)` / `iloc[i+1]`)? It should estimate size using the current bar's `close`
- Is stop-loss / take-profit based on `close` or `high/low`? Is the basis the entry price? Is simultaneous-trigger priority defined for the same bar?
- Is trailing-stop highest price updated before the stop check? That would miss valid triggers
- Warmup segment: are gating and `start/end` slicing handled exactly as defined in "Warmup vs Evaluation Window"?
- Does lot rounding produce `size = 0` with no explicit guard?
- Multi-strategy switching: when the higher-priority signal triggers, is the lower-priority holding handled correctly?
- Does a rebalance-frequency constraint belong to one strategy, or was it accidentally applied globally?

**If in doubt, verify**: run a minimal reproduction, grep it, compare with examples. Do not rely on mental confidence alone.

**Hard constraint**: if adversarial review concludes "I did not find anything", you must still list **at least 3 things you suspected and ruled out**. If you cannot list 3, redo the review.

**Bottom line**: if any step fails, do not deliver.

### Step 4: Local-Render Dashboard Self-Check

If a dashboard is part of the deliverable, then after writing `index.html` to `cwd` you **must complete** the "**[Mandatory] Local-Render Self-Check**" checklist from the HTML Dashboard section (rendering integrity + content compliance + performance). You must not hand the file path to the user before this is done. This is an extension of self-check: bug-free code does not guarantee correct presentation.
- If `output_language="en"`, add one more check: both the final reply and the dashboard must contain **no Chinese user-visible text**; China / Hong Kong stocks can simply be displayed as ticker codes.

## Standard Output Files (Formal Export Contract)

First distinguish the scenario:

- **Strategy backtest**: after the backtest completes, always generate 3 files into the current working directory (`cwd`). Use a prefix such as `ma_cross_600519`
- **Event study**: do **not** use the portfolio-style summary export. Write `trades.csv` manually, and compute event-level metrics from `pnl_pct`. Do not fabricate Sharpe / annualized return / max drawdown

The 3 standard files for strategy backtests are:

| File | Content | Columns / fields |
|---|---|---|
| `<prefix>_equity.csv` | per-bar equity | `date, value` |
| `<prefix>_trades.csv` | closed trades | required: `entry_date, exit_date, side, size, entry_price, exit_price, pnl, pnl_pct, holding_bars, symbol`; optional: `symbol_name`, `display_symbol` |
| `<prefix>_summary.json` | summary metrics + meta | `meta: {strategy_name, symbol, start, end, initial_cash, window_start_value, final_value, market, generated_at}`<br>`summary: {total_return_pct, annual_return_pct, max_drawdown_pct, sharpe, win_rate_pct, total_trades}` |

Implementation for strategy backtests: call `reference/export_results.py` via `export_results(equity_curve, trade_history, prefix, initial_cash, start, end, market)`:
- `equity_curve`: `[{"date": "2024-01-02", "value": 1000000.0}, ...]`
- `trade_history`: `[{"entry_date": ..., "exit_date": ..., "side": "long", "size": 100, "symbol": "600519.SH", "symbol_name": "Kweichow Moutai", ...}, ...]`
- If warmup exists, the `start/end` logic is defined in the "Warmup vs Evaluation Window" section. Export will slice to the evaluation window and recompute Sharpe / annualized return / total return / max drawdown
- For A shares, pass `market="china_a"` to trigger short hard-fail
- Files must be written directly into `cwd`; do not create a subdirectory

## HTML Dashboard

### Unified UI Iron Rules (Violation = Invalid Output)

| # | Rule | Violation example |
|---|---|---|
| 1 | **All HTML must be rendered through `render_dashboard()` + `dashboard_template.html`** | Handwritten index.html navigation page, custom landing page, or any HTML file not generated through `render_dashboard()` |
| 2 | **The visual system is entirely provided by the template** | Custom CSS/JS, custom overall styling, or a layout / color system that departs from the template |
| 3 | **Standalone visual-style pages are forbidden** | Any HTML page that is not rendered from `dashboard_template.html`, including navigation pages, index pages, or router pages |

**The model does not need to read `dashboard_template.html` itself** (2000+ lines of CSS/JS are for the browser). It only needs to build the `report_data` dict and call `render_dashboard(report_data, output_path, template_path)`.

**Naming rule**:
- In the single-HTML case, the final main dashboard file name is fixed to `index.html`
- If multiple HTML files are truly needed, the entry page must still be named `index.html`; only the detail pages may use per-symbol / per-strategy names

### Single HTML vs Multiple HTML Files

This section is **layout strategy** and takes precedence here. `reference/dashboard_schema.md` mainly defines module schema, field semantics, and recipes for non-typical backtests.

**Default recommendation: single HTML + tabs**
- Use `ui.tabs` to configure multiple tabs, one per symbol
- Main-chart choice: for **portfolio-style / natural-mainline** cases (position weights, rebalancing, **multi-symbol rotation** — dynamically rotating across N symbols under one strategy), use `overview_chart` to draw the **portfolio NAV** as the main line, optionally with `overlay_series` as supporting lines. For **peer comparison / no natural main line** cases (one strategy across many stocks, or many strategies on one stock), use `line_chart` (peer lines) + `metric_table` (one comparison object per column). **Do not force such cases into `overview_chart`**, because that visually promotes one series into the "main line." Rotation strategies must not be misread as peer comparisons; the portfolio-level NAV is the true mainline
- **Standard layout for peer-comparison scenarios (hard rule)** — applies to both "many stocks, one strategy" and "many strategies, one stock":
  - Tab 1 `"Comparison"` (`ui.active_tab` by default): `line_chart` multi-line comparison + `metric_table` KPI comparison by column (event studies use event-level metrics; strategy backtests use Sharpe / return / drawdown, etc.)
  - Tab 2+ **one tab per comparison target**: `overview_chart` for that target's equity curve (with buy/sell markers and drawdown pane) + `trades_table` for its detailed trades
  - **You may not provide only the comparison chart without per-target detail**, because users will want to click into one specific line
- Best fit when the number of symbols is `<= 10`, content complexity is moderate, and the file stays under 5 MB

**Multiple HTML files are allowed (model decides)**
- When the symbol count is large, a single page is overloaded, or each symbol requires a fully independent detailed view
- **Each symbol HTML** must still be rendered through `dashboard_template.html`
- **Navigation / index page (if needed)** must also be rendered through `dashboard_template.html`, using standard modules such as:
  - `metric_table` — side-by-side comparison across symbols
  - `custom_html` — card grid, link list (DOM class names must use the `bt-custom-` prefix)
  - `overview_chart` + `overlay_series` — overlay multiple equity curves
- **Do not** handwrite a custom navigation page, and do not link multiple HTML pages together via raw `<a href>`

### Implementation Notes

- The dashboard is **only a display layer**; the formal export contract is defined in the "Standard Output Files" section
- The default base dashboard contains: equity curve, PnL curve, drawdown curve, trade history, Sharpe, win rate, and buy/sell markers on the main chart
- `reference/render_dashboard.py` is a **copyable example** — it demonstrates the minimal path of "read standard output files -> build dict -> replace `dashboard_template.html` placeholders -> output HTML"; if you copy it, copy `reference/dashboard_locales.py` too
- When calling `render_dashboard(...)`, default the main dashboard `output_path` to `index.html`
- Default sequence: complete formal export first, then render the HTML
- As long as the backtest actually ran and the user did not explicitly opt out of the dashboard, generate a local HTML dashboard by default
- After writing the HTML dashboard to `cwd`, return the absolute file path to the user so they can open it locally in a browser

#### **[Mandatory] Local-Render Self-Check — No Self-Check = No Delivery**

After writing the HTML to disk, you **must** open it locally (browser / screenshot tool / headless render) and confirm the following items one by one. All must pass before delivery. If any item fails, fix it immediately, regenerate, and recheck.

**Rendering integrity checks (mandatory)**:
- [ ] The main chart (equity / PnL) has real data and is not blank or a single flat line
- [ ] KPI cards (total return, max drawdown, number of trades, win rate, Sharpe) contain values and are not `"--"`
- [ ] The browser console has no errors (open F12 -> Console and inspect red errors)

**Content compliance checks (mandatory)**:
- [ ] No irrelevant modules are present for the current query (for example, no Sharpe / annualized return / max drawdown in an event study)
- [ ] `trades_table` column names match the task (event studies should use "Event / Buy Date / Sell Date / Return", not the default "Entry / Exit")
- [ ] All text is consistent with the dashboard `language`, and that language matches the user's query (an English question about Chinese stocks must not produce Chinese module titles)
- [ ] **All HTML files are rendered from `dashboard_template.html`** — grep the code and confirm every `.html` is generated through `render_dashboard()`, with no handwritten page
- [ ] There is no handwritten standalone navigation / index page — if navigation is needed, it must be injected through standard `custom_html` / `metric_table` modules

**Performance checks (mandatory when file size > 5 MB)**:
- [ ] The page loads smoothly and does not white-screen. If `equity_curve` has too many points (`>5000`) or markers are too many (`>200`), you **must** downsample or simplify and regenerate before handing the file path back

**Mandatory rerun chain after bug fixes**:
fix code -> rerun backtest -> regenerate 3 files -> rerender HTML -> **rerun the full self-check**. Skipping any step means the user still sees the old broken version.

### Scenario-Specific Notes

- Event-driven / stock-selection / portfolio-allocation tasks **must also produce dashboards**. Do not skip the dashboard just because you cannot build a continuous NAV; recipes are defined in the "Non-Typical Backtests" section of `reference/dashboard_schema.md`
- ⚠️ **Hard rule (violation = invalid dashboard)**: in an event study, each entry in `trade_history` **must include a non-empty `label` field** (event description). Without `label`, the event markers on the main chart are unreadable and the dashboard loses the core value of an event study
- Other event-study adaptations are not repeated here. Follow the earlier "Event Study Must-Do Checklist", and use `reference/dashboard_schema.md` for concrete module recipes

## Matplotlib Charts (Standalone PNG)

After the backtest completes and the 3 standard files exist, **by default generate standalone matplotlib PNG charts** into `cwd`, with file names like `<prefix>_<chart_name>.png`.

### Hard Rules

- Read `<prefix>_equity.csv`, `<prefix>_trades.csv`, and `<prefix>_summary.json` first, then decide what to draw. **Do not hardcode a fixed chart list**
- The only chart-selection criterion is: **does this chart help the user understand the 3-6 most important aspects of this backtest?**
- Charts are standalone files and **must not be embedded into the HTML dashboard**. Unless there is a strong reason, keep the count under 8
- **You must call `plt.show()` before `plt.savefig()`**; do not save without showing
- File names should be `<prefix>_<descriptive_name>.png`; do not use Chinese file names; titles and labels must match the user's language
- Matplotlib code may live inside the backtest script or in a separate script; in the user-facing reply, do not list the chart files — go straight to analysis

## Data Sources (Mandatory)

This expert ships with three companion skills. **Do not** hardcode prices, financials, or universes — always go through these skills.

**Why westock is the default for backtests, not neodata**: backtests need **structured, complete time-series** (every trading day, no truncation, full OHLCV / financials with stable schemas) so a Python script can iterate over them. `westock-data` and `westock-tool` are structured APIs with deterministic CLI inputs / Markdown-table outputs — exactly what a backtest needs. `neodata-financial-search` is a **natural-language search service**: it returns LLM-context-sized passages tailored for chat consumption, with length limits and ranking heuristics. It is **not** suitable as a primary data feed for a backtest loop, because results may be truncated, summarized, or non-deterministic.

**First-choice order — always try in this sequence**:

1. **`westock-data`** (CLI: `westock-data <cmd>`) — **the default for everything backtest-relevant**: quotes, day/week/month K-line, three financial statements (multi-period, cross-market), capital flow, technicals, chip cost, dividends, ETF detail, sector / concept constituents, indices, macro economic indicators. Covers A-share (sh/sz/bj), HK (hk), US (us). Use this for any symbol-level price / financial / indicator data the backtest reads.
2. **`westock-tool`** (CLI: `westock-tool <cmd>`) — **the default for universe / screening**: "find all stocks satisfying conditions" (market cap, industry, technical filters, financial filters). Do not treat CSI 300 / CSI 500 as a generic whole-market proxy.
3. **`neodata-financial-search`** — only as **supplement / fallback** for non-structured queries that westock cannot answer: cross-asset macro / forex / commodity context, research-grade narrative lookups, news / events / research-report digests. **Do not pipe its output directly into the backtest as price or financial series** — at most use it for narrative context or to confirm an event date that you then re-fetch through `westock-data`.

If none of the three satisfies the query, fall back to other sources and disclose in the reply.

- **Data coverage**: if the screener returns N symbols but only M are successfully loaded (`M < N`), that must be explicitly stated in the reply. Do not continue silently. A best practice is to assert `len(loaded) == len(target)` immediately after loading the screened list
- **Currency & market**: `westock-data` returns HKD/USD for HK/US; never overlay a CNY symbol on top of HK/US figures. Pass the resulting OHLCV into the backtest as-is.
