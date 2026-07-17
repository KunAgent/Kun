# OPC Workflow

## O — Outline Director

Humanize PPT consumes raw material and outputs the AST production contract:

- `deck_brief.md`
- `ast_outline.md`
- `slide_plan.json`
- `speaker_intent.md`
- `asset_manifest.md`
- `video_slots.json`

## P — Presentation Production

V0.1 keeps two paths:

### Chinese stable path

```text
Humanize PPT → guizang-style renderer → stable Chinese HTML PPT
```

### Style exploration path

```text
Humanize PPT → Zara-style exploration → select direction → full HTML deck
```

## C — Complete / Control

Post-processing adapters:

- `HyperFrames Video Adapter`
- `Presenter Adapter`
- `Deploy Adapter`
- `Deck QA`

Presenter mode is not a style. It is added after a deck is produced.
