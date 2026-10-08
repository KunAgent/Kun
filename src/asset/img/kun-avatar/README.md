# Kun layered avatar artwork

Generated on 2026-10-07 and polished on 2026-10-08 with the conversation image generation tool, using the
existing `../room-avatars/kun-avatar-atlas.png` as the visual reference. These are
original generated raster layers, not vector replacements or differences cut
from the old portrait atlas. Body proportions are standardized for dressing.

- `sources/` preserves the unmodified image-generation outputs, at their actual
  native dimensions. See `sources/generation-records.json` for provenance.
- Wearable layers remain full-canvas 1024px RGBA PNGs. The 57 inventory icons,
  four bottle layers and card back use 512px masters. Six painted scenes each
  have a full and simplified 1024px version. Two rarity overlays leave the face clear.
- `96/`, `128/`, `256/`, and `512/` contain the application WebP exports. Only these
  URLs are imported by the renderer; source sheets and PNG masters are not
  included in its asset bundle.
- `manifest.json` records the canvas, unchanged compact face crop and an explicit
  list of `manifests/*.json` families. These map 168 assets to their export files,
  native canvas and recorded source cell. Families keep every file below 700 lines.
- The pure shared catalog owns IDs, bilingual labels, rarity, set, flavor,
  visibility/conflicts, six scene IDs and the 30 preset/card-scene combinations.
  Rarity follows the wardrobe design: 16 common, 22 rare, 13 epic, 6 legendary.

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

Registration recipes are separated by purpose: `kun-avatar-asset-recipes.mjs`
retains the originals, `kun-avatar-polish-recipes.mjs` adds icons, expressions,
small variants, scenes, bottles and effects, `kun-avatar-accessory-icon-recipes.mjs`
registers the other 33 icons, and `kun-avatar-worn-recipes.mjs` overrides the 24
clothing front layers without changing their original placement boxes. Drawstrings,
zips, pockets and identifying emblems remain visible inside the original collar area.
All reconstruction and export work is local; no generation runs in the product.

The second command checks all files and writes visual contact sheets to
`.cache/kun-avatar-qa/`. Review all 30 presets, every accessory on all four body
colors, and compact sizes on light, dark and checker backgrounds after changing
art or registration. Never treat successful format checks as visual approval.

The checks enforce required icons, RGBA/opaque scene formats, icon margins,
source SHA256/dimensions, pale semitransparent edge detection, body registration
within two pixels and a WebP budget of 2,065,734 baseline bytes plus 2.5 MiB.
The added sheets cover icons versus worn art on three backgrounds, 48px
silhouettes, all expressions/glasses/colors, helmet faces, rarity overlays,
all 30 presets in all six scenes, bottle states and compact before/after pairs.

In the application, inventory and equipment slots use the independent icons.
At CSS sizes up to 48px, props and gripping wings are omitted and scenes use
simplified color fields. Up to 34px, glasses and four hard-to-read hats use
registered small variants. Only the wardrobe stage requests rarity effects,
and effects are disabled below 96px. PNG masters/source sheets stay out of the
renderer bundle; WebP files are external URLs loaded when needed.

The bottle and card-back artwork is ready for the later wardrobe reveal/card
screens; this change does not implement the separate drop/ownership system.
The later 1024x1280 half-body stage, unified body recoloring, optional animation
sprites and new equipment batches remain deferred. Existing body art is untouched.
User style approval, a specialist's manual retouch pass and the human silhouette
pairing score remain review gates, not claims made by automated checks.

Color variants, faces, headwear, clothing, props and grip wings are independent
generated art. Every variant uses the same fixed export bounds. Generated
source details can differ slightly between colors; this is not a claim of
pixel-identical anatomy or a native layered PSD master.
