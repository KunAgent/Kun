---
name: databrain-analysis
display_name_en: DataBrain Sandbox Analysis
display_name_zh: DataBrain 沙箱分析
description: >-
  Before execute_e2b_code for attribution, drill-down, or statistical tests,
  read this SKILL.md then drilldown.md and/or statistical/SKILL.md plus
  needed references. Does not fetch data.
when_to_use: >-
  User asks for drivers/归因/下钻/contribution, formal tests (t-test, ANOVA,
  regression), or sandbox Python analysis on data already fetched. Not for
  final Markdown layout (use databrain-summarize).
---

# DataBrain Analysis (sandbox)

在 **E2B sandbox** 里做归因下钻或统计推断。**不拉数**；先经 `databrain-dashboard-service` / `databrain-intelligence` / opinion skills 取数，再分析。

## 闸门（分析代码前）

用 `read_file` 读引用文件，**再** `open_e2b_code_sandbox` / `upload_to_e2b_code_sandbox` / `execute_e2b_code`。凭记忆写分析代码不算完成。

| 任务类型 | 何时 | 必读 |
|----------|------|------|
| **归因 / 下钻 / 驱动因素** | 贡献度、谁导致变化、多维拆解 | 本文件 + [`drilldown.md`](drilldown.md) |
| **统计检验 / 建模** | A/B、显著性、回归、时序 | 本文件 + [`statistical/SKILL.md`](statistical/SKILL.md) + 按需 `statistical/references/<name>.md` |
| **两者都要** | 先归因定位再对子集做检验 | 先 drilldown，再 statistical |

**未完成闸门**：未读对应 md 已 `execute_e2b_code` 长段分析脚本。

## 数据进 sandbox

1. **优先**：取数工具返回的 **CSV / 本地路径**（`run_skill_script` 写入 `/outputs/...` 或工具说明中的路径）→ `upload_to_e2b_code_sandbox(local_path=...)` → sandbox 内 `pd.read_csv(...)`。
2. **`data_id`**：若工具结果含 `data_id` 且附完整 CSV 路径，上传该文件；勿编造文件名。
3. **`/large_tool_results/` spill**：当工具返回 `Tool result too large` 且路径为 `/large_tool_results/toolu_xxx` 时，**先**按 `soul.md` §7 尝试 **收窄重查**；若分析任务需要保留宽表/全量行且收窄会丢维度，则 **`upload_to_e2b_code_sandbox(local_path=/large_tool_results/...)`**（或 `execute_e2b_code` 引用该路径并由宿主自动 staging）后在 sandbox 内解析。**不要**用 `read_file` 整文件塞进上下文；**不要**在无 `databrain-analysis` 闸门时为简单问答默认走 sandbox。
4. **包安装**：分析前如需 `pandas scipy statsmodels`，先 `execute_e2b_code` `language=bash`：`pip install pandas scipy statsmodels`（勿用 `!pip`）。

## 执行纪律（react）

- `execute_e2b_code`：**短脚本** — 安装依赖 → 读表 → `print()` 表与结论；**禁止** `plt.savefig` / 出图（图表由 **`databrain-chart-render`** 的 `scripts/build_chart.py`：`<dbd>` / echarts_option）。
- **stdout 即证据**：关键统计量、归因表、`ATTRIBUTION_TABLE` 风格列须 `print`；终稿由 **`databrain-summarize`** 合成（含 [`report.md`](../databrain-summarize/report.md) 若 §0.2）。
- 同一 query 内 sandbox **复用**；分析结束可 `close_e2b_code_sandbox`（可选）。
- 工具连续失败 ≥3 次：停止分析，向用户说明原因（`soul.md`）。

## 引用文件

| 文件 | 内容 |
|------|------|
| [`drilldown.md`](drilldown.md) | cumulative_joint、30% 规则、directional/L1、归因结论 |
| [`statistical/SKILL.md`](statistical/SKILL.md) | 选型表、workflow |
| [`statistical/references/`](statistical/references/) | `data_cleaning`, `stat-t-test`, `experimental_design`, … |
| [`../databrain-summarize/report.md`](../databrain-summarize/report.md) | 终稿如何呈现检验/归因（summarize 阶段） |

无 `run_skill_script`（分析逻辑在 sandbox 内手写 Python，可参考 references 中的代码模式）。
