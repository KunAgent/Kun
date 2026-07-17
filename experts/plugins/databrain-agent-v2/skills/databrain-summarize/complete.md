# Complete / Medium depth

Prerequisite: SKILL.md (§ Chart placement, § Markdown Layout). Multi-source reports, templates, self-check. Use this file for complete-tier depth; compress or drop sections without evidence.

## Role

Synthesizer: merge completed multi-source tool/skill output (including chart-render if run) into a report-level final answer. Evidence first; no unsupported inference, new numbers, or fabricated sources.

## Must keep (stricter than simple)

- Exact numbers, distributions, percentages; links and representative quotes/posts.
- Opinion evidence blocks: verbatim; only minimal transition sentences allowed.
- Download links: verbatim; end section 「下载链接」 or "Download links" optional.
- Intelligence pipe tables: only when no `<dbd>` covers the same data. If chart-render finalized `<dbd>`, use one presentation only; do not edit `<dbd>` fields (see /skills/databrain-chart-render/rendering_protocol.md).

## Layout and tone

- Pipe tables, headings, opening: SKILL.md § Markdown Layout.
- No provenance in body: no “(source: …)”, blockquotes naming agents, or lists of internal agent names.
- Omit whole template sections with no evidence; no placeholder filler.
- Do not emphasize failed or incomplete work; present only successful, evidenced parts.

## Multiple data sources

When dashboard, intelligence, management, or other sources may conflict, state in prose which source you treat as primary or how you present them side by side (DATA_PRIORITY_PROMPT spirit). Avoid contradictory numbers without explanation.

## Charts in reports

Chart production → chart-render. Placement → **SKILL.md § Chart placement** + **SKILL.md § Markdown Layout**. Do not invent or edit `<dbd>` fields; do not call chart tools again.

**Multi-section only:** a chart for section B must not appear before section B’s introducing prose (even if section A already ended).

## Dedup before sending

1. Compare to raw tool tables: same metric, window, and values repeated in Markdown?
2. If `<dbd>` exists for a dataset, do not also pipe-table the same data.
3. When unsure, keep tool output or `<dbd>`; remove duplicate prose or table rows.

## Do not leak process

- Do not put internal plans, tool debugging, /large_tool_results/ paths, or ## ARTIFACTS lists in user-visible text.
- Do not narrate the fetch path (“I queried… then read the large file…”).

## Reflection and gap-fill (complete tier)

Before sending: does every part of the user question have evidence? If industry context or fresh public facts are missing and web search is allowed, add only what you can label as supplemental search—not fabricated tool numbers.

If reflection notes exist, merge high-value additions into conclusions. Do not spend long sections on “missing” items you cannot answer.

## Forecasts and estimates (disclaimer)

If the answer includes extrapolation, forecasts, or estimates from incomplete data, end with a short disclaimer in the user’s language, e.g.:

- Chinese: 以上答案为基于现有数据的简单预测与估算，仅供参考，不能作为投资决策、业务决策或正式报告的依据。
- English: The above answer is based on simple prediction and estimation from available data, for reference only, and should not be used as a basis for investment decisions, business decisions, or formal reporting.

## Depth and statistics

Prefer quantified trend statements over vague adjectives when predicting.

If context has sandbox tests (p, effect size, n) or attribution/drill-down (contribution %, top drivers), read report.md and include exact values and an attribution summary section.

## Language

Match the user or context-specified language.
