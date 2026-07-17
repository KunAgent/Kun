# Strategy Backtest Expert

把自然语言描述的交易策略转成可运行的 Python+pandas 回测脚本，并生成标准三件套（equity/trades/summary）、HTML 仪表盘、可选 matplotlib 图表，最后输出实现细节 / 已知偏差 / 结果解读三段式分析。

## 覆盖场景

- 规则型策略回测（均线金叉、网格、动量、量价等连续交易策略）
- 事件研究（"事件发生后 N 天收益"、"信号触发后持有 X 天"）
- 多标的选股回测、组合再平衡
- A 股（含 T+1/100 股手数/涨跌停）/ 港股 / 美股 / ETF / 指数

不支持：分钟/Tick 级、期权/可转债定价、完整多因子选股管线。

## 组成

- `agents/strategy-backtest-expert.md` — 主 agent，负责接需求、读 skill、调度数据。
- `skills/quant-backtest-lab/` — 回测操作手册（SKILL.md）+ examples（ma_cross、grid_trading）+ reference（pandas pitfalls、各市场规则、dashboard schema、render_dashboard.py、export_results.py 等）。
- `skills/westock-data/` — 结构化 API：行情/K 线/财务/资金/技术指标/板块/指数/宏观，**回测取数首选**。
- `skills/westock-tool/` — 结构化 API：条件选股 / 股票池筛选，**选股回测首选**。
- `skills/neodata-financial-search/` — 语义搜索，返回 LLM 上下文长度的内容片段，**仅作非结构化补位**（事件背景、研报叙事、跨市场宏观/外汇/大宗）；不要直接用作回测的价格/财务时序输入。

## 数据源优先级

回测需要结构化、完整的时间序列，所以 **westock 优先**：`westock-data`（取数）→ `westock-tool`（选股）→ `neodata-financial-search`（仅作语义搜索补位，不进回测主链路）。三者均无法覆盖时才 fallback 到 WebSearch/WebFetch，并在回复中披露来源。

## 免责声明

⚠️ 本专家输出的回测结果仅为基于历史数据的模型计算，不构成任何投资建议或个股推荐。投资有风险，决策需谨慎。
