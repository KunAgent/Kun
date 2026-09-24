# Paper Reading in Work

Work mode ships a paper-reading workflow: import arXiv papers, papers.cool links, or local PDFs into self-contained "paper units", then let the Kun agent write a deep interpretation. Everything lives as ordinary files in the workspace — openable in Obsidian or VS Code at any time.

## Importing a paper

Three entry points:

- The "Read a paper" card on the Work start page (graduation-cap icon).
- The + button in the sidebar's "Papers" section.
- The hover action "Open as paper" on any PDF in the file tree (the source file is copied, never moved).

The import dialog accepts:

- An arXiv id or URL, e.g. `1706.03762` or `arxiv.org/abs/1706.03762v7`.
- A papers.cool link, e.g. `https://papers.cool/arxiv/1706.03762` or a venue catalog link.
- A local PDF file via "Choose a local PDF…".

After import the paper becomes a unit directory:

```text
papers/<id>/
├── paper.json          # unit marker + metadata
├── <id>.pdf            # the original PDF
├── paper.md            # extracted text with page markers
├── figures/
│   ├── index.json      # figure/table index
│   └── fig-*.png
├── NOTES.md            # notes + papers.cool Kimi notes
└── <paper>-解读.md      # generated interpretation (never overwrites NOTES.md)
```

Opening a unit enters the reading layout: PDF on the left, NOTES.md on the right.

## Paper bar actions

When the active file belongs to a paper unit, a paper bar appears under the editor toolbar showing the title, authors, year, venue, and arXiv / papers.cool links. Actions:

- **Cool notes**: fetch the papers.cool Kimi notes and append them to NOTES.md (uses no model quota). Right-click forces a cache refresh.
- **Interpret**: run the interpretation flow (below).
- **Extract figures**: generate `paper.md` and `figures/index.json` (right-click forces a redo).
- **Open interpretation**: opens the latest interpretation file when present.

Running jobs show elapsed time and can be canceled.

## One-click interpretation

Clicking "Interpret":

1. Saves the current document.
2. Auto-extracts text and figures when `paper.md` is missing and auto-preprocess is enabled.
3. Opens the assistant and submits the interpretation prompt. The agent works from `paper.md`, `figures/index.json`, and `paper.json`, writing the interpretation to `<slug>-解读.md` (`-2`, `-3`, … suffixes avoid overwriting).
4. When the turn ends, the new file is recorded in `paper.json` and opened.

Figures in the interpretation reference real files under `figures/`; hard concepts get an Excalidraw whiteboard whose PNG is exported to `assets/` and embedded.

## Settings

Settings → Work → "Paper reading" configures:

- **Papers folder**: workspace-relative directory holding the units (default `papers`).
- **Interpretation language**: Chinese / English / follow the paper.
- **Auto preprocess on import**: extract `paper.md` and figures right after import.
- **papers.cool notes**: allow fetching Kimi notes.
- **Interpretation template**: reading preferences appended to the prompt; empty uses the built-in default.

## Notes

- No database: the file tree is the library; `paper.json` marks a unit.
- `NOTES.md` is the user/agent working note — interpretations never overwrite it.
- papers.cool fetching is explicit, serialized, 180-second-timeout, and cached under `.cache/coolpapers-kimi.md`.
