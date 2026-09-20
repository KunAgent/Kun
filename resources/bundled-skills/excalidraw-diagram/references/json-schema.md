# Excalidraw JSON (Kun)

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "kun",
  "elements": [],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": 20 },
  "files": {}
}
```

Required on every live element: `id`, `type`, `x`, `y`, `width`, `height`, `strokeColor`, `backgroundColor`, `fillStyle`, `strokeWidth`, `strokeStyle`, `roughness`, `opacity`, `angle`, `seed`, `version`, `versionNonce`, `isDeleted`, `groupIds`, `boundElements`, `link`, `locked`.

Text elements also need `text`, `originalText`, `fontSize`, `fontFamily`, `textAlign`, `verticalAlign`, `containerId`, `lineHeight`.

Arrow and line elements need `points` as `[x, y]` pairs relative to `x`/`y`. Bindings use `{ "elementId", "focus", "gap" }`.

Keep ids unique and stable across section edits. Deleted leftovers use `"isDeleted": true` rather than disappearing mid-file when another section still references them.
