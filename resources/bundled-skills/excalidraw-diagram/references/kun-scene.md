# Kun Excalidraw scene contract

The open board is the only target. The turn context supplies `scenePath`. Write that file, then call `design_apply_excalidraw`.

## Canonical paths

| Surface | Scene file |
|---|---|
| Work whiteboard | `.kun-whiteboards/<boardId>/excalidraw.json` |
| Private-chat room | `.kun-whiteboards/<boardId>/excalidraw.json` (under the agent workspace) |
| Design document | `.kun-design/<documentId>/excalidraw.json` |
| Code canvas | `.kun-canvas/code-<threadId>/excalidraw.json` |

PNG sidecar (written by the renderer on apply): same directory, `excalidraw.png`.

The JSON wrapper is `{ "type": "excalidraw", "version": 2, "source": "kun", "elements": [], "appState": { "viewBackgroundColor": "#ffffff" }, "files": {} }`.

## Apply loop

1. `write` or `edit` `scenePath`.
2. Call `design_apply_excalidraw` with no arguments. It reloads the open surface from disk and exports `excalidraw.png`.
3. Wait for a canvas receipt with status applied (or failed). Do not claim the board updated from `Accepted` alone.
4. `Read` `excalidraw.png` and fix layout issues in JSON.

In a private-chat room, call `design_open_excalidraw` first when no board is open, then use the `scenePath` the host returns. Reuse the same `boardId` to continue an existing board; pass a new `boardId` for a second diagram.

## Mutation policy

- Empty sketch: write the full `elements` array.
- Existing sketch: keep live element ids unless the user asked to replace the drawing. Add new ids; patch only the requested nodes.
- Do not write a second scene elsewhere in the workspace.
