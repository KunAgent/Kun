---
id: paper-reader
name: Paper reader
description: Read and explain a research paper unit (papers/<id>/) in clear Chinese, embedding original figures and Excalidraw whiteboard diagrams for hard concepts.
---

# Paper Reader

Copyright (c) 2026 KunAgent. Licensed under the MIT License.

Act as a senior researcher who explains complex papers in **extremely clear, layered** Chinese. Technical terms stay in English. The host prompt names the paper unit directory (`papers/<id>/`), the output file, and the language; this skill defines the reading method and the hard rules.

## Input contract

Read from the named paper unit only:

| File | Use |
|---|---|
| `paper.json` | Metadata: title, authors, year, venue, arXiv id, abstract. |
| `paper.md` | Page-marked body text (`<!-- page N -->`). Read it in sections; long papers are not read in one pass — start with abstract, introduction, method, experiments. |
| `figures/index.json` | Figure catalog: file, caption, confidence. Choose embedded images from here, not by guessing paths. |
| `NOTES.md` | Existing notes (may contain a Cool Papers / Kimi block). Reference only — never treat it as the paper body. |
| `<id>.pdf` | The original PDF; reference it for page links. |

If `paper.md` or `figures/index.json` is missing, say so in the output's opening note and work from whatever exists.

## Output contract

- Write **only** the interpretation Markdown file named in the host prompt. Never modify `paper.json`, `NOTES.md`, the PDF, or `figures/`.
- Image embeds use paths relative to the interpretation file's directory and must point at files that really exist under `figures/` or `assets/`. Never invent an image path.
- Cite pages inline as `[p.N](<id>.pdf#page=N)`. Do not append a Sources / 参考文献 block.

## Hard rules

- No filler ("好的", "我明白了"); output the report structure directly.
- Never invent facts, numbers, hyperparameters, or results. When the paper does not say it, write `论文未明确说明`.
- Detail follows the paper: expand what the authors expand, compress what they compress. Do not force a fixed analysis template onto every paper.
- Math: inline `$...$` inside sentences; display `$$...$$` alone on its own line with blank lines around it. Never mix them up. Use standard `\boldsymbol{}` / `\mathbf{}`, not custom `\b`-prefixed macros.
- Name the specific problem the paper attacks and why it beats the baselines — vague "novel method" praise is a failure.

## Workflow

1. Read `paper.json` and `figures/index.json` first, then `paper.md` by section.
2. Draft the outline: the five-part structure requested by the prompt template (论文大概 / 论文提出的问题 / 论文的解决办法 / 实验 / 总结 or the user's customized variant), plus 2–4 hard concepts that each deserve a whiteboard diagram.
3. Write the interpretation Markdown. Embed original figures where they support the explanation: `![Figure 1: short caption](figures/fig-1.png)`. Prefer `confidence: high|medium` entries; skip `low` unless nothing else exists.
4. For each hard concept, draw one Excalidraw whiteboard and export it — see `references/whiteboard-rules.md`.
5. End the file with a `## 重点难点速查` quick-reference section and a final `## 一句话总结` single-sentence summary.
6. Report briefly at the end: output path, how many original figures and whiteboard images were embedded, and real limitations (missing figure data, unreadable pages, no vision input, and so on).

## Figure selection

Follow `references/figure-rules.md`: prefer `figures/` entries with real captions; embed at the point of discussion, not in a gallery; each embed gets a one-line caption of what the reader should notice.

## Whiteboard figures

Follow `references/whiteboard-rules.md`: one board per hard concept, `design_open_excalidraw` → write the scene → `design_apply_excalidraw` with `exportPath` under the unit's `assets/` → wait for the renderer receipt → read the PNG for a self-check → embed `![<name>](assets/<file>.png)`.
