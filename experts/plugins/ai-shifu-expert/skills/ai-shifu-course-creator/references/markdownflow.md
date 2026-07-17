# MarkdownFlow Spec

MarkdownFlow is the **format** (a small DSL) used to author both **Teaching Prompts** (per-lesson, runtime teaching instructions) and **Course Prompts** (course-level AI persona / style / slide rules). This file is the authoritative source for the format itself — syntax, runtime constraints, and preservation rules. Violating anything here makes the prompt fail to parse, reference a learner-answer variable without a collection contract, or silently lose source content.

For pedagogical / quality-of-teaching constraints (which apply to Teaching Prompts), see [pedagogy.md](pedagogy.md). For Course Prompt structure and authoring rules, see [course-prompt.md](course-prompt.md).

## Variables

- Reference syntax: `{{var_name}}`
- No spaces in variable names
- Every `{{var_name}}` marker in a Teaching Prompt or Course Prompt is substituted before generation with that variable's system value: the learner's stored value when set, or `UNKNOWN` when unset or empty
- A variable marker is not an availability check. Do not model variables as present/absent or ready/not-ready; when a fallback matters, write instructions for the substituted value being the literal `UNKNOWN`
- Prefer wording that still reads correctly after substitution, such as `The learner goal is {{learner_goal}}. When the learner goal is UNKNOWN, use default examples; otherwise adapt examples to it.`
- For variable-based branches, state the substituted value in a natural sentence first, such as `The learner level is {{level}}.`, then write natural-language branch instructions.
- Do not reference a learner-answer variable without a corresponding variable-backed interaction and metadata entry
- A named variable is required only when the learner's answer must be used outside the current lesson: referenced by `course-prompt.md`, reused in another lesson, or used for cross-lesson personalization, examples, summaries, or deliverables
- No-variable interactions do not create learner variables; use them for lesson-local buttons, choices, inputs, branching, examples, feedback, and summaries that do not need to persist beyond the current lesson
- See [pedagogy.md#variable-strategy](pedagogy.md#variable-strategy) for collection pacing, downstream-effect, and semantic-duplication rules
- See [data-contracts.md#variable-table](data-contracts.md#variable-table) for the `global_variable_table` schema

## Interactions

- Variable-backed single-select: `?[%{{var}} Option A | Option B | Option C]`
- Variable-backed multi-select: `?[%{{var}} Option A || Option B || Option C]`
- Variable-backed input: `?[%{{var}} ...Enter your answer]`
- Variable-backed single-select + input: `?[%{{var}} Option A | Option B | ...Other, please specify]`
- Variable-backed multi-select + input: `?[%{{var}} Option A || Option B || ...Other, please specify]`
- No-variable flow button: `?[Continue]`
- No-variable disposable choice: `?[Option A | Option B]`
- No-variable input: `?[...Enter your answer]`
- No-variable disposable choice + input: `?[Option A | Option B | ...Other, please specify]`

Use variable-backed syntax only when the answer must leave the current lesson. Use no-variable `?[...]` for lesson-local buttons, choices, or inputs, including current-lesson branching and feedback. Do not leave the variable name blank as a substitute for no-variable syntax.

### Prompt Placement Rules

- Put the learner-facing question or prompt in the script text immediately before the interaction line.
- Put each `?[]` interaction on its own line.
- Inside the interaction line, include only interaction content: option labels for select interactions, and input markers/placeholders such as `...Other` or `...Brief situation` where applicable.
- Do not place learner-facing question text after `%{{var}}`; it will become part of the interaction content.
- For input interactions, include both the full question before the interaction line and a shorter placeholder after `...`.
- If the pre-interaction text enumerates or describes the choices, the option labels in the `?[]` line must match those choices exactly — same set, same order, same wording. The narrative options and the interaction options must not drift apart.

Correct:

```markdown
Ask the learner: Which option best matches the next step for this lesson?
?[Option A | Option B | Option C]

After the learner answers, continue: for Option A, use the first explanation path; for Option B, use the second explanation path; for Option C, use the third explanation path.

Ask the learner: What is one course-wide goal that should shape later lessons and the Course Prompt?
?[%{{learner_goal}} ...One-sentence goal]

Ask the learner: What is one risk in the current example?
?[...Brief risk]

Ask the learner whether they are ready to continue.
?[Continue]
```

Incorrect:

```markdown
?[%{{choice}} Which option best matches your situation? Option A | Option B | Option C | ...Other]
?[%{{example}} What is one situation where you want to apply this idea this week? ...Describe your situation]
Ask the learner: Which option best matches your situation? ?[%{{choice}} Option A | Option B | Option C]
```

### Input Marker Rules

- `...` is an input marker, not punctuation.
- `...` must appear immediately before the short free-text placeholder or free-text option label.
- For variable-backed pure input, use `?[%{{var}} ...Short placeholder]` after a fuller learner-facing question when the free-text answer must be used outside the current lesson.
- For no-variable pure input, use `?[...Short placeholder]` after a fuller learner-facing question when the free-text answer is used only in the current lesson.
- For select + input, put `...` at the start of the option that opens text entry, such as `...Other, please specify`, with or without a named variable depending on the persistence rule.
- Do not add a variable solely because the answer is free text; named variables are for cross-lesson or course-level persistence.
- Do not move `...` to the end of the prompt text.
- Do not write `?[%{{var}} Prompt text...]`.
- Do not write `?[%{{var}} Option A | Option B | Other, please specify...]`.

### Input Marker Examples

- Correct when the answer will be used outside the current lesson:
  Ask the learner: What is one course-wide goal that should shape later lessons?
  ?[%{{learner_goal}} ...One-sentence goal]
- Correct when the answer is used only in the current lesson:
  Ask the learner: What is the most important risk in this example?
  ?[...Brief risk]
- Correct when the answer will be used outside the current lesson: `?[%{{difficulty_type}} Concept unclear | Need practice | ...Other, please specify]`
- Correct when the answer is used only in the current lesson: `?[Concept unclear | Need practice | ...Other, please specify]`
- Incorrect: `?[%{{learner_goal}} Describe your goal in one sentence...]`
- Incorrect: `?[%{{difficulty_type}} Concept unclear | Need practice | Other, please specify...]`

For interaction-design quality (concrete prompts, branching, deepening interactions), see [pedagogy.md#interaction-design](pedagogy.md#interaction-design).

## Branching on User Input

MarkdownFlow has no programming-style conditionals, loops, or boolean logic. There is no parser that evaluates variable comparisons; there are no `if` blocks, `switch` blocks, or ternary expressions to wire up control flow.

Branching is enacted by writing **natural-language instructions** that describe what the AI should generate under each possible learner input. Variable markers are substituted first, so write branches against the resulting value. Phrasings such as "If the learner's input is X, then …" are **generation strategies the AI follows**, not `if`-`else` code.

Example:

```markdown
Ask the learner for their stance on the claim above.
?[Agree | Partially agree | Disagree]

After the learner answers, respond to the selected stance.

- If the learner's stance is Agree, acknowledge the agreement appreciatively.
- If the learner's stance is Partially agree, ask which parts they agree with and which parts they do not.
- If the learner's stance is Disagree, ask why they disagree.
```

The bullet phrasing reads like `if`, but it is not `if` — it is an instruction the AI engine interprets while generating. Nothing in MarkdownFlow evaluates the condition. The branching is enacted by the AI following the instruction.

### No program syntax around `{{var}}`

A Teaching Prompt looks like code (variables, interaction markers, branched outcomes), but it is read by a language model, not executed by an interpreter. Wrapping `{{var}}` in `if`-`else` blocks, ternary expressions, `switch` / `case`, or fenced pseudo-code blocks makes the script look like a program and pushes the AI toward executing-not-interpreting behavior, which degrades teaching quality.

Express every branch as a plain instruction sentence. For variables, state the substituted value naturally first, then branch with natural-language conditions:

`The learner level is {{level}}. If the learner level is UNKNOWN, start with the default beginner-friendly example; for beginner learners, use simple analogies; for intermediate learners, introduce technical terms; for expert learners, go deep into edge cases.`

> The point of MarkdownFlow is not to write the lesson content directly, but to use natural language to precisely instruct the AI on how to generate content under each possible learner input.

## Deterministic Blocks

- Single-line fixed text: `===fixed text===`
- Multi-line fixed text:

```markdown
!===
Line 1
Line 2
!===
```

Use deterministic blocks only for truly fixed content (legally or operationally locked statements, fixed images). Do not lock entire lessons in fixed syntax — that defeats the model-guiding purpose of MarkdownFlow.

## Images

Images in Teaching Prompts have two valid forms. The form is chosen by intent, not by aesthetics:

- **3.1 — fixed display** (the image should appear exactly as authored, no layout customization needed): use a standard markdown image inside a **single-line deterministic block**.
- **3.2 — HTML view** (the image needs width control, alignment, a caption, side-by-side layout, …): write a **natural-language instruction** to the runtime model. Do **not** wrap HTML in deterministic blocks — that defeats the runtime's ability to adapt layout.

In both forms the URL **must** come from the platform (`https://res.ai-shifu.cn/<uuid32>`). Obtain it by running `shifu-cli.py upload-image --file <local-path>` (or `--url <remote-url>`); never invent URLs and never reuse external image links directly.

### 3.1 Fixed image (standard markdown + deterministic)

```markdown
===![short description of what the image conveys](https://res.ai-shifu.cn/abcd…)===
```

- The `===…===` wrapper is required. Without it the runtime model is free to rewrite, omit, or paraphrase the image (cf. *Preservation → Immutable Assets* below).
- The alt text must describe **what information the image carries** (e.g. `gradient descent three-step diagram`), not `image1` / `figure`. The alt is also the fallback when the image fails to load.
- Follow the image with a paragraph of explanatory text. The text must not merely restate the image; it must add context, causality, examples, or usage. Assume the reader cannot see the image. (See `course-prompt.md` *Rule 11 — Slide-Text Relationship*.)

### 3.2 HTML view image (instruction-style, not fixed output)

**Key idea**: MarkdownFlow is a set of natural-language instructions to a runtime model — it is not a template. When you need HTML layout for an image, write an instruction that *tells the runtime model* what image to insert, what it shows, and how to lay it out. The runtime model produces the actual HTML each time it generates. Do **not** put the HTML inside `===…===` / `!=== … !===` — deterministic blocks mean "output verbatim" and strip the runtime's ability to adapt.

Three things must be enforced **through wording**, not through deterministic blocks:

- The image URL **must be preserved exactly as written** (no shortening, no rewriting, no invention).
- The alt / image description **must not be dropped**.
- The image **must appear** at this position; the runtime cannot decide to omit it for length or flow.

Each sample below is an instruction the LLM can drop directly into a Teaching Prompt. The runtime model reads it and emits the appropriate HTML.

**Width control** — image takes only half the column:

```markdown
在此处插入一张图片(以 HTML <img> 方式嵌入)。
- URL(必须原样保留):https://res.ai-shifu.cn/aaaa
- 图片内容:梯度下降三步示意
- 展示方式:宽度约占容器一半(max-width 50% 左右),保持原始宽高比
```

**Alignment** — center / left / float:

```markdown
在此处插入一张图片(以 HTML 方式居中显示)。
- URL(必须原样保留):https://res.ai-shifu.cn/bbbb
- 图片内容:Transformer 注意力计算流程
- 展示方式:水平居中,宽度不超过容器 70%
```

**figure + figcaption** — formal caption under the image:

```markdown
在此处插入一张带图注的图片,使用 HTML <figure>/<figcaption> 结构。
- URL(必须原样保留):https://res.ai-shifu.cn/cccc
- 图片内容:Transformer 单层结构
- 图注文字(必须原样输出,不要改写):图 3. Transformer 单层结构
- 展示方式:居中,图注样式淡灰色小字
```

The locked caption is enforced by the wording `必须原样输出,不要改写`. **Do not** add a separate `===图 3. …===` deterministic block to lock the caption — instruction-style HTML images keep every locked element inside the instruction itself.

**Side-by-side multi-image** — comparison / before-after:

```markdown
在此处并排展示两张图片用于左右对照,使用 HTML(flex 或 table 任选)。
- 左图 URL(必须原样保留):https://res.ai-shifu.cn/dddd,内容:处理前
- 右图 URL(必须原样保留):https://res.ai-shifu.cn/eeee,内容:处理后
- 展示方式:左右并排,每张约占容器宽度 48%,中间留出小间距
```

**General rules when writing an HTML-view image instruction**:

- Open with `在此处插入一张图片(以 HTML …方式)` so the runtime recognises this paragraph as an image directive, not narrative text.
- Every URL line must carry the phrase `(必须原样保留)` — this is the hard-lock signal to the runtime.
- Give an `图片内容: …` line so the runtime knows what the image depicts (it can derive a contextual alt from this).
- Describe layout in natural language, not CSS pixel values. Say `占一半宽度` / `略小于容器`, not `width: 432px`. Different viewports want different numbers; let the runtime pick.
- For multi-image layouts, list each image's URL and content as separate bullets — the runtime preserves order more reliably than from a single inline sentence.

### 3.3 Which form to use

| Intent | Form |
|---|---|
| Image displays as-is, default size, no layout customization | **3.1** `===![alt](url)===` |
| Specific width / alignment / caption / side-by-side layout | **3.2** instruction-style HTML directive |
| Locked content + layout customization | **3.2** — express every lock through wording (`必须原样保留` / `必须原样输出` / `不要改写`); do **not** mix in deterministic blocks |

## Preservation

### Immutable Assets

- Code blocks and fence language.
- Image URLs, alt text, and ordering.
- Regulated wording or fixed numeric thresholds.

### Controlled Rewriting

Allowed:
- Filler removal.
- Sentence smoothing.
- Structural reorganization for lesson clarity.

Not allowed:
- Silent factual changes.
- Unmarked omission of required source evidence.
- Learner-answer variable references without a corresponding variable-backed interaction and metadata entry.

### Deterministic Block Policy

Use deterministic blocks only for truly fixed content. Do not lock entire lessons in fixed syntax. For images that must remain unchanged, use single-line deterministic syntax per image.

## Common Mistakes

- `?[%{{var}} Prompt text…]` — `...` placed at end of prompt instead of before placeholder.
- `?[%{{var}} A | B | Other, please specify…]` — same issue inside an option label.
- `?[%{{var}} Question prompt? Option A | Option B]` — question inside the interaction line; move it to the line above.
- `Ask the learner the question. ?[%{{var}} A | B | C]` — interaction not on its own line.
- Pre-interaction text enumerates choices A / B / C but `?[%{{var}} X | Y | Z]` exposes a different set — the narrative description and the interaction options must stay aligned (same set, order, and wording).
- Creating a named variable for a continue button, confirmation, or current-lesson-only choice/input.
- Using no-variable `?[...]` for an answer that must be used outside the current lesson.
- Leaving the variable name blank after `%` as a substitute for no-variable syntax; use plain `?[...]` instead.
- Program-style branching syntax around `{{var}}`, such as `if` / `else`, template conditionals, or `switch` blocks. MarkdownFlow has no conditional parser; express branches as plain instruction sentences (see [Branching on User Input](#branching-on-user-input)).
- Wrapping an entire lesson body in `=== … ===` or `!=== … !===`.
- Referencing `{{var}}` with no corresponding `?[%{{var}} ...]` collection and metadata entry.
- Bare `![alt](url)` for an image that should display as-is — the runtime model is free to rewrite or drop it. Wrap in `===…===` (form 3.1).
- Putting an HTML `<img>` / `<figure>` / `<div>` block inside `!=== … !===` — defeats the layout adaptability that HTML-view images exist for. Switch to the instruction-style form (3.2).
- Adding a separate `===caption text===` block inside or beside a 3.2 instruction to lock the caption — instruction-style images lock content through wording (`必须原样输出 / 必须原样保留 / 不要改写`), not by mixing in deterministic blocks.
- Hardcoding CSS pixel values in a 3.2 instruction (`width: 432px`) — different viewports need different sizes. Describe layout in natural language (`占一半宽度`, `略小于容器`).
- Forgetting the `(必须原样保留)` phrase on a URL line in a 3.2 instruction — the runtime may then shorten, paraphrase, or invent the URL.
- Alt text or `图片内容` that just says `图片` / `示意图` — these carry no information; describe what the image *conveys*.
- Using a URL that is not on `res.ai-shifu.cn` — every image must be uploaded via `shifu-cli.py upload-image` first.
