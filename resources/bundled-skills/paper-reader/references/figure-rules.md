# Figure selection rules

`figures/index.json` entries look like:

```json
{ "file": "fig-1.png", "caption": "Figure 1: Pipeline overview ...", "page": 3, "confidence": "high", "source": "html" }
```

## Choosing

- `confidence: "high"` — captioned figure or clean crop; safe to embed.
- `confidence: "medium"` — usable; check the caption still matches the discussion.
- `confidence: "low"` — probably a bad crop or a full-page fallback (`page-*.png`). Embed only when the concept genuinely needs it and say the crop is approximate.
- `source: "pdf-page"` entries are whole rendered pages. Use them only when the paper has no usable per-figure images.

## Embedding

- Path is relative to the interpretation file's directory: `![Figure 1: pipeline overview](figures/fig-1.png)`.
- Embed at the paragraph that discusses the figure — never dump a gallery at the end.
- Give every embed a one-line caption telling the reader what to notice, not just the paper's caption text.
- 2–6 original figures is typical. More than that usually means padding.
- When vision input is unavailable or the host prompt says so, pick figures from `index.json` captions alone and skip `confidence: "low"` entries entirely.
