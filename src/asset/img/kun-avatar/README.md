# Kun layered avatar artwork

Generated on 2026-10-07 with the conversation image generation tool, using the
existing `../room-avatars/kun-avatar-atlas.png` as the visual reference. These are
original generated raster layers, not vector replacements or differences cut
from the old portrait atlas. Body proportions are standardized for dressing.

- `sources/` preserves the unmodified image-generation outputs, at their actual
  native dimensions. See `sources/generation-records.json` for provenance.
- Each logical layer has a full-canvas 1024px RGBA PNG. Spatial registration is
  reproducible in `scripts/kun-avatar-asset-recipes.mjs`.
- `128/`, `256/`, and `512/` contain the application WebP exports. Only these
  URLs are imported by the renderer; source sheets and PNG masters are not
  included in its asset bundle.
- `manifest.json` maps all 79 logical layers to their four export files and
  records the canvas and compact face crop. The pure shared catalog owns part
  IDs, bilingual labels, visibility/conflicts and the 30 preset combinations.

Rebuild from the checked-in generated art:

```bash
node scripts/build-kun-avatar-assets.mjs
node scripts/kun-avatar-compose-check.mjs
```

The first command extracts isolated pieces from the transparent source sheets,
registers their bounding boxes, and exports full canvases. It does not generate
new art or call a remote service. Some source sheets do not have perfectly even
gutters, so the recorded source rectangles intentionally differ from a uniform
grid. The photographer shirt was regenerated separately to remove its embedded
camera; the camera remains an independent prop.

The second command checks all files and writes visual contact sheets to
`.cache/kun-avatar-qa/`. Review all 30 presets, every accessory on all four body
colors, and compact sizes on light, dark and checker backgrounds after changing
art or registration. Never treat successful format checks as visual approval.

Color variants, faces, headwear, clothing, props and grip wings are independent
generated art. Every variant uses the same fixed export bounds. Generated
source details can differ slightly between colors; this is not a claim of
pixel-identical anatomy or a native layered PSD master.
