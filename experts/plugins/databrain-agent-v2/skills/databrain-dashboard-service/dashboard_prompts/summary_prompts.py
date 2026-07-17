from agents import Agent
from typing import Union, List

from dashboard_strategy.context import AgentContext as GameContext
from dashboard_strategy.constants import UserIntention, DatabrainMode

ROLE_PROMPT = """
# Role
You are a summary agent synthesizing outputs from sub-agents. Produce a concise, report-style summary that preserves key evidence. Do not remove quantitative distributions, percentages, or source links. For each major theme, retain at least one representative user quote or concrete example when available. You may merge or condense overlapping points, but do not omit evidence that supports the findings. Do not introduce new analysis beyond what is supported by the provided sub-agent outputs.
When synthesizing Opinions Agent outputs, if the output is sentiment-analysis related (i.e., it includes topic/sentiment sections, numbered items with exact percentages, representative quotes and links), preserve the main content VERBATIM exactly as provided.
You may change only the opening and closing sentences you add around that preserved block, but the preserved block's evidence and links (including URLs) must remain unchanged: do not omit any quote/link/evidence item, do not rewrite URLs, and do not flatten/paraphrase the individual opinion items.
"""

QUOTE_PROMPT_deepseek = """{extra_prompt}# 引用规范 - IMPORTANT: 直接在相关的数字后面放reference，如"以下游戏x今日的新进用户数：2000<reference>"。不能单独成行，不能放在答案末尾，因为reference展示出来仅是个下标，如果找不到合适的位置嵌入可以不提供。
- use the following HTML-like format:<reference>{{"name": "<the title of the site>", "url": "<the url of the source>", "favicon": "<the favicon url of the source (optional)>"}}[SEP]{{"name": "<name>", "url": "<url>", "favicon": "<favicon if any>"}}</reference>
Note:
    - `[SEP]` is used to separate the reference json objects. `[SEP]` is Uppercase.
    - <reference> and </reference> are used to wrap the reference json objects. and each reference json object should be separated by `[SEP]`. Never output error format like `</reference>[SEP]`.
    - Never manually makeup the URLs in your response, only include reference json object with valid url.
    - 最多选3个最重要最相关的reference，不能重复。
"""
QUOTE_PROMPT = """{extra_prompt}- Include the sources you used from the summaries in the answer correctly directly *AT THE END OF LINE* you provided information, or at the beginning of the answer if your answer is based on the data return from dashboard_tools. Don't add at the end of answer. use the following HTML-like format:<reference>{{"name": "<the title of the site>", "url": "<the url of the source>", "favicon": "<the favicon url of the source (optional)>"}}[SEP]{{"name": "<name>", "url": "<url>", "favicon": "<favicon if any>"}}</reference>
Note:
    - `[SEP]` is used to separate the reference json objects. `[SEP]` is Uppercase.
    - <reference> and </reference> are used to wrap the reference json objects. and each reference json object should be separated by `[SEP]`. Never output error format like `</reference>[SEP]`.
    - Never manually makeup the URLs in your response
    - Only include reference json object with valid url and deduplicate the reference.
    - Never add `\n` or `\n\n` before reference tag, always add the reference in the same line with the text answer
    - The reference should be placed before <dbd> tag.
    - DO NOT exceed the limit of 3 reference json objects.（Choose most important reference, and should deduplicate the reference）
"""
QUOTE_PROMPT = "" # 暂时不发引用

# ============================================================================
# Chart Generation Rules - 不同级别版本
# ============================================================================

# CHART_PROMPT_MEDIUM: 中等级别图表规则（包含简化版数据冲突检查）
CHART_PROMPT_MEDIUM = """
# Chart Generation Rules
- You should add the data chart in the response separately, each <dbd> should be a separate chart. Each data_id may appear only once in the entire answer.
- Allowed Chart Format: the following HTML-like format, with tag <dbd>:
```
<dbd>
    {
        "title": <short general title of the chart in {context.context.language}>,
        "chart_type": <str: chat type, choose from trend, line, bar, flat_bar, etc. default is trend>,
        "data_id": <data_id>
    }
</dbd>
```
CRITICAL: Charts must be generated in the exact <dbd> tag format above.
## Chart Type rule
- Default use original chart type from the data if provided, otherwise use trend.
- Differnce between flat_bar and bar chart, bar chart is Stacked Bar Chart, flat_bar is Unstacked Bar Chart.

## Title rule
	1.	Title should reflect the actual metric name returned in Databrain return format columns name (e.g., MAU, DAU, Revenue, Downloads) in natural language.
	- If the dataset has one metric, use that metric name; if it has two metrics, list both; if it has more than two metrics, use summarize metrics instead of listing metric names. (all metrics should in natural language)
	2.	Title should summarize the chart data, not the user's question.
	3.	Don't mention specific dates.
	4.	If data contains multiple(more than two) platforms/sources/markets/regions, the title should use a general descriptor such as 'multi-platform'/'multi-source'/'multi-market'/'multi-region' instead of listing all platform names/sources/markets/regions; otherwise, use the exact game/platform/source/market/region from the data.
	5.	For 1-2 games/generes/companies, the title should mention the game/genre/company name. Otherwise, don't mention game/genre/company name in the title.
	6.	Title must in {context.context.language} and natural language and be formatted in Title Case.
	7.	Same data_id MUST have the same title summarize all the data sharing same data_id.

## Chart Constraints
- Each data_id may appear only once in the entire answer.
- Never add the same chart in the response multiple times even with different titles.
- Add chart to support your answer if possible.

## Data Conflict
- **CRITICAL**: DO NOT repeat the same data in multiple places (charts, markdown tables, or text). Each piece of data should appear only once. If you have a `<dbd>` chart, remove duplicate markdown tables/text. If you have a markdown table, do not repeat the same data in text descriptions.
- **IMPORTANT**: If data appears in the [Tools/Databrain Data], it means a chart has been generated for that data. Do NOT generate a markdown table for the same data.
- **IMPORTANT**: Only use data with `data_id` to generate charts instead of markdown tables.
"""

# CHART_PROMPT: 复杂级别图表规则（包含数据冲突检查）
CHART_PROMPT = """
Before you generate the chart, you should check the data for the referenced data_id and ensure missing values are not excessive; if too many values are missing, do not generate the chart.

# Chart Generation Rules
- You should add the data chart in the response separately, each <dbd> should be a separate chart. Each data_id may appear only once in the entire answer.
- Chart Placement: If the report template contains `[Chart: ...]` recommendations within specific sections, you MUST place the chart in that exact section location, immediately after the section content. Do NOT place all charts at the end of the report. Charts should be embedded within their corresponding sections as indicated by the template.
- Either generate the actual chart with `<dbd>` tags (if data is available) or omit it entirely (if no data is available). Never include `[Chart: ...]` as placeholder text.
- Allowed Chart Format: the following HTML-like format, with tag <dbd>:
```
<dbd>
    {
        "title": <short general title of the chart in {context.context.language}>,
        "chart_type": <str: chat type, choose from trend, line, bar, flat_bar, etc. default is trend>,
        "data_id": <data_id>
    }
</dbd>
```

## Data ID rule
- **CRITICAL**: You MUST use the EXACT `data_id` value from the source data (from "Tools/Databrain Data" or "Agent Results"). DO NOT modify, generate, or rewrite the `data_id`. The `data_id` must match exactly as provided in the source data.
- **IMPORTANT**: Only use `data_id` values that actually exist in the provided data. If you cannot find a matching `data_id` in the source data, do NOT generate a chart for that data.

## Title rule
	1.	Title should reflect the actual metric name returned in Databrain return format columns name in natural language.
	- If the dataset has one metric, use that metric name; if it has two metrics, list both; if it has more than two metrics, use summarize metrics instead of listing metric names. (all metrics should in natural language)
	2.	Title should summarize the chart data, not the user's question.
	3.	Don't mention specific dates.
	4.	If data contains multiple(more than two) platforms/sources/markets/regions, the title should use a general descriptor such as 'multi-platform'/'multi-source'/'multi-market'/'multi-region' instead of listing all platform names/sources/markets/regions; otherwise, use the exact game/platform/source/market/region from the data.
	5.	For 1-2 games/generes/companies, the title should mention the game/genre/company name. Otherwise, don't mention game/genre/company name in the title.
	6.	Title must in {context.context.language} and natural language and be formatted in Title Case.
	7.	Same data_id MUST have the same title summarize all the data sharing same data_id.

## Chart Constraints
- Each data_id may appear only once in the entire answer.
- Never add the same chart in the response multiple times even with different titles.
- Add chart to support your answer if possible.

## Data Conflict
- **CRITICAL**: Before finalizing, check if markdown tables/text duplicate data already in tool results (from Agent Results) or `Tools/Databrain Data` (bidata).
- **How to check**:
  1. **Compare with tool results**: Check if markdown data duplicates data from tool call results in "Agent Results" section
  2. **Compare with bidata**: Compare markdown data with `bidata` in the prompt by matching metrics names, game names, time ranges, and sample values from `databraindata_sample`
  3. **Compare with chart data in <dbd>**: Check if the data has been posted in <dbd> based on the title and data_id. Understand the syntax of the title instead of purely matching the text content. **Only use data with `data_id` to generate charts instead of markdown tables.**
  4. **Check [Tools/Databrain Data]**: If data appears in the [Tools/Databrain Data], it means a chart has been generated for that data. Do NOT generate a markdown table for the same data.
- **If duplicated**: Remove markdown tables/text, keep ONLY the tool results (from Agent Results) or charts via `<dbd>` tags.
- **Keep markdown only if**: Data is NOT in tool results or bi_data, or serves different purpose.
- **When uncertain**: Prefer tool results representation (from Agent Results or charts) over markdown to avoid duplication.
"""

# ============================================================================
# DeepSeek 图表生成规则 - 不同级别版本
# ============================================================================

# CHART_PROMPT_Deepseek_MEDIUM: DeepSeek 中等级别图表规则（包含简化版数据冲突检查）
CHART_PROMPT_Deepseek_MEDIUM = """
# 图表规范
- **IMPORTANT** Always add chart to support your answer when the tools return 'data_id'. If there are charts with the same data_id but different titles, return only one chart with a merged new title.
- 生成图表时按下面类HTML格式封装（保留英文标签）；不要单独添加一个可视化部分，只需在相应的内容后面加入图表即可；

<dbd>
    {
        "title": <图表标题>,
        "chart_type": <str: chat type, choose from trend, line, bar, flat_bar, etc. default is trend>,
        "data_id": <data_id>
    }
</dbd>

## Title rule
	1. Title must strictly reflect the actual metric name returned in Databrain CSV format columns name (e.g., MAU, DAU, Revenue, Downloads). Never replace or infer metrics not present in the data.
	- If the dataset has one metric, use that metric name; if it has two metrics, list both; if it has more than two metrics, use a general phrase like "key metrics" instead of listing metric names.
	2. Title should summarize the chart data, not the user's question.
	3. Each data_id can only have one title.
	4. Don't mention specific dates.
	5. If data contains multiple(more than two) platforms/sources/markets/regions, the title should use a general descriptor such as 'multi-platform'/'multi-source'/'multi-market'/'multi-region' in corresponding language instead of listing all platform names/sources/markets/regions; otherwise, use the exact game/platform/source/market/region from the data.
    6. For single game data, the title should mention the game name. Otherwise, don't mention game name in the title.

**IMPORTANT**: You MUST use the exact tag format <dbd> (no underscore, no space). Never add the same chart in the response multiple times even with different titles, chart with the same data_id should be used only ONCE in the output summary.

## 数据冲突检查
- **CRITICAL**: 不要在多个地方（图表、markdown表格、文本）重复相同的数据。每条数据只应出现一次。如果你已经添加了 `<dbd>` 图表，删除重复的 markdown 表格/文本。如果你已经添加了 markdown 表格，不要在文本描述中重复相同的数据。
- **IMPORTANT**: 如果数据出现在了 [Tools/Databrain Data]，那么该数据就生成了chart，不需要再生成markdown table了。
- **IMPORTANT**: 只使用有 `data_id` 的数据来生成图表，而不是生成 markdown 表格。
"""

# CHART_PROMPT_Deepseek: DeepSeek 复杂级别图表规则（完整版，包含数据冲突检查）
CHART_PROMPT_Deepseek = """
# 图表规范
- **IMPORTANT** Always add chart to support your answer when the tools return 'data_id'. If there are charts with the same data_id but different titles, return only one chart with a merged new title.
- 生成图表时按下面类HTML格式封装（保留英文标签）；不要单独添加一个可视化部分，只需在相应的内容后面加入图表即可；

<dbd>
    {
        "title": <图表标题>,
        "chart_type": <str: chat type, choose from trend, line, bar, flat_bar, etc. default is trend>,
        "data_id": <data_id>
    }
</dbd>

## 报告模板中的图表占位符处理
- 如果有数据可用，使用 `<dbd>` 标签生成实际图表；如果没有数据可用，完全省略它。永远不要包含 `[Chart: ...]` 作为占位符文本。

## Title rule
	1. Title must strictly reflect the actual metric name returned in Databrain CSV format columns name (e.g., MAU, DAU, Revenue, Downloads). Never replace or infer metrics not present in the data.
	- If the dataset has one metric, use that metric name; if it has two metrics, list both; if it has more than two metrics, use a general phrase like "key metrics" instead of listing metric names.
	2. Title should summarize the chart data, not the user's question.
	3. Each data_id can only have one title.
	4. Don't mention specific dates.
	5. If data contains multiple(more than two) platforms/sources/markets/regions, the title should use a general descriptor such as 'multi-platform'/'multi-source'/'multi-market'/'multi-region' in corresponding language instead of listing all platform names/sources/markets/regions; otherwise, use the exact game/platform/source/market/region from the data.
    6. For single game data, the title should mention the game name. Otherwise, don't mention game name in the title.

**IMPORTANT**: You MUST use the exact tag format <dbd> (no underscore, no space). Never add the same chart in the response multiple times even with different titles, chart with the same data_id should be used only ONCE in the output summary.

## 数据冲突检查
- **CRITICAL**: 在最终确定答案前，检查 markdown 表格/文本是否与工具结果（来自 Agent Results）或 `Tools/Databrain Data` (bidata) 重复。
- **如何检查**：
  1. **与工具结果比较**：检查 markdown 数据是否与 "Agent Results" 部分的工具调用结果重复
  2. **与 bidata 比较**：通过匹配指标名称、游戏名称、时间范围和 `databraindata_sample` 中的样本值，将 markdown 数据与 prompt 中的 `bidata` 进行比较
  3. **与 <dbd> 中的图表数据比较**：根据标题和 data_id 检查数据是否已发布在 <dbd> 中。理解标题的语法，而不是纯粹匹配文本内容。**只使用有 `data_id` 的数据来生成图表，而不是生成 markdown 表格。**
  4. **检查 [Tools/Databrain Data]**：如果数据出现在了 [Tools/Databrain Data]，那么该数据就生成了chart，不需要再生成markdown table了。
- **如果重复**：删除 markdown 表格/文本，只保留工具结果（来自 Agent Results）或通过 `<dbd>` 标签的图表。
- **仅在以下情况保留 markdown**：数据不在工具结果或 bi_data 中，或用于不同目的。
- **不确定时**：优先使用工具结果表示（来自 Agent Results 或图表）而不是 markdown，以避免重复。
"""

# 混合数据处理规则 - 重命名并优化
MIXED_DATA_PROMPT = """
# Mixed Data Processing Rules
- CRITICAL: This response contains mixed data from different services.
- For services that use tables only: {no_chart_services} - present data in table format, DO NOT generate <dbd> or any data_id.
- For services that require charts, only generate <dbd> and data_id if the data_id is real and exists in the source data.
- When processing mixed data:
  * For sections with "NO_CHART_PROMPT", "Do not generate chart", "leaderboard", or "榜单" keywords, present as markdown table only.
  * If unsure whether a service needs a chart, always prefer table format and DO NOT generate data_id.
- NEVER generate fake, placeholder, guessed, or formatted data_id values.
- You MUST only use data_id that you actually see in the source data. If you do not see a real data_id, DO NOT generate <dbd> or data_id at all.
- If you are not 100% sure the data_id is real, do NOT generate it.
- You will be strictly tested: generating any fake data_id will cause the task to fail.
"""

# ============================================================================
# Output Structure Rules - 不同级别版本
# ============================================================================

TABLE_DOWNLOAD_TAG = """

# Table Download Tag
- **CRITICAL: Table Download Tag**: You MUST add `<tid>data_id</tid>` tag when **either** (1) the Markdown table data is incomplete or partial (e.g., sampled, truncated, or data with missing values), **or** (2) the user explicitly asks for the data to be downloadable (e.g., "需要下载", "提供下载", "allow download"). This allows users to download the full dataset associated with that table.
- **CRITICAL: Tag placement**: Place `<tid>data_id</tid>` on the **line immediately above** the first table row (the line with the first `|`). No other content on that line. **DO NOT** place `<tid>` after the table, in the middle of text/paragraphs, in section headers, or at the end of the output.
- If the table corresponds to multiple `data_id` values, put all `<tid>data_id</tid>` tags on a single line immediately above the table, with no line breaks between tags.
- If the table data is complete (all data shown) **and** the user did not ask for download, do NOT add the `<tid>data_id</tid>` tag.
- If there is no `data_id` available for the table data, do not add the tag and the table will be downloaded as-is.
- Example format (single data_id, incomplete data):
```
<tid>intelligence_agent_12345</tid>
| Column1 | Column2 |
|---------|---------|
| Value1  | Value2  |
```
- Example format (multiple data_id, incomplete data):
```
<tid>intelligence_agent_12345</tid><tid>intelligence_agent_12346</tid>
| Column1 | Column2 |
|---------|---------|
| Value1  | Value2  |
```
"""

TABLE_DOWNLOAD_TAG_ZH = """

# 表格下载标签
- **CRITICAL: 表格下载标签**：在以下**任一**情况下必须添加 `<tid>data_id</tid>` 标签：(1) Markdown 表格数据不完整或部分（例如采样、截断或缺值），**或** (2) 用户明确要求数据可下载（如「需要下载」「提供下载」「allow download」）。这样用户可下载与该表格关联的完整数据集。
- **CRITICAL: 标签位置**：将 `<tid>data_id</tid>` 放在表格第一行（第一个 `|` 所在行）的**正上一行**，该行不要有其他内容。**禁止**在表格之后、段落中间、章节标题中或输出末尾放置 `<tid>`。
- 若表格对应多个 `data_id`，将所有 `<tid>data_id</tid>` 标签放在表格正上方同一行，标签之间不换行。
- 若表格数据已完整展示**且**用户未要求下载，则不要添加 `<tid>data_id</tid>` 标签。
- 若表格没有可用的 `data_id`，则不添加标签，表格将按原样下载。
- 示例格式（单个 data_id，数据不完整）：
```
<tid>intelligence_agent_12345</tid>
| 列1 | 列2 |
|-----|-----|
| 值1 | 值2 |
```
- 示例格式（多个 data_id，数据不完整）：
```
<tid>intelligence_agent_12345</tid><tid>intelligence_agent_12346</tid>
| 列1 | 列2 |
|-----|-----|
| 值1 | 值2 |
```
"""

# OUTPUT_STRUCTURE_PROMPT_SIMPLE: 简单级别（只包含格式要求，不含 tid；tid 与 chart 同逻辑在 get_output_prompt 中加载）
OUTPUT_STRUCTURE_PROMPT_SIMPLE = """
# Output Format Rules

You will answer the question in strictly Markdown format. The output must meet the following requirements:

1. Leading Conclusion
   - Start with a direct answer in 1-2 sentences (max 5 sentences), organized in one paragraph.
   - Do not include lists, titles like 'Conclusion', or data sources/provenance unless explicitly requested.
   - Use Markdown bold (**text**) to highlight numerical values/metrics.
   - DO NOT start with **.

2. Supporting Data
   - Use Markdown tables for numbers and metrics; do not use ellipsis.
   - Tables should be sorted by the most relevant column, following these rules:
     * For time-series data (monthly/weekly/daily trends), ALWAYS sort by date in chronological order (ascending: earliest date first, e.g., Jan → Dec). Never re-sort time-series rows by metric values.
     * For ranking/leaderboard data (top N games, highest revenue, etc.), sort by the primary metric descending.
     * For summary/aggregate data (avg, total across games or platforms), sort by game name or the most meaningful grouping dimension.
   - Use headings to organize content: # H1, ## H2, ### H3.

3. Output Constraints
   - No fabrication: do not invent precise numeric data.
   - Ensure Markdown table syntax is correct with proper column alignment.
   - Always respond in {language}, but do not translate HTML tags.
   - When precise numerical values provided, you MUST use these exact values in your summary.
   - **Do not repeat data**: If data already appears in [Tools/Databrain Data] (bidata) or in a `<dbd>` chart, do NOT generate a markdown table or duplicate the same data in text. Each piece of data should appear only once—either as chart or as table/text, not both.
  - **Agent results & links**: Include all meaningful agent results and subagent examples (links, quotes, [链接](url)); preserve link format. Do NOT attribute by agent name in the report (no blockquote like "> ... — Simplified Opinions Agent"); synthesize in your own narrative.
"""

# OUTPUT_STRUCTURE_PROMPT_MEDIUM: 中等级别（包含基础结构和格式要求，不含 tid）
OUTPUT_STRUCTURE_PROMPT_MEDIUM = """
# Output Structure Rules

You will answer the question in strictly Markdown format. The output must meet the following requirements:

0. Insight and Analysis Constraint
   - Provide insights, conclusions, or analysis ONLY if the user explicitly asks for them.
   - Otherwise, respond with factual statements strictly supported by the provided data/context.

1. Leading Conclusion
   - Start with a direct answer in 1-2 sentences (max 5 sentences), organized in one paragraph.
   - Do not include lists, titles like 'Conclusion', or data sources/provenance unless explicitly requested.
   - Always state the conclusion first, followed by reasoning and supporting data in subsequent sections.
   - Each point in the leading conclusion MUST be backed by corresponding evidence/data/support in a later subsection.
   - Highlighting Rules (CRITICAL):
     - Use Markdown bold (**text**) to highlight ONLY: (1) numerical values/metrics themselves.
     - **CRITICAL**: Do not bold the whole part.
     - **CRITICAL**: DO NOT bold the entire sentences or full paragraphs.
     - No spaces between `**` and the text (e.g., use `**text**`, NOT `** text**` or `**text **`).
     - Ensure proper syntax: `**text**` is correct; `**text` or `text**` or `** text **` are incorrect.
     - DO NOT start with **.
   - **CRITICAL: Be substantive and concise**: The conclusion must be meaningful and insightful, not just a list of all related products or items.

2. Supporting Data and Reasoning
   - Each subsection or argument point must follow the structure: **conclusion → reasoning → data support**.
   - Use Markdown tables for numbers and metrics; do not use ellipsis. Tables must have proper syntax and aligned columns.
   - Tables should be sorted by the most relevant column, following these rules:
     * For time-series data (monthly/weekly/daily trends), ALWAYS sort by date in chronological order (ascending: earliest date first, e.g., Jan → Dec). Never re-sort time-series rows by metric values.
     * For ranking/leaderboard data (top N games, highest revenue, etc.), sort by the primary metric descending.
     * For summary/aggregate data (avg, total across games or platforms), sort by game name or the most meaningful grouping dimension.
   - **Number Formatting**: Use thousand separators (commas) for numbers ≥ 1000. For large numbers, use abbreviations when appropriate.
   - **CRITICAL: Use Exact Values from Data Sources**: When Agent Results or Tools/Databrain Data provide precise numerical values, you MUST use these exact values in your summary. DO NOT convert precise values to ranges or intervals. Only use ranges/estimates when the source data explicitly provides ranges or when exact data is genuinely unavailable. Preserve the precision and accuracy of the original data.
   - **CRITICAL: Markdown table syntax compliance**: Table cell values must NOT contain characters that break Markdown table syntax:
     - Pipe character `|`: Replace with `/`
     - Line breaks/newlines: Replace with spaces or remove them to keep each cell on a single line
     - Multiple consecutive spaces: Normalize to single spaces

3. Technical & Analytical Friendliness
   - Use headings to organize content: # H1, ## H2, ### H3.
   - Add a horizontal rule (`---`) between different sections to visually separate them and improve readability.
   - Emphasize key points with bold (for numerical values, keywords, or short phrases up to 10 words) or *italic* formatting.

4. Output Constraints
   - No fabrication: do not invent precise numeric data. If exact data is unavailable, provide clearly labeled estimates/intervals and state assumptions.
   - **CRITICAL: Preserve Exact Values**: When source data (Agent Results or Tools/Databrain Data) contains precise numerical values, you MUST preserve and use these exact values. DO NOT convert them to ranges, intervals, or approximations. Only use ranges when the source data itself provides ranges or when data is genuinely missing.
  - **Agent results & links**: Include all meaningful agent results and subagent examples (links, quotes, [链接](url)); preserve link format. Do NOT attribute by agent name in the report (no blockquote like "> ... — Simplified Opinions Agent"); synthesize in your own narrative.
   - Ensure Markdown table syntax is correct with proper column alignment.
   - Always respond in {language}, but do not translate HTML tags.
"""

# OUTPUT_STRUCTURE_PROMPT: 复杂级别（完整版，不含 tid）
OUTPUT_STRUCTURE_PROMPT = """
# Output Structure Rules

You will answer the question in strictly Markdown format. The output must meet the following requirements:

1. Supporting Data and Reasoning
   - Each subsection or argument point must follow the structure: **conclusion → reasoning → data support**.
   - Use Markdown tables for numbers and metrics; do not use ellipsis. Tables must have proper syntax and aligned columns.
   - Tables should be sorted by the most relevant column, following these rules:
     * For time-series data (monthly/weekly/daily trends), ALWAYS sort by date in chronological order (ascending: earliest date first, e.g., Jan → Dec). Never re-sort time-series rows by metric values.
     * For ranking/leaderboard data (top N games, highest revenue, etc.), sort by the primary metric descending.
     * For summary/aggregate data (avg, total across games or platforms), sort by game name or the most meaningful grouping dimension.
   - **Number Formatting**: Use thousand separators (commas) for numbers ≥ 1000. For large numbers, use abbreviations when appropriate. Currency: $1,000 or USD 1,000. Percentages: 50% or 50.0% (be consistent). Decimals: typically 1-2 decimal places unless precision requires more.
   - **CRITICAL: Use Exact Values from Data Sources**: When Agent Results or Tools/Databrain Data provide precise numerical values, you MUST use these exact values in your summary. DO NOT convert precise values to ranges or intervals. Only use ranges/estimates when the source data explicitly provides ranges or when exact data is genuinely unavailable. Preserve the precision and accuracy of the original data.
   - **CRITICAL: Markdown table syntax compliance**: Table cell values must NOT contain characters that break Markdown table syntax:
     - Pipe character `|`: Replace with `/` or use full-width vertical bar `｜` if appropriate
     - Line breaks/newlines: Replace with spaces or remove them to keep each cell on a single line
     - Multiple consecutive spaces: Normalize to single spaces to maintain proper column alignment
     - Special characters: Ensure all characters in cell values are properly escaped or replaced if they conflict with Markdown syntax
     - Always validate that table syntax remains correct after any replacements
   - **CRITICAL - Today's Data Handling**: In the leading conclusion, if the time range includes today (current date), you MUST exclude today's data or explicitly mark it as "data still being collected today". Do NOT use today's lower values as basis for trend judgments (like "significantly dropped to X", "sharp decline"), as today's data is incomplete.

2. Clarity, Structure, and Presentation
   - Use headings to organize content: # H1, ## H2, ### H3.
   - Add a horizontal rule (`---`) between different sections to visually separate them and improve readability.
   - Do not use inconsistent spacing or mix `-` and `*`.
   - Emphasize key points SPARINGLY with bold (ONLY for the most critical numerical values, limit to 2-3 per section) or *italic* formatting. Do not bold entire sentences, long phrases, or keywords.
   - If charts are needed, embed them in the corresponding section instead of a separate visualization section.
   - Ensure the output is comprehensive, well-structured, and ready to copy-paste without reformatting.
   - Avoid unnecessary explanations or decorative symbols; keep each piece of information self-contained and logically clear.

3. Output Constraints
   - No fabrication: do not invent precise numeric data. If exact data is unavailable, provide clearly labeled estimates/intervals and state assumptions.
   - **CRITICAL: Preserve Exact Values**: When source data (Agent Results or Tools/Databrain Data) contains precise numerical values, you MUST preserve and use these exact values. DO NOT convert them to ranges, intervals, or approximations. Only use ranges when the source data itself provides ranges or when data is genuinely missing.
  - **Agent results & links**: Include all meaningful agent results and subagent examples (links, quotes, [链接](url)); preserve link format. Do NOT attribute by agent name in the report (no blockquote like "> ... — Simplified Opinions Agent"); synthesize in your own narrative.
   - Ensure Markdown table syntax is correct with proper column alignment.
   - Always respond in {language}, but do not translate HTML tags.

4. Answer Self-Check (internal)
   - For each <dbd> ID, ensure it is used only once in the output summary.
   - Avoid simply listing data and <dbd> charts together without context or reasoning.
   - Do not list data in markdown table and <dbd> charts in the same section.
"""

# ============================================================================
# DeepSeek 输出结构规则 - 不同级别版本（均不含 tid，tid 与 chart 同逻辑加载）
# ============================================================================

# OUTPUT_STRUCTURE_PROMPT_Deepseek_SIMPLE: DeepSeek 简单级别
OUTPUT_STRUCTURE_PROMPT_Deepseek_SIMPLE = """
# 输出格式规则

你将严格按照 Markdown 格式回答问题。输出必须满足以下要求：

1. 开头总结
   - 用 1-2 句话（最多 5 句）直接回答用户问题，以单段形式呈现。
   - 不要包含列表、标题如"结论"或数据来源，除非明确要求。
   - 使用 Markdown 粗体（**文本**）高亮数值/指标。

2. 支持数据
   - 使用 Markdown 表格展示数字和指标；不要使用省略号。
   - 表格应按最相关的列排序，遵循以下规则：
     * 时序数据（月度/周度/日度趋势）：**必须**按日期时间顺序排序（升序：最早日期在前，例如 Jan → Dec）。严禁按指标数值对时序行重新排序。
     * 排行榜/榜单数据（Top N 游戏、最高收入等）：按主要指标降序排序。
     * 汇总/聚合数据（跨游戏或平台的平均值、总量）：按游戏名称或最有意义的分组维度排序。
   - 使用标题组织内容：# H1, ## H2, ### H3。

3. 输出约束
   - 禁止编造：不要编造精确的数值数据。
   - 确保 Markdown 表格语法正确，列对齐正确。
   - 始终用 {language} 回答，但不要翻译 HTML 标签。
   - **不要重复数据**：如果数据已出现在 [Tools/Databrain Data]（bidata）或 `<dbd>` 图表中，不要再生成 markdown 表格或在正文中重复相同数据。每条数据只出现一次——以图表或表格/文本一种形式呈现，不要同时出现。
   - **Agent 结果与链接**：包含所有有意义的 agent 结果与子 agent 示例（链接、引用、[链接](url)），保留链接格式。禁止在报告中按 agent 名标注来源（不要使用 "> ... — Simplified Opinions Agent" 这类 blockquote 格式）；用你自己的叙述综合呈现。
"""

# OUTPUT_STRUCTURE_PROMPT_Deepseek_MEDIUM: DeepSeek 中等级别
OUTPUT_STRUCTURE_PROMPT_Deepseek_MEDIUM = """
# 输出结构规则

你将严格按照 Markdown 格式回答问题。输出必须满足以下要求：

1. 开头总结
   - 用 1-2 句话（最多 5 句）直接回答用户问题，以单段形式呈现。
   - 不要包含列表、标题如"结论"或数据来源，除非明确要求。
   - 始终先陈述结论，然后在后续部分提供推理和支持数据。
   - 高亮规则（CRITICAL）：
     - 使用 Markdown 粗体（**文本**）仅高亮：(1) 数值/指标本身。
     - **CRITICAL**：不要将整段加粗。
     - **CRITICAL**：不要将整句话或整段加粗。
     - `**` 和文本之间不要有空格（例如，使用 `**文本**`，而不是 `** 文本**` 或 `**文本 **`）。
     - 确保语法正确：`**文本**` 是正确的；`**文本` 或 `文本**` 或 `** 文本 **` 是错误的。
     - 不要以 ** 开头。
   - **CRITICAL: 言之有物且简洁**：结论必须有意义且具有洞察力，不要只是列出所有相关产品或项目。

2. 支持数据和推理
   - 每个子部分或论点必须遵循结构：**结论 → 推理 → 数据支撑**。
   - 使用 Markdown 表格展示数字和指标；不要使用省略号。表格必须语法正确且列对齐。
   - 表格应按最相关的列排序，遵循以下规则：
     * 时序数据（月度/周度/日度趋势）：**必须**按日期时间顺序排序（升序：最早日期在前，例如 Jan → Dec）。严禁按指标数值对时序行重新排序。
     * 排行榜/榜单数据（Top N 游戏、最高收入等）：按主要指标降序排序。
     * 汇总/聚合数据（跨游戏或平台的平均值、总量）：按游戏名称或最有意义的分组维度排序。
   - **数字格式**：对于 ≥ 1000 的数字使用千位分隔符（逗号）。对于大数字，适当使用缩写。
   - **CRITICAL: 使用数据源中的精确数值**：当 Agent Results 或 Tools/Databrain Data 提供了精确的数值时，你必须在总结中使用这些精确数值。禁止将精确数值转换为范围或区间。只有在数据源明确提供范围或确实无法获得精确数据时，才使用范围/估计。保持原始数据的精度和准确性。
   - **CRITICAL: Markdown 表格语法合规性**：表格单元格的值不能包含破坏 Markdown 表格语法的字符：
     - 管道符 `|`：替换为 `/`
     - 换行符：替换为空格或删除，确保每个单元格保持单行
     - 多个连续空格：规范化为单个空格

3. 技术和分析友好性
   - 使用标题组织内容：# H1, ## H2, ### H3。
   - 在不同部分之间添加水平线（`---`）以视觉上分隔内容，提高可读性。
   - 使用粗体强调关键点（用于数值、关键词或最多 10 个词的短语）或 *斜体* 格式。

4. 输出约束
   - 禁止编造：不要编造精确的数值数据。如果无法获得确切数据，提供明确标记的估计/区间并说明假设。
   - **CRITICAL: 保持精确数值**：当数据源（Agent Results 或 Tools/Databrain Data）包含精确数值时，你必须保持并使用这些精确数值。禁止将它们转换为范围、区间或近似值。只有在数据源本身提供范围或数据确实缺失时，才使用范围。
   - **Agent 结果与链接**：包含所有有意义的 agent 结果与子 agent 示例（链接、引用、[链接](url)），保留链接格式。禁止在报告中按 agent 名标注来源（不要使用 "> ... — Simplified Opinions Agent" 这类 blockquote 格式）；用你自己的叙述综合呈现。
   - 确保 Markdown 表格语法正确，列对齐正确。
   - 始终用 {language} 回答，但不要翻译 HTML 标签。
"""

# OUTPUT_STRUCTURE_PROMPT_Deepseek: DeepSeek 复杂级别（完整版）
OUTPUT_STRUCTURE_PROMPT_Deepseek = """
# 总结规则
- **IMPORTANT** 在回答开始首先用一小段总结来简短、直接地回答用户问题（最多5句，1-2句最好，以单段形式呈现严禁分点罗列。结论中需包含关键数据，并且高亮直接回答用户问题的核心数字/信息，但在数据很多的时候不要全部列出，概括或者举例，详细数据在后面部分展示。禁止在前面添加"结论"等标题词也禁止将这段标粗）。
- **CRITICAL: 结论需言之有物**：结论必须有意义且具有洞察力，不要简单地罗列所有相关产品或项目。提供**总结**而非枚举所有内容，聚焦于最重要的发现和直接回答问题的关键洞察。
- 行文始终遵循"结论先行→论证过程→数据支撑"的结构模式，每个分论点或论证环节均需重复此框架。
- **IMPORTANT** 禁止编造、假设数据和无依据的结论
- You should highlight the key information or key data values in the context that is related to the user's question.
- You should include the ACTUAL data platform and limitation in the response.
- Always Answer in comprehensive way and well structured format.
- 如果答案包含2个及以上指标名称且数据点少于30个，使用markdown table展示，table内不能使用省略号，严格遵守markdown格式。1个指标名或者数据点超出30个的话，只使用chart with data_id展示，chart里面会提供数据明细，不需要文本或者table罗列。
- **表格排序**：表格应选择一个合理的列进行排序。根据上下文和用户问题选择最相关的列进行排序。
- **CRITICAL: Markdown 表格语法合规性**：表格单元格的值不能包含破坏 Markdown 表格语法的字符：
  * **管道符 `|`**：替换为 `/` 或使用全角竖线 `｜`（如果合适）
  * **换行符**：替换为空格或删除，确保每个单元格保持单行
  * **多个连续空格**：规范化为单个空格，以保持正确的列对齐
  * **特殊字符**：确保单元格值中的所有字符都正确转义或替换，避免与 Markdown 语法冲突
  * 始终验证替换后表格语法仍然正确
- **CRITICAL: 使用数据源中的精确数值**：当 Agent Results 或 Tools/Databrain Data 提供了精确的数值时，你必须在总结中使用这些精确数值。禁止将精确数值转换为范围或区间。只有在数据源明确提供范围或确实无法获得精确数据时，才使用范围/估计。保持原始数据的精度和准确性。

# 输出要求
1. 用{language}回答，使用markdown格式，按逻辑分节
2. 在不同 section 之间添加分隔线（`---`）以视觉上分隔内容，提高可读性
3. 输出简明扼要
4. **Agent 结果与链接**：包含所有有意义的 agent 结果与子 agent 示例（链接、引用、[链接](url)），保留链接格式。禁止在报告中按 agent 名标注来源（不要使用 "> ... — Simplified Opinions Agent" 这类 blockquote 格式）；用你自己的叙述综合呈现。
"""

# ============================================================================
# Output Format Rules - 不同级别版本
# ============================================================================

# OUTPUT_FORMAT_RULE_SIMPLE: 简单级别
OUTPUT_FORMAT_RULE_SIMPLE = "\nReturn in markdown format."

# OUTPUT_FORMAT_RULE_COMPLETE: 复杂级别（完整版）
OUTPUT_FORMAT_RULE_COMPLETE = "\nReturn in markdown format."

# OUTPUT_FORMAT_RULE: 默认使用 complete 版本（向后兼容）
OUTPUT_FORMAT_RULE = OUTPUT_FORMAT_RULE_COMPLETE

DATA_PRIORITY_PROMPT = "CRITICAL: Always use game metric data from Dashboard if available. Metric data from Intelligence is less accurate. "

NO_CHART_PROMPT = """\nAnswer in markdown table format, sorted by a reasonable column. Don't need to generate chart for this part of data. **IMPORTANT**: Ensure table cell values comply with Markdown syntax - replace pipe characters `|` with `/`, remove line breaks, and normalize spaces to prevent table parsing errors. """

SINGLE_GAME_METRIC_PROMPT = """Answer format in following order and sections:
## 1.  Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data (Always make the data coherent and reasonable.)
and then you can break down with details, answer in correct format and structure. (Don't simply list the data in the answer if you have provided <dbd> tag.)
Normally you will be provided with the data from Databrain and web search result, try to use the largest data as reasonable data to answer the user's question and make predictions based on the game domain knowledge.
You may need to sum up units/revenue for all platforms or make prediction based on the data.

Add chart here to support your answer if you use the data from Databrain. Only use the source you used.

"""

SINGLE_GAME_METRIC_PROMPT_NO_CHART = """Answer format in following order and sections:
## 1.  Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.(Note: Always highlight the key data points that answer the user's question and make predictions based on the game domain knowledge.)
and then you can break down with details, answer in correct format and structure.
Normally you will be provided with the data from Databrain and web search result, try to use the most reliable data to answer the user's question and make predictions based on the game domain knowledge.
(When multiple revenue/units data are provided, use the largest data as reasonable data to answer the user's question.)
- Information for the most recent day, week, or month with available data, and show the month-on-month (or period-on-period) growth rate.

"""

MULTI_GAME_METRIC_ALIGN_TO_RELEASE_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data. (Note: Always highlight the key data points that answer the user's question and make predictions based on the game domain knowledge.)
and then you can break down with details, answer in correct markdown table format and structure.

- Provide an overview of each game's performance during the specified period(Specify the time period for each game) along with comparative summaries.
- Generate a Markdown table to compare the performance of each game.
    header should include Game name, date range, first day metrics(expand to all metrics) and first month metrics(expand to all metrics)
    Columns of the table:
        - Game Name
        - Source
        - Date Range
        - Type
        - First Day Metrics（Expand to all metrics）
        - First Month Metrics（Expand to all metrics）
    Rules for metrics:
        1. **Mobile Games** (If available)
            - First Day: Active Users, Revenue, Downloads
            - First Month: Active Users, Revenue, Downloads
        2. **Steam Games**  （If available）
            - First Day: PCU, Units, Revenue
            - First Month: PCU, Units, Revenue
        3. **Non-Steam PC/Console Games** (If available)
            - First Day: DAU, Units, Revenue
            - First Month: Avg DAU, Units, Revenue

Add chart here to support your answer if possible.
Never use mermaid chart to generate chart.
"""

MULTI_GAME_METRIC_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data. (Note: Always highlight the key data points that answer the user's question and make predictions based on the game domain knowledge.)
and then you can break down with details, answer in correct markdown table format and structure.

- Provide an overview of each game's performance during the specified period(Specify the time period for each game), broken down by key metrics.
- For each game, present the most recent available daily, weekly, or monthly data, including the month-over-month (MoM) growth rate, with comparative summaries.
- For each game comparison, provide the comparative analysis in a markdown table format and using same source data. Only same source is allowed to compare. Add source and date range in the table.

Add chart here to support your answer if possible.

"""

MULTI_GAME_METRIC_PROMPT_NO_CHART = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data. (Note: Always highlight the key data points that answer the user's question and make predictions based on the game domain knowledge.)
and then you can break down with details, answer in correct markdown table format and structure.

- Provide an overview of each game's performance during the specified period, broken down by key metrics.
- For each game, present the most recent available daily, weekly, or monthly data, including the month-over-month (MoM) growth rate, with comparative summaries.

"""

TOP_CHART_SUMMARY_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.
and then you can break down with details, answer in correct markdown table format and structure.

- Identify the top 3 games(if needed) in the ranking and summarize their overall performance during the specified period, breaking down key metrics such as average, maximum, etc.
- Provide the most recent available daily, weekly, or monthly data, along with the month-over-month growth rate.
No Chart for current part of data. Return in markdown table format, sorted by a reasonable column.
## 2. Trend Rules:
- Assess whether the list of leading games reflects regional or genre preferences.
- For steam performance, order by units, pcu, revenue, etc.
- For other platforms, order by download, revenue, etc.
"""

LEADERBOARD_SUMMARY_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.
and then you can break down with details, answer in correct markdown table format and structure.

- First highlight any major ranking changes in the leaderboards. For example, which game ranks have moved up, moved down, or newly entered the top list.
    - If the ranking is not changed, use "-" to indicate no change in ranking.
    - For new entries(considering the change rank) to the top list, Add "New Entry" to indicate the game is new in the ranking.
- Then select the top N games from the relevant ranking and present them in a table format.
    - The table columns should include: Rank, Game Name, and Ranking Change.
- For multiple dates, highlight the latest date's ranking changes and specify the date.
## 2. Trend Rules:
- Assess whether the list of leading games reflects regional or genre preferences.
"""

MARKET_METRICS_SUMMARY_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
- Summarize the overall performance for the specified time period, broken down by metric.
- State the percentage change compared to the previous period within the given timeframe.
{newzoo_summary}


Add chart to support your answer if possible.

## 3. Trend Analysis:
- Present the top 10 games in the region’s game market, their revenue, and market share, and summarize the characteristics of the competitive landscape.

Note: Specify the data source for the data you provided as you will use multiple data sources which may provide conflicting data.
"""
MARKET_METRICS_SUMMARY_PROMPT_NO_CHART = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.
and then you can break down with details, answer in correct markdown table format and structure.

- Summarize the overall performance for the specified time period, broken down by metric.
- State the percentage change compared to the previous period within the given timeframe.
{newzoo_summary}

## 2. Trend Analysis:
- Present the top 10 games in the region’s game market, their revenue, and market share, and summarize the characteristics of the competitive landscape.

Note: Specify the data source for the data you provided as you will use multiple data sources which may provide conflicting data.
"""

GENRE_METRICS_SUMMARY_PROMPT = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.
and then you can break down with details, answer in correct markdown table format and structure.

- Summarize the overall performance for the specified time period, broken down by metric with the data source you provided.
- State the percentage change compared to the previous period within the given timeframe.
{newzoo_summary}

## 2. Charts:
Add chart to support your answer if possible.

## 3. Trend Analysis
- Present the top 10 games in the category’s game market, their revenue, and market share, and summarize the characteristics of the competitive landscape.


Note: Specify the data source for the data you provided as you will use multiple data sources which may provide conflicting data.
"""

GENRE_METRICS_SUMMARY_PROMPT_NO_CHART = """Answer format in following order and sections:
## 1. Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.
and then you can break down with details, answer in correct markdown table format and structure.

- Summarize the overall performance for the specified time period, broken down by metric with the data source you provided.
- State the percentage change compared to the previous period within the given timeframe.
{newzoo_summary}

## 2. Trend Analysis
- Present the top 10 games in the category’s game market, their revenue, and market share, and summarize the characteristics of the competitive landscape.


Note: Specify the data source for the data you provided as you will use multiple data sources which may provide conflicting data.
"""

# Base prompt for game info summary (without metrics tool guidance)
GAME_INFO_SUMMARY_PROMPT_BASE = """
## Extra Summary Info:
If user query for mobile/pc/console game info and not specifically ask for certain information, Answer with following parts:
- Game Description + release date
- Cover image if available in a new line
- Genre info with main and sub genre
- Sensortower tags or (Steam tags and Steam Game Mode if available). You need to specify the source of the tags.
- Similar apps (first 5)
- Latest Timeline
- Publisher & Developer and other key info
Note: present the information in a comprehensive way and well structured format without markdown table for this part.
"""

# Additional prompt when metrics_query_tool is available
# This prompt should ONLY be appended when the metrics tool is actually enabled
GAME_INFO_METRICS_TOOL_PROMPT = """
---------
IMPORTANT: For query for game/company metrics such as revenue, downloads, units, sales, etc., you MUST use corresponding metric search tool to get the metrics data as it is most accurate data.
"""

# Default combined prompt (for backward compatibility where tool availability is unknown)
# NOTE: Prefer using GAME_INFO_SUMMARY_PROMPT_BASE + conditional GAME_INFO_METRICS_TOOL_PROMPT
GAME_INFO_SUMMARY_PROMPT = GAME_INFO_SUMMARY_PROMPT_BASE + GAME_INFO_METRICS_TOOL_PROMPT

SINGLE_COMPANY_METRIC_PROMPT = """Answer format in following order and sections:
## 1.  Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data (Always make the data coherent and reasonable.)
and then you can break down with details, answer in correct format and structure. (Don't simply list the data in the answer if you have provided <dbd> tag.)
Normally you will be provided with the data from Databrain and web search result, try to use the largest data as reasonable data to answer the user's question and make predictions based on the game domain knowledge.
You may need to sum up units/revenue for all platforms or make prediction based on the data.

Add chart here to support your answer if you use the data from Databrain. Only use the source you used.

"""

SINGLE_COMPANY_METRIC_PROMPT_NO_CHART = """Answer format in following order and sections:
## 1.  Summary Rules:
Try your best to answer the user's question directly in 1-4 sentences with the data you provided or web search result and most reliable data.(Note: Always highlight the key data points that answer the user's question and make predictions based on the game domain knowledge.)
and then you can break down with details, answer in correct format and structure.
Normally you will be provided with the data from Databrain and web search result, try to use the most reliable data to answer the user's question and make predictions based on the game domain knowledge.
(When multiple revenue/units data are provided, use the largest data as reasonable data to answer the user's question.)
- Information for the most recent day, week, or month with available data, and show the month-on-month (or period-on-period) growth rate.

"""

DATA_DESCRIBE_PROMPT = """
Write the description of the data sources or metrics within **50 words** according to the data information provided.
Return in {context_language}.
"""

REFERENCE_FILTER_PROMPT = """
You are a professional reference quality assessment expert. Analyze the user query and the following web reference list to determine which references should be filtered out (irrelevant, low-quality, ads, etc.).

The input will be a JSON object containing:
- user_query: The user's query
- references_list: A numbered list of web references with URL and Title

Please evaluate the quality of each reference, considering:
1. Whether the reference content is relevant to the user query
2. Whether the reference source is reliable (avoid ads, spam sites, low-quality content)
3. Whether the reference title is clear and meaningful

Output Format: Only output the reference numbers (1-based) that should be filtered out, separated by commas. For example: 2,4,6
If all references should be kept, output: none
If all references should be filtered, output: all

Only output numbers, no other content.
"""

# ============================================================================
# Report Template Optimization Prompts
# ============================================================================

REPORT_TEMPLATE_OPTIMIZATION_SYSTEM_PROMPT = """You are a report template optimizer. Your task is to optimize the report template based on the planner agent's output (user question, expanded sub-questions, reasoning, and plans).

Your goal is to:
1. **Reduce and merge sections**: Prefer fewer, more substantial sections. Target roughly 3–6 main sections plus Abstract (not 7+ small sections). Merge related topics into one section (e.g. "Trend Analysis" + "Growth Analysis" → "Trend and Growth Analysis").
2. **Avoid shallow sections**: Remove or merge any section that would likely yield only 1–2 sentences. Each remaining section should warrant at least a short paragraph or several bullet points of real analysis.
3. Adapt the template structure to better match the specific analysis questions and ensure expanded sub-questions are covered (they can be addressed within merged sections).
4. Keep the template structure clear: each section title should indicate substantial content (e.g. "Trend and Growth Analysis" with sub-points), not many one-line fill-ins.
5. Maintain the original template's intent while making it more specific to this query and more concise in structure.
6. Prefer the user's wording: Use the same phrasing and key terms from `user question` when creating or adjusting section titles and labels. Avoid introducing synonyms that could shift meaning.

Return ONLY the optimized report template, without any additional explanation or commentary."""

REPORT_TEMPLATE_OPTIMIZATION_USER_PROMPT = """# Original Report Template for {identified_scene}
{report_template}

# Planner Agent Output
## User Question
{user_question}

## Reasoning
{reasoning}

## Expanded Sub-questions
{expanded_questions_text}

## Analysis Plans
{plans_text}

# Task
Please optimize the report template above based on the planner agent's output (reasoning, plans, and expanded sub-questions).
- **Merge and reduce sections**: Aim for 3–6 main sections plus Abstract. Merge related sections (e.g. trend + growth, or multiple small "analysis" sections into one with sub-points) so that each section can support substantial content.
- **Remove shallow sections**: Drop or merge sections that would likely result in only 1–2 sentences; keep only sections that can be filled with meaningful analysis (multiple sentences or clear sub-points).
- Make the template more specific to this query. Ensure expanded sub-questions are covered within the reduced section set. Return ONLY the optimized report template."""

# ============================================================================
# Reflection Prompt - 不同版本
# ============================================================================

# REFLECTION_PROMPT: 标准版本（英文）
REFLECTION_PROMPT = """
# Reflection and Self-Check
## Answer Completeness Check
- **CRITICAL**: Before finalizing, evaluate whether your answer sufficiently addresses the user's question.
- **Check if missing**:
  - Key information required to answer the question
  - Recent data or updates not available in the provided context
  - Context or background information needed for a complete answer
  - Comparative data or industry benchmarks
- **If insufficient**: Use `websearch_tool` to search the Internet for additional information to complete your answer.
- **After web search**: Integrate the search results into your answer to provide a comprehensive response.
"""

# REFLECTION_PROMPT_Deepseek: DeepSeek 版本（中文）
REFLECTION_PROMPT_Deepseek = """
# 反思和自我检查
## 答案完整性检查
- **CRITICAL**: 在最终确定答案前，评估你的答案是否充分回答了用户的问题。
- **检查是否缺失**：
  - 回答问题所需的关键信息
  - 提供上下文中不可用的最新数据或更新
  - 完整答案所需的上下文或背景信息
  - 比较数据或行业基准
- **如果不足**：使用 `websearch_tool` 搜索互联网以获取额外信息来完成你的答案。
- **网络搜索后**：将搜索结果整合到你的答案中，以提供全面的回答。
"""


def get_summary_prompt_level(context: GameContext) -> str:
    """
    根据 mode 和 intention 确定 Summary Prompt Level

    分类规则（根据 SUMMARY_AGENT.md 文档）:
    - fastqa mode, intention 0,1 → easy
    - fastqa mode, intention 2 → medium
    - deepthink mode, 任何intention → complete
    - auto mode, intention 0,1 → easy
    - auto mode, intention 2 → medium

    注意：UserIntention 枚举值：
    - UserIntention.Intention0.value = 0 (Others)
    - UserIntention.Easy.value = 1 (Easy)
    - UserIntention.Hard.value = 2 (Simple game data retrieval query)
    - intention = 3 (Hard question，不在枚举中，但可能出现在代码中)

    Args:
        context: GameContext对象，包含mode和planner_context.intention

    Returns:
        str: Summary Prompt Level ("easy", "medium", 或 "complete")
    """
    mode = context.mode
    intention = context.planner_context.intention if hasattr(context.planner_context, 'intention') else -1

    # deepthink mode: 任何intention都是complete
    if mode == DatabrainMode.Deepthink.value:
        return "complete"

    # fastqa 和 auto mode: 根据intention确定
    if mode in [DatabrainMode.Fastqa.value, DatabrainMode.Auto.value]:
        # intention 0 (Intention0) 或 1 (Easy): easy
        if intention in [0, 1, UserIntention.Intention0.value, UserIntention.Easy.value]:
            return "easy"
        # intention 2 (Hard，对应文档中的 Simple game data retrieval query): medium
        elif intention == 2 or intention == UserIntention.Hard.value:
            return "medium"
        # 其他情况（如intention=-1或3）: 根据模式默认处理
        # fastqa/auto mode下，intention=-1或3的情况，根据文档应该使用medium（因为需要一定分析）
        else:
            return "medium"

    # 默认情况：返回medium
    return "medium"


def get_output_prompt(agent: Agent[GameContext], context: GameContext, is_summary=False, has_charts: Union[bool, str, None] = None, model_type=None,
                      prefix_prompt='') -> str:
    """
    统一的输出prompt构建函数，根据汇总模式、数据类型、模型类型选择合适的prompt

    Args:
        context: GameContext对象，包含chart_generation_map等信息
        is_summary: 是否为汇总模式，True时使用完整的输出prompt，False时使用基础格式规则
        has_charts: 图表需求类型，可选值：
            - True: 需要图表（等同于'all'）
            - False: 不需要图表（等同于'none'）
            - 'all': 全部服务都需要图表
            - 'partial': 部分服务需要图表，部分不需要
            - 'none': 全部服务都不需要图表
            - None or 'auto': 自动从context.chart_generation_map推断
        model_type: 模型类型，'deepseek'时使用DeepSeek专用prompt，其他使用标准prompt
        prefix_prompt: 前缀prompt，会添加到prompt前面

    Returns:
        str: 构建好的输出prompt字符串
    """
    if getattr(agent, "skip_output_prompt", False):
        return ""

    # 执行 Agent：magic poster / excel 下仅负责拿数据
    if not is_summary and context.data_only_mode:
        return "Your main responsibility is to provide data to user. If data is fetched, output exactly `success`; otherwise output exactly `fail`."

    # Summary：magic poster 下只做简单总结，输出简化版报告
    if is_summary and context.use_magic_poster:
        # 这里复用简单级别的结构与格式规则
        return prefix_prompt + OUTPUT_STRUCTURE_PROMPT_SIMPLE + OUTPUT_FORMAT_RULE_SIMPLE

    # ============================================================================
    # Summary Prompt Level 分级逻辑
    # ============================================================================
    # 根据 mode 和 intention 确定 Summary Prompt Level，并选择对应的 prompt 版本
    #
    # 分级规则（适用于标准模型和 DeepSeek 模型）:
    # - Easy level (fastqa/auto mode, intention 0,1):
    #   * 标准模型：CHART_PROMPT_MEDIUM, OUTPUT_STRUCTURE_PROMPT_SIMPLE, OUTPUT_FORMAT_RULE_SIMPLE
    #   * DeepSeek模型：CHART_PROMPT_Deepseek_MEDIUM, OUTPUT_STRUCTURE_PROMPT_Deepseek_SIMPLE, OUTPUT_FORMAT_RULE_SIMPLE
    #   * 不包含 DATA_PRIORITY_PROMPT
    #   * 不包含 REFLECTION_PROMPT
    # - Medium level (fastqa/auto mode, intention 2):
    #   * 标准模型：CHART_PROMPT_MEDIUM, OUTPUT_STRUCTURE_PROMPT_MEDIUM, OUTPUT_FORMAT_RULE_COMPLETE
    #   * DeepSeek模型：CHART_PROMPT_Deepseek_MEDIUM, OUTPUT_STRUCTURE_PROMPT_Deepseek_MEDIUM, OUTPUT_FORMAT_RULE_COMPLETE
    #   * 包含 DATA_PRIORITY_PROMPT（如果多数据源）
    #   * 包含 REFLECTION_PROMPT（标准模型用英文版，DeepSeek用中文版）
    # - Complete level (deepthink mode, 任何intention):
    #   * 标准模型：CHART_PROMPT, OUTPUT_STRUCTURE_PROMPT, OUTPUT_FORMAT_RULE_COMPLETE
    #   * DeepSeek模型：CHART_PROMPT_Deepseek, OUTPUT_STRUCTURE_PROMPT_Deepseek, OUTPUT_FORMAT_RULE_COMPLETE
    #   * 包含 DATA_PRIORITY_PROMPT（如果多数据源）
    #   * 包含 REFLECTION_PROMPT（标准模型用英文版，DeepSeek用中文版）
    # ============================================================================
    summary_prompt_level = get_summary_prompt_level(context)

    # 判断是否包含 REFLECTION_PROMPT
    include_reflection = (summary_prompt_level in ["medium", "complete"])

    # 向后兼容：如果 intention 是 3 (hard question)，也包含 REFLECTION_PROMPT
    # 注意：UserIntention.Hard.value 是 2（对应文档中的 Simple game data retrieval query）
    # 但根据文档，intention=3 才是 hard question，应该使用 complete level
    if not include_reflection:
        intention = context.planner_context.intention if hasattr(context.planner_context, 'intention') else -1
        # intention = 3 (hard question) 时包含 REFLECTION_PROMPT（使用 complete level）
        if intention == 3:
            include_reflection = True
            summary_prompt_level = "complete"  # 强制使用 complete level

    # 判断是否有多数据源（Dashboard 和 Intelligence 都有数据）
    # 注意：has_dashboard_data_list 和 has_intelligence_data_list 在 GameContext 中
    has_dashboard_data = (
        hasattr(context, 'has_dashboard_data_list') and
        len(context.has_dashboard_data_list) > 0
    ) if hasattr(context, 'has_dashboard_data_list') else False

    has_intelligence_data = (
        hasattr(context, 'has_intelligence_data_list') and
        len(context.has_intelligence_data_list) > 0
    ) if hasattr(context, 'has_intelligence_data_list') else False

    has_multiple_data_sources = has_dashboard_data and has_intelligence_data

    # 根据 level 决定是否包含 DATA_PRIORITY_PROMPT
    include_data_priority = (
        summary_prompt_level in ["medium", "complete"] and
        has_multiple_data_sources
    )

    # 自动推断数据类型（如果未指定）
    if has_charts is None or has_charts == 'auto':
        # 分类服务：带图服务 vs 不带图服务
        chart_services = [name for name, needs_chart in context.chart_generation_map.items() if needs_chart]
        no_chart_services = [name for name, needs_chart in context.chart_generation_map.items() if not needs_chart]

        # 根据服务组合确定数据类型
        if chart_services and no_chart_services:
            has_charts = 'partial'  # 部分服务需要图表，部分不需要
        elif chart_services:
            has_charts = 'all'  # 全部服务都需要图表
        elif no_chart_services:
            has_charts = 'none'  # 全部服务都不需要图表
        else:
            has_charts = 'none'  # 无服务，默认为不需要图表
    elif isinstance(has_charts, bool):
        has_charts = 'all' if has_charts else 'none'

    # file 输出走专用下载/Excel 链路，不在 prompt 中要求 TABLE_DOWNLOAD 标签
    include_table_download_tag = (
        getattr(context.planner_context, 'display_format', '') != 'file'
    )

    if is_summary:
        # 汇总模式：按组件组合构建prompt
        output_prompt = prefix_prompt

        # 根据 level 选择对应的 prompt 版本
        if summary_prompt_level == "easy":
            # Easy level: 使用简化版本
            chart_prompt = CHART_PROMPT_MEDIUM
            output_structure_prompt = OUTPUT_STRUCTURE_PROMPT_SIMPLE
            output_format_rule = OUTPUT_FORMAT_RULE_SIMPLE
        elif summary_prompt_level == "medium":
            # Medium level: 使用中等版本
            chart_prompt = CHART_PROMPT_MEDIUM
            output_structure_prompt = OUTPUT_STRUCTURE_PROMPT_MEDIUM
            output_format_rule = OUTPUT_FORMAT_RULE_COMPLETE
        else:  # complete
            # Complete level: 使用完整版本
            chart_prompt = CHART_PROMPT
            output_structure_prompt = OUTPUT_STRUCTURE_PROMPT
            output_format_rule = OUTPUT_FORMAT_RULE_COMPLETE

        # 1. 先判断 model_type，选择对应的组件
        if model_type == 'deepseek':
            # DeepSeek 模型分支：根据 level 选择对应的 DeepSeek prompt 版本
            # 根据 level 选择对应的 DeepSeek prompt 版本
            if summary_prompt_level == "easy":
                # Easy level: 使用简化版本
                chart_prompt_deepseek = CHART_PROMPT_Deepseek_MEDIUM
                output_structure_prompt_deepseek = OUTPUT_STRUCTURE_PROMPT_Deepseek_SIMPLE
            elif summary_prompt_level == "medium":
                # Medium level: 使用中等版本
                chart_prompt_deepseek = CHART_PROMPT_Deepseek_MEDIUM
                output_structure_prompt_deepseek = OUTPUT_STRUCTURE_PROMPT_Deepseek_MEDIUM
            else:  # complete
                # Complete level: 使用完整版本
                chart_prompt_deepseek = CHART_PROMPT_Deepseek
                output_structure_prompt_deepseek = OUTPUT_STRUCTURE_PROMPT_Deepseek

            # 添加 DATA_PRIORITY_PROMPT（如果多数据源且 level >= medium）
            if include_data_priority:
                output_prompt += DATA_PRIORITY_PROMPT

            if has_charts == 'partial':
                # 部分服务需要图表：添加混合数据指令和图表规则
                no_chart_services = [name for name, needs_chart in context.chart_generation_map.items() if
                                     not needs_chart]
                no_chart_services_str = ", ".join(no_chart_services) if no_chart_services else "none"
                output_prompt += MIXED_DATA_PROMPT.format(no_chart_services=no_chart_services_str)
                output_prompt += chart_prompt_deepseek
                if include_table_download_tag:
                    output_prompt += TABLE_DOWNLOAD_TAG_ZH  # tid 与 chart 同逻辑加载
            elif has_charts == 'all':
                # 全部服务都需要图表：添加图表规则
                output_prompt += chart_prompt_deepseek
                if include_table_download_tag:
                    output_prompt += TABLE_DOWNLOAD_TAG_ZH  # tid 与 chart 同逻辑加载

            # 添加 OUTPUT_STRUCTURE_PROMPT（根据 level 选择对应版本）
            output_prompt += output_structure_prompt_deepseek.format(language=context.language)

            # 根据 Summary Prompt Level 添加反思提示（使用 DeepSeek 中文版本）
            if include_reflection:
                output_prompt += REFLECTION_PROMPT_Deepseek
        else:
            # 标准模型分支
            # 添加 DATA_PRIORITY_PROMPT（如果多数据源且 level >= medium）
            if include_data_priority:
                output_prompt += DATA_PRIORITY_PROMPT

            if has_charts == 'partial':
                # 部分服务需要图表：添加混合数据指令和图表规则
                no_chart_services = [name for name, needs_chart in context.chart_generation_map.items() if
                                     not needs_chart]
                no_chart_services_str = ", ".join(no_chart_services) if no_chart_services else "none"
                output_prompt += MIXED_DATA_PROMPT.format(no_chart_services=no_chart_services_str)
                output_prompt += chart_prompt
                if include_table_download_tag:
                    output_prompt += TABLE_DOWNLOAD_TAG  # tid 与 chart 同逻辑加载
            elif has_charts == 'all':
                # 全部服务都需要图表：添加图表规则
                output_prompt += chart_prompt
                if include_table_download_tag:
                    output_prompt += TABLE_DOWNLOAD_TAG  # tid 与 chart 同逻辑加载

            # 添加 OUTPUT_STRUCTURE_PROMPT（根据 level 选择对应版本）
            output_prompt += output_structure_prompt.format(language=context.language)

            # 根据 Summary Prompt Level 添加反思提示
            if include_reflection:
                output_prompt += REFLECTION_PROMPT

        # 2. 添加 OUTPUT_FORMAT_RULE（根据 level 选择对应版本）
        output_prompt += output_format_rule
        if not has_charts:
            output_prompt += 'Never use mermaid chart to generate chart.'
        return output_prompt
    else:
        # 非汇总模式：使用基础格式规则
        return prefix_prompt + OUTPUT_FORMAT_RULE_SIMPLE

# ============================================================================
# Summary Input Prompt Templates (User Message)
# ============================================================================

REFLECTION_SECTION_TEMPLATE = """
# Reflection Review (IMPORTANT)
The Reflection Agent has reviewed the agent results and provided the following actionable feedback:

{reflection_output}

**CRITICAL INSTRUCTIONS**:
1. **Prioritize HIGH Priority Items**: Focus first on implementing all HIGH priority actionable points and incorporating HIGH priority additional information
2. **Follow Actionable Points**: Implement recommendations from the "Actionable Points for Summary Agent" section, prioritizing HIGH > MEDIUM > LOW
3. **Use Additional Information**: If the reflection includes "Additional Information Found" (from web search), incorporate that information into your summary, prioritizing HIGH priority items
4. **Address Missing Aspects** (only when feasible): Address aspects listed as "Missing or Incomplete" only if you have supporting data. Do NOT include or emphasize aspects that could not be accomplished (e.g. failed analyses, missing data that was not found, errors). Omit unaccomplished items from the summary.
5. **Improve Based on Feedback**: Enhance the analysis depth, clarity, and accuracy as suggested in the actionable points
6. **Provide a Comprehensive Answer**: Ensure all expanded sub-questions that have supporting evidence are fully addressed. Focus on accomplished results; do not describe or emphasize what failed or could not be done

"""

SUMMARY_INPUT_PROMPT_TEMPLATE = """# User Question
{user_question}
{expanded_questions_section}
# Agent Results
{agent_results}
{reflection_section}
# Tools/Databrain Data
{bidata_text}
{report_template_section}

**IMPORTANT**:
1. For trend prediction, try to give some statistical prediction rather than simply expressing in text (data support is very important).
2. **Do not show source attribution in the report**: Do NOT output "（来源: ...）", "— Agent Name", or blockquote with agent attribution (e.g. no "> ... — Simplified Opinions Agent"). Synthesize in your own narrative.
3. **No filler when evidence is lacking**: If a report template section has no supporting data or evidence in Agent Results or Tools/Databrain Data, omit that section entirely. Do NOT write generic or shallow content, and do NOT add a placeholder line. Just skip the section.
4. **Omit unaccomplished tasks**: Do NOT include descriptions of analyses or tasks that failed or could not be completed (e.g. missing data, module not installed, errors). Only present what was successfully done with supporting evidence. If Analyst Agent or other agents report failures (e.g. "PUR data missing", "statsmodels not available", "sample size insufficient"), do not repeat or emphasize these in the summary; omit them and focus on the accomplished results.
4. **Substantial content per section**: Each section you keep should contain meaningful analysis (multiple sentences or clear sub-points with data/insight). Avoid one- or two-sentence sections—either expand with evidence and insight, or merge the point into a related section. Prefer depth over breadth: fewer sections with real insight are better than many shallow sections.
5. **Prediction/Estimation disclaimer**: If your answer involves prediction (e.g. trend forecast, future performance), estimation (e.g. approximate figures, extrapolation from partial data), or scenarios that are not fully backed by verified historical data, you MUST append a short disclaimer at the end of the report. Use the following (adapt to {language} if needed): "以上答案为基于现有数据的简单预测与估算，仅供参考，不能作为投资决策、业务决策或正式报告的依据。" (English equivalent: "The above answer is based on simple prediction and estimation from available data, for reference only, and should not be used as a basis for investment decisions, business decisions, or formal reporting.")

Please generate a comprehensive analysis report based on the above information. You MUST answer in {language}."""

def build_summary_input_prompt(
    user_question: str,
    expanded_questions: List[str],
    agent_results: str,
    bidata_text: str,
    report_template_section: str,
    language: str,
    reflection_output: str = "",
) -> str:
    """
    构建 Summary Agent 的输入 prompt (user message)

    类似于 build_workflow_report_prompt()，但用于 deepthink 模式

    Args:
        user_question: 用户问题
        expanded_questions: 扩展的子问题列表
        agent_results: 格式化的 agent 结果
        bidata_text: 格式化的 bidata 文本
        report_template_section: 报告模板部分
        language: 语言
        reflection_output: Reflection Agent 的输出（可选）

    Returns:
        完整的 summary input prompt
    """
    # 格式化 expanded_questions
    if expanded_questions:
        expanded_questions_text = "\n".join([f"{idx}. {q}" for idx, q in enumerate(expanded_questions, 1)])
        expanded_questions_section = f"# Expanded Sub-questions\n{expanded_questions_text}\n"
    else:
        expanded_questions_section = ""

    # 根据是否有 reflection_output 决定是否添加 reflection_section
    if reflection_output:
        reflection_section = REFLECTION_SECTION_TEMPLATE.format(reflection_output=reflection_output)
    else:
        reflection_section = ""

    # 格式化 report_template_section（如果没有，使用空字符串）
    if report_template_section:
        # 如果 report_template_section 已经包含标题，直接使用；否则添加标题
        if "Report Template" in report_template_section or "report template" in report_template_section:
            formatted_report_template = report_template_section
        else:
            formatted_report_template = f"Below is the report template for the scene:\n{report_template_section}"
    else:
        formatted_report_template = ""

    return SUMMARY_INPUT_PROMPT_TEMPLATE.format(
        user_question=user_question,
        expanded_questions_section=expanded_questions_section,
        agent_results=agent_results,
        reflection_section=reflection_section,
        bidata_text=bidata_text,
        report_template_section=formatted_report_template,
        language=language
    )

# ---------------------------------------------------------------------------
# Poster layout prompts (internal feature name omitted)
# ---------------------------------------------------------------------------
magic_poster_base_prompt = """
# Poster Summary Base Instructions

You are a summary agent preparing analysis for a data‑driven poster layout. Your role in this conversation:
1. Core responsibility
   - Carefully read the user question, all sub‑agent outputs, and the key data/metrics.
   - Identify the most important metrics, trends, and conclusions that are suitable to appear on a data poster.
   - Do NOT introduce facts or analysis that are not supported by the provided results or data.
2. Use of data
   - When Agent Results or Tools/Databrain Data provide precise numerical values, you MUST use these exact values in your reasoning.
   - Do not convert precise values into vague ranges unless the source itself only provides ranges.
   - If a metric is missing, clearly treat it as “no data available” rather than guessing.
3. Language and format
   - Always answer in {context.context.language}.
  - The poster will later visualize the numbers you select here, so choose metrics that are both accurate and meaningful for a high‑level poster view (e.g. recent DAU, growth rates, key comparative figures).
4. Style of the written summary
   - Use neutral, objective, data‑driven language only.
   - Do NOT write marketing copy, slogans, catchy titles, or emotional/creative phrasing.
   - Do NOT describe any visual style, mood, color, atmosphere, or “feeling” of the poster in the text answer.
"""

MAGIC_POSTER_SUMMARY_INSTRUCTION = """

Poster layout requirements (Important):

In this conversation, the poster layout generation capability is enabled. In addition to producing a normal summary, you must also generate a piece of markdown that describes the poster layout for downstream image generation.

Overall procedure:

1. **First complete your internal summary and analysis**  
   - Carefully read and understand: the user’s question, the outputs of all sub‑agents, and the key data and conclusions.  
   - During your chain-of-thought, first form a clear, structured analysis (you can organize which metrics, trends, and conclusions should be highlighted) to prepare for generating the layout.

2. **Output the final natural‑language summary to the user**  
   - Answer the user’s question normally, giving clear, objective conclusions and the necessary reasoning, using neutral analytical language.  
   - Do NOT include any visual style, mood, aesthetic description, or marketing/creative copy in this summary; focus only on facts, metrics, and analytical conclusions.

Please strictly follow the above procedure: first complete the analysis → then call the Generate Markdown Tool to generate the layout markdown → finally output the natural‑language summary to the user, clearly indicating whether poster generation will proceed to generate an image.
"""


def apply_magic_poster_instruction_if_needed(context, base_prompt: str) -> str:
    """
    根据上下文判断是否需要附加 Magic Poster 相关的 tool 指引。

    约定：当 GameContext.planner_context.use_magic_poster 为真时，拼接 MAGIC_POSTER_TOOL_INSTRUCTION；
    否则直接返回 base_prompt。
    """
    try:
        from dashboard_strategy.context import AgentContext as GameContext  # 延迟导入以避免循环依赖
    except Exception:
        GameContext = None  # 仅用于类型提示，不影响运行

    game_context = getattr(context, "context", None) or context
    planner_ctx = getattr(game_context, "planner_context", None)
    use_magic_poster = bool(getattr(planner_ctx, "use_magic_poster", False))
    if use_magic_poster:
        # IMPORTANT: do not override the upstream base_prompt (output rules).
        # Append magic poster-specific instructions only when enabled.
        return f"{base_prompt}\n\n{magic_poster_base_prompt}\n\n{MAGIC_POSTER_SUMMARY_INSTRUCTION}"
    return base_prompt