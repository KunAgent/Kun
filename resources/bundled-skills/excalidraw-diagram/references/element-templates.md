# Element templates

Replace color placeholders from `color-palette.md`. Keep `fontFamily: 3`, `roughness: 0`, `opacity: 100`.

## Free-floating text

```json
{
  "type": "text", "id": "label_title", "x": 80, "y": 40, "width": 280, "height": 28,
  "text": "Title", "originalText": "Title", "fontSize": 20, "fontFamily": 3,
  "textAlign": "left", "verticalAlign": "top", "strokeColor": "#111827",
  "backgroundColor": "transparent", "fillStyle": "solid", "strokeWidth": 1,
  "strokeStyle": "solid", "roughness": 0, "opacity": 100, "angle": 0,
  "seed": 100001, "version": 1, "versionNonce": 100002, "isDeleted": false,
  "groupIds": [], "boundElements": null, "link": null, "locked": false,
  "containerId": null, "lineHeight": 1.25
}
```

## Process rectangle

```json
{
  "type": "rectangle", "id": "process_main", "x": 80, "y": 120, "width": 180, "height": 72,
  "strokeColor": "#1d4ed8", "backgroundColor": "#dbeafe", "fillStyle": "solid",
  "strokeWidth": 2, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
  "angle": 0, "seed": 100011, "version": 1, "versionNonce": 100012, "isDeleted": false,
  "groupIds": [], "boundElements": [], "link": null, "locked": false, "roundness": null
}
```

## Marker dot

```json
{
  "type": "ellipse", "id": "dot_1", "x": 76, "y": 196, "width": 12, "height": 12,
  "strokeColor": "#1d4ed8", "backgroundColor": "#1d4ed8", "fillStyle": "solid",
  "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
  "angle": 0, "seed": 100021, "version": 1, "versionNonce": 100022, "isDeleted": false,
  "groupIds": [], "boundElements": null, "link": null, "locked": false
}
```

## Arrow

```json
{
  "type": "arrow", "id": "arrow_main", "x": 260, "y": 156, "width": 120, "height": 0,
  "strokeColor": "#4b5563", "backgroundColor": "transparent", "fillStyle": "solid",
  "strokeWidth": 2, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
  "angle": 0, "seed": 100031, "version": 1, "versionNonce": 100032, "isDeleted": false,
  "groupIds": [], "boundElements": null, "link": null, "locked": false,
  "points": [[0, 0], [120, 0]],
  "startBinding": { "elementId": "process_main", "focus": 0, "gap": 4 },
  "endBinding": { "elementId": "process_next", "focus": 0, "gap": 4 }
}
```

Update both endpoints' `boundElements` when adding an arrow. Prefer orthogonal elbows via extra `points` instead of diagonal slants through other nodes.

## Structural line

```json
{
  "type": "line", "id": "spine", "x": 40, "y": 80, "width": 0, "height": 240,
  "strokeColor": "#9ca3af", "backgroundColor": "transparent", "fillStyle": "solid",
  "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100,
  "angle": 0, "seed": 100041, "version": 1, "versionNonce": 100042, "isDeleted": false,
  "groupIds": [], "boundElements": null, "link": null, "locked": false,
  "points": [[0, 0], [0, 240]]
}
```
