# Kun room avatar collection

Thirty original Kun mascot portraits generated with the image generation tool
on 2026-09-13, using the existing Kun headset and laptop artwork as references.

- `kun-avatar-atlas.png`: original generated pixels, 1374 x 1145, a 6 x 5 grid.
- Each logical portrait occupies one 229 x 229 cell, ordered left to right,
  top to bottom. The source image has not been resized, recolored, or cut apart.
- `avatars.json`: the 30 stable identifiers and tile coordinates.
- `gallery.html`: a local visual catalog, including 38px and 44px previews.

The chat renderer displays individual portraits with CSS sprite positions. This
loads one roughly 2.1 MiB image rather than 30 separate full-resolution images.
Default member IDs use matching coordinator/coder/reviewer/detective portraits;
other member IDs select a stable tile. Renaming a member does not change its
portrait. No remote image service or new member permissions are involved.

The renderer and gallery display an 8px inset within each tile to avoid edge
bleed from neighboring portraits. This is CSS viewport positioning only; the
generated PNG bytes are unchanged.
