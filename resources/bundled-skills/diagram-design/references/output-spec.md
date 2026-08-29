# Output specification

Set four dials before drawing.

- Format: html (default), native editable canvas, or standalone svg.
- Size: doc-inline 960×600; doc-wide/slide-16x9 1280×720; slide-4x3 1024×768; social-og 1200×632; social-square 1080×1080; fit from content bounds.
- Detail: simplified ≤7 nodes; balanced ≤12; faithful ≤24 with zones, split above 24.
- Audience: engineer uses exact component/protocol names; mixed keeps technology only when decision-relevant; executive uses capability/outcome names.

All presets keep at least 40px outer margin. Presentation sizes use a larger type ramp rather than shrinking standard labels. If content does not fit, lower detail or split.

HTML is self-contained and responsive. Motion defaults to none. Explanatory motion may reveal at most eight steps, must not change static meaning, and must show the complete frame under `prefers-reduced-motion: reduce`.
