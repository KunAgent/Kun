# Whiteboard figure rules

One Excalidraw board per hard concept (2–4 total per paper). Good candidates: a non-obvious architecture, a tricky derivation step, a training/inference loop, a comparison that prose cannot carry.

## Naming

The host prompt fixes the names — follow it exactly:

- `title` = `<interpretation file stem>-<diagram name>` (Chinese names are fine, ≤160 chars)
- `boardId` = `paper-<slug8>-<n>` matching `^[a-zA-Z0-9_-]{1,64}$` (`<slug8>` is the paper id with dots removed, truncated to 8 chars; `<n>` starts at 1)
- `exportPath` = `<unitDir>/assets/<title>.png`

## Procedure

1. `design_open_excalidraw({ boardId, title })` — creates `.kun-whiteboards/<boardId>/` and opens the board.
2. Write `.kun-whiteboards/<boardId>/excalidraw.json` — build the scene per the `excalidraw-diagram` skill (load its references for element/schema rules).
3. `design_apply_excalidraw({ boardId, exportPath })` — reloads the board, exports the sidecar PNG, and writes the second copy at `exportPath`.
4. Wait for the renderer receipt — `accepted` only means the request arrived; the receipt's `exportedPath` is the proof. If vision is available, Read the PNG to check overlaps and clipping; fix and re-apply if it is broken.
5. Embed in the interpretation file: `![<diagram name>](assets/<title>.png)` right where the concept is explained.

## Failure handling

- `design_apply_excalidraw` returns an error or the receipt reports failure → retry once with a corrected scene; if it still fails, drop that diagram, note the limitation in the final report, and keep the explanation in text.
- Never embed `assets/...` for a diagram whose export failed — the file will not exist.
