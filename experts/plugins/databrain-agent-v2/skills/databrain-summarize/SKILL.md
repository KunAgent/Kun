---
name: databrain-summarize
display_name_en: DataBrain Summary
display_name_zh: DataBrain 汇总输出
description: >-
  Phase B final Markdown: narrative placement, pipe-table GFM, number display,
  and prose layout. Pipeline timing and B1–B3 gate → soul.md §3.5 only.
when_to_use: >-
  Phase B after soul.md §3.5 phase A. read_file this SKILL.md, then optional
  refs below, then one user-visible reply.
---

# DataBrain Summarize

**Scope:** How to **layout** the one final answer—where blocks go, spacing, tables, numbers, opener tone. Phase order, skill routing, and chart production → **`/prompt/soul.md` §3.5** and **`../databrain-chart-render/`** only.

## Refs & routing

You are reading **this file** (**B1** — required once per reply; host then streams the final answer). Optional **B2** reads below, then **B3** one reply. Phase order → `soul.md` §3.5.

**This file covers:** § Chart placement · § Markdown Layout · § Final text · § Simple Answer.

| B2 — also `read_file` | When | Contents |
|-----------------------|------|----------|
| *(none)* | Simple / quick scan / single metric | § Simple Answer below is enough |
| `complete.md` | Formal report, multi-source merge, template depth | Dedup, disclaimers, multi-source priority, process-leakage bans |
| `report.md` | Sandbox statistical tests or attribution / drill-down stdout in context | p-values, effect sizes, attribution % in prose (usually **with** `complete.md` if report-length) |

Brief p-value or top contribution % → one line in the opening (this file). Full test/attribution sections → `report.md`.

**A4 (not B2):** chart protocol → `../databrain-chart-render/SKILL.md` + `rendering_protocol.md`. Placement → § Chart placement below.

---

## Chart placement (narrative interleaving — mandatory)

**Single source of truth for where chart blocks sit in the final answer.** Other skills must not restate or redefine these placement rules.

Rules:

1. **Do not** open the final answer with a block of all `<dbd>` / ECharts charts, and **do not** use a dedicated "图表" section that stacks every chart before the narrative unless the user explicitly asked for a chart-only appendix.
2. **Do** write the introducing prose for a metric/topic first, then embed the matching chart block **immediately after** that prose (blank line per § Markdown Layout), then continue with more prose, tables, or the next chart.
3. **Multi-chart** answers: repeat **prose → chart → prose → chart → …** as the story unfolds. Each distinct `data_id` still appears **at most once**, but its single appearance must sit next to the text it supports—not at the top by default.
4. **Stream** the final Markdown in that same order (do not emit all charts first and paragraphs later).
5. Short single-chart answers: a 1–5 sentence opening is allowed, then the one `<dbd>` right after the sentence that states the headline—then interpretation. That is **not** permission to place unrelated charts up front.
6. For ECharts blocks (`echarts_option` / deferred charts): after introducing prose, place exactly `<echarts id="..." />`. Use ids from system **[Deferred ECharts]** or chart-render output. Do **not** paste option JSON into Markdown. Use each `chart_id` at most once; never invent ids. Protocol details → `../databrain-chart-render/rendering_protocol.md` §四.

**Spacing / GFM:** § Markdown Layout below. **Tier examples:** § Simple Answer / `complete.md` (do not repeat chart-placement rules there).

---

## Markdown Layout (all final user replies)

### Chart blocks (`<dbd>` / ECharts) — spacing & stream order

Apply § Chart placement for narrative position. Example pattern:

```markdown
Paragraph that names the metric, period, and takeaway for this chart.

<dbd>
{ "title": "...", "chart_type": "...", "data_id": "..." }
</dbd>

Next paragraph, another ## section, or a pipe table for data without a chart.
```

1. Blank line **before** `<dbd>` / `<echarts … />` and **after** `</dbd>` (never glue chart tags to prose or `|` rows on one line).
2. ECharts: bridging prose immediately before/after the placeholder; same spacing as `<dbd>`.

### Pipe tables (GFM) — critical

Many renderers break if a pipe table is glued to the line above or below (no blank line before `|`, or `##` / list / `<dbd>` on the same line after the last row). Fix in model output; do not rely on post-processing.

Spacing rules:

1. Before the first row (line starting with `|`): the previous line must be empty (`\n\n` between prose and `|`). A single `\n` is often insufficient.
2. After the last `|` row: next line must be empty or start a new block; never `##`, `-`, digits, or `<dbd>` on the same line as the closing row.

Invalid patterns:

- Prose and table on one line: `Here is the data.|Col1|Col2|`
- Only one newline after prose before `|`
- `## Section` immediately followed by `|Col|` without a blank line
- Bullet or `>` line immediately followed by a table without a blank line

Valid pattern:

```markdown
Short explanation paragraph.

| Col A | Col B |
| --- | --- |
| 1 | 2 |

Next paragraph or ## section starts here.
```

Streaming: when chunks are small, do not end a chunk with prose if the next chunk starts with `|` unless you already sent the blank line after the prose.

Table content:

- Header row starts with `|`; separator uses `|---|` on its own line.
- Reorder columns for readability (entity/region/period first, then primary KPI); do not scramble cell-to-row mapping.
- Sort body rows by the first numeric column in final column order: dates/periods ascending; counts/amounts/rates/scores descending unless the question needs otherwise. If rank index is column 1 but magnitude is another column, sort by magnitude.
- Use `/` instead of `|` inside cells; one line per cell.
- Thousand separators for ≥1000. Headers and period labels must match tool output exactly.

### General format

- Open with one short paragraph (1–5 sentences): direct answer; no bullet list in the opening; no "Conclusion" heading; no data-source attribution unless the user asked.
- Bold: mainly numeric metrics in the opening; do not bold whole sentences; do not start with `**`.
- Horizontal rules `---`: at most 2–3 per answer, only between major blocks; never stacked or after every bullet.
- Headings: blank line before every `##` or `###`; blank line before first `|` when a table follows a heading (pipe-table rules above).
- Wording: remove duplicate adjacent phrases in the opening.
- Values: copy from tool output; if missing, say so; no fabricated precision.
- Links and quotes: preserve; do not explain results via internal skill or tool names.

### Number formatting consistency

Two display modes, never mix within the same sentence:

**Prose mode（正文段落、开头总结、分析段落）：**

Unit rules are language-dependent — detect answer language and use the matching table. Never mix units across tables.

**中文（Chinese）单位：**

| 范围 | 格式 | 示例 |
|------|------|------|
| ≥ 1 亿 | `X.XX 亿`（2 位小数） | `1.23 亿` `23.08 亿` |
| ≥ 1 万 | `XXXX 万`（整数，四舍五入） | `2308 万` `45 万` |
| ≥ 1 千 | `X.X 千`（1 位小数） | `8.5 千` |
| < 1 千 | 原始数字 | `520` |
| 货币 | 数值 + 中文单位 | `$727 万` `¥1.2 亿` |

**English units:**

| Range | Format | Example |
|-------|--------|---------|
| ≥ 1B (1,000,000,000+) | `X.XXB` (2 decimals) | `1.23B` `23.08B` |
| ≥ 1M (1,000,000+) | `X.XXM` (2 decimals) | `23.08M` `5.35M` |
| ≥ 1K (1,000+) | `X.XK` (1 decimal) | `727.5K` `8.5K` |
| < 1K | raw number with comma | `8,520` |
| Currency | prefix + amount + unit | `$727.5K` `$5.35M` `¥1.2B` |

**禁止：** 中文用 K/M/B（❌`23.5M`→✅`2350 万`）；英文用 万/亿（❌`23.50M units`→✅`23.50M`）；数字过小用大单位（❌`0.005M`→✅`5K`）

**Table mode（pipe table 内）：**
- 使用原始数值 + 千分位分隔符，与 tool 输出保持一致
- 货币列用 `$` 前缀：`$5,351,988`
- 百分比保留原精度，不加额外小数位

**百分比：**
- 增长率/变化：带正负号 `+15%` `-3.2%`
- 占比/份额：不带符号 `15%` `3.2%`
- 最多 1 位小数
- 百分点差异用 `pp`（percentage point），避免与百分比混淆

**一致性：**
- 同句中所有大数用同一单位（不能上半句"2308 万"、下半句"$5,351,988"）
- 数据对比时优先用同一量级单位

---

## Final text

Write conclusions, numbers, tables, chart blocks, links, and quotes only. Answer in natural language; do not say which tool, parameter, or agent produced each number.

Do not put in user-visible text: tool or skill/agent names; fetch narration (e.g. "I called…", "per the XX tool", "data source: …", 「我先调用…」, 「数据来源：…」); internal params (game_code, white_games, script paths, /large_tool_results/, CLI flags); API field names as explanations; lists of which agent/tool did what.

**ABSOLUTE PROHIBITION: NO SELF-TALK IN FINAL ANSWER.** Even one sentence of "thinking out loud" ruins output.

| Category | Never output |
|----------|-------------|
| Process | "Now I have all the data…", "Let me compile…", "我已拿到数据…", "接下来我将…", "Based on the returned data…" |
| Self-dialogue | "好的，让我来…", "OK let me look at…", "首先我们看…" |
| Transition leads | "Below is the analysis:", "如下所示：", "具体如下：" (unacceptable as answer opener) |
| Meta-commentary | "从以上数据可以看出…" (redundant lead-in — go straight to the point) |

**Hard rule**: first characters must be a number, game name, metric, date, or direct answer. No warm-up.

Allowed: business wording (dashboard / intelligence / opinion metrics—see soul.md, not internal routing field names); game names, dates, metrics stated directly; URLs, citations, download links the user needs; test/attribution numbers (`report.md`, not "from sandbox stdout"); chart-render `<dbd>` / ECharts blocks embedded as-is (JSON unchanged; **position** per § Chart placement and § Markdown Layout).

**bi_data / `data_id` (BI):** when tools return bi_data, `[Tools/Databrain Data]`, or chart-render already finalized `<dbd>` for a `data_id`, embed that block once. Do not repeat the same metrics in a Markdown pipe table—including when `chart_type` is `table`. Use a pipe table or prose only for slices with no `data_id` / no `<dbd>` for that data. Details: § Simple Answer, `complete.md` (dedup); chart-render `rendering_protocol.md`.

More rules: `complete.md` (process leakage); § Simple Answer (short answers).

---

## Simple Answer

Single question, quick scan, short answer.

### Role

Merge existing tool/skill output into a short, readable final answer. Do not invent numbers or links not in context.

### Data presentation

- Charts: embed chart-render's finalized `<dbd>` blocks as-is; do not edit `<dbd>` JSON fields (data_id, chart_type, title). Placement per **§ Chart placement** + § Markdown Layout.
- No chart but structured numbers: pipe table or prose (§ Markdown Layout). Intelligence `|` tables without a matching data_id chart may stay as-is.
- One or two sentences suffice when there are no structured numbers: prose only.

If context has brief stats or attribution (p-value, top contribution %), state exact numbers in the opening; longer structure → `report.md` + `complete.md`.

### Must keep

- Exact numbers matching tool output; do not replace precise values with vague ranges.
- Download links (COS, [点击下载](url), etc.): preserve URLs; optional end section 「下载链接」 or "Download links".
- Opinion/sentiment structured blocks (topics, rates, sample posts, links): keep verbatim; at most one short transition sentence before/after.

### Layout

- Pipe tables, headings, opening paragraph: § Markdown Layout.

### Skip (simple tier)

- No multi-section formal report unless the user asks.
- No long reflection or completeness checklist.
- No empty template sections; omit unsupported claims instead of filler.
- Do not emphasize failed or missing modules; one line or omit.
