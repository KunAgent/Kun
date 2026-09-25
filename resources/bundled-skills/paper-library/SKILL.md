---
id: paper-library
name: Paper library
description: Work across a Kun paper library — find papers, compare several papers, draft related-work sections with [@citeKey] citations, and write notes under notes/.
---

# Paper Library

Copyright (c) 2026 KunAgent. Licensed under the MIT License.

The workspace is a paper library. Every paper is a self-contained directory ("unit"); there is no database. Use your normal file tools (list, read, search, write) to work with it.

## Layout

| Path | Meaning |
|---|---|
| `papers/<id>/` or `papers/<group>/<id>/` | One paper unit. A directory is a unit only if it contains `paper.json`. Groups are plain subdirectories. |
| `<unit>/paper.json` | Metadata: `title`, `authors`, `year`, `venue`, `arxivId`, `doi`, `abstract`, `tags`, `status` (`unread`/`reading`/`read`), `citeKey`. |
| `<unit>/paper.md` | Extracted body text with `<!-- page N -->` markers. May be missing; fall back to the abstract in `paper.json`. |
| `<unit>/NOTES.md` | The user's notes (and Cool Papers notes). Treat as the user's own words. |
| `<unit>/marks/annotations.json` | The user's PDF highlights: `quote`, `comment`, `page`. Highlights mark what the user found important — weight them. |
| `<unit>/references.json` | Parsed reference list, if fetched. |
| `<unit>/*-解读.md` | Earlier interpretations written by the paper-reader skill. |
| `notes/` | Cross-paper notes: comparisons, surveys, related-work drafts. Write new cross-paper output here. |

## Finding papers

- Search `paper.json` files (title, abstract, tags) before reading bodies.
- Do not scan `figures/`, `marks/assets/`, `source/` or `.cache/` directories for text.

## Writing rules

1. Never modify `paper.json`, `NOTES.md`, `marks/` or PDFs unless the user asks. Write only the output file named by the host prompt (default: a new file under `notes/`).
2. Cite papers as `[@citeKey]`. If a unit has no `citeKey`, use `FirstAuthorLastName Year`. End with a `## 参考文献` / `## References` list: authors, year, title, venue or arXiv id.
3. Every claim about a paper must come from its files. If something is not stated, write "文中未说明" / "not stated in the paper" instead of guessing.
4. Long papers: read `paper.md` in sections (abstract, introduction, method, experiments) rather than all at once.
5. Follow the language of the host prompt; keep technical terms in English.
