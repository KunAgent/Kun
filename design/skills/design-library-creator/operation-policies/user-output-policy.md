# User-Facing Output Policy

## Scope

This policy applies to ALL creation and incremental routes (create-library, create-from-scratch, create-from-structured-spec, expand-components, refine-library, generate-additional-kit).

## Principle

Any assistant-visible text can be rendered to the user: Main Agent prose, Task `description` titles, TodoWrite titles, and Task/Sub-Agent final responses. Treat all of them as user-facing.
Visible text MUST be **minimal, high-level, progress-oriented, and brand-aware** — never implementation details.

Sub-agent machine contracts are stored in `{tmp_dir}/agent-reports/*.json`; they are never returned as final responses and never printed.

---

## Terminology Rules (ALL user-visible text, including Task descriptions and TodoWrite titles)

| Internal Term | User-Facing Replacement (zh) | User-Facing Replacement (en) |
|---------------|------------------------------|------------------------------|
| Design Library / 设计库 | **设计系统** (always; "设计库" forbidden) | **Design Library** (keep as-is; do NOT change to "Design System") |
| 规范包 / design-spec bundle / bundle | **设计规范** or omit entirely | design spec / omit |
| 压缩包 / ZIP / zip attachment / archive | Do not mention — say "你上传的设计规范" or omit | Do not mention |
| 解压 / unpack / extract | Do not mention; execute silently | Do not mention |
| `.jsonl` / JSONL / manifest / variant | Do not mention | Do not mention |
| `.design_library/` or any output directory path | Do not mention | Do not mention |
| 临时目录 / tmp dir / hidden area | Do not mention; execute silently | Do not mention |
| UIKit / UI Kit / 展示页 | **示例页面** (always; "UIKit"/"UI Kit"/"展示页" forbidden in user-visible text) | **Sample Page** |

Rules:
- "设计库" is FORBIDDEN in any user-visible Chinese text. The Chinese term is always "设计系统". In English text, the product term remains "Design Library" — this mapping applies to Chinese output ONLY.
- The user does not know (and must not be told) that the input is a "bundle", "package", or "archive", how it is structured, or how it is unpacked/parsed. Refer to it only as "你上传的设计规范" / "你的设计规范", or skip mentioning the input entirely.
- File formats, packaging, parsing mechanics, and directory locations are implementation details — never surface them, including in Task `description` titles (e.g., write "分析设计规范", NEVER "检查设计规范压缩包结构").

## Output Templates — Creation Routes

Default silent mode permits only these visible messages. Skip phase-by-phase narration unless user input is required, a recoverable issue needs a short explanation, or the user explicitly asks for verbose/debug output.

| Moment | Allowed User Output |
|--------|---------------------|
| Start | zh: "已收到你的设计规范，开始生成设计系统。" / en: "Got your design spec. Starting Design Library generation." |
| Missing input | zh: "请提供设计规范文件，我来为你生成设计系统。" / en: "Please provide your design spec to start generating the Design Library." |
| Validate | zh: "正在检查..." / en: "Validating..." |
| Complete (pass) | zh: "设计系统已生成完成。" / en: "Design Library generation complete." |
| Complete (partial — deferred components exist) | "为提升构建效率，TRAE 已优先提取并生成设计系统所需的核心组件与规范。为了保障更好的生成效果，建议补充设计规范，并解析全部组件，但是解析全部组件可能会花费更长时间约1小时。" |
| Complete (gaps) | zh: "生成已完成，但存在少量缺口。" / en: "Generation completed with known gaps." |
| Error/Retry | zh: "正在重试当前步骤..." / en: "Retrying the current step..." |

## Output Templates — Incremental Routes (expand / refine / additional-kit)

| Step | Allowed User Output |
|------|---------------------|
| Start | zh: "开始更新设计系统。" / en: "Starting Design Library update." |
| Validate | zh: "正在检查..." / en: "Validating..." |
| Complete (pass) | zh: "设计系统已更新。" / en: "Design Library updated successfully." |
| Complete (gaps) | zh: "更新已完成，但存在少量缺口。" / en: "Update completed with known gaps." |

## Clarification / AskUserQuestion

Interactions that require user input (missing bundle, ambiguous route, design choices) are permitted as natural-language questions. They MUST NOT expose implementation details — ask in terms of product/design concepts, not internal file structures or orchestration mechanics.

---

## Blacklist (NEVER Expose in Prose)

| Category | Examples | Why Hidden |
|----------|----------|------------|
| Input packaging terminology | "bundle", "规范包", "压缩包", "ZIP", "解压", "包结构", "`.jsonl` 变体" | Implementation detail; user only knows "设计规范" |
| "设计库" as Chinese term | "设计库可用", "读取设计库" | Wrong terminology — always "设计系统" |
| Absolute paths / bundle raw paths | `/data/user/work/bundle/tokens/colors-light.md` | Implementation detail |
| Intermediate implementation paths | `{tmp_dir}/phase2-brand-analyst.json` | Internal state |
| Task input file lists / constraint file paths | `file-specs/css-tokens.md`, `examples/templates/phase-2-analysts.md` | Dispatch detail |
| Orchestration variables | `preFilledColorScales`, `fontSans = "Inter"` | Internal state |
| Hex color values in sequence | `#6750a4`, `--coral-orange-600: #ff6b35` | Noise; belongs in sub-agent output only |
| Sub-agent dispatch parameters | Task query content, return payloads | Implementation detail |
| Sub-agent return/report JSON | `{"writtenFiles":[...],"warnings":[],"undefinedCssVars":0}` | Implementation detail; stored in `{tmp_dir}/agent-reports/*.json`, never final-response text |
| Raw bundle content | Token markdown tables, annotation excerpts | Source data |
| Quality gate itemized results | "✓ CSS variables count: 127", "✓ No placeholders found" | Implementation detail |
| Retry/error recovery internals | "Sub-agent timeout after 3min", "Retrying with reduced scope" | Internal fault tolerance |
| Read budget tracking | "Read count: 7/8", "Skipping file to stay within budget" | Internal bookkeeping |
| Context distillation notes | "Dropping Phase 2 return bodies", "Context at 35K" | Internal optimization |

### NOT Blacklisted (Allowed)

| Category | Why Allowed |
|----------|-------------|
| Product/brand names, component names | User-facing design concepts |
| Aggregate counts (token count, component count, file count) | High-level progress |
| Final completion summary text | Designed for user consumption |

---

## Thinking vs Prose

| Content Type | Disposition |
|--------------|-------------|
| Phase transition announcement | ✅ Print to user |
| Orchestration reasoning | ❌ Thinking only |
| Data extraction from sub-agent returns | ❌ Thinking only |
| Sub-agent return JSON payloads | ❌ Thinking only — use data internally, never print |
| Task/Sub-Agent final response | ✅ Short status sentence only; ❌ never JSON, paths, stats, or warnings arrays |
| Quality gate checklist execution | ❌ Thinking only — only print final pass/gaps |
| Phase complete status (pre-next-dispatch) | ❌ Silent by default; use only verbose/debug mode |

---

## Verbose Mode (Tiered)

| Level | Trigger | Unlocked Content |
|-------|---------|-----------------|
| Default (silent) | No trigger | Start / validate / complete / required clarification only |
| Standard debug | User says "debug" / "verbose" / "show details" | + current phase name, failure category, high-level diagnostics. Still NO: raw bundle content, full Task query, dense hex lists, budget tracking |
| Full internals | User says "verbose internals" / "debug internals" | All blacklisted content allowed, prefixed with `[DEBUG]` |

Default: silent mode.
