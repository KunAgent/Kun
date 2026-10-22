# PPT toolchain provenance

- License: MIT (Copyright (c) 2026 Binaryify Zhuang), from `open-kimi-ppt-skill/LICENSE`.
- Source: `open-kimi-ppt-skill` version `1.3.0`.
- Copied on: 2026-08-08.
- Purpose: vendor the PPT export scripts for Kun's `ppt_export` tool. The scripts are kept outside the Electron ASAR in packaged builds so the Node export subprocess can execute them.
- Reference documents (PPTD format, design policy, scenario guides, style systems, fonts, shapes) from the same source now live in `resources/bundled-skills/slides/references/` as assets of the bundled `slides` skill.
- Patched WASM: `scripts/local-export/pptd_wasm_bg.wasm`, copied from `editor/neo-ppt/assets/pptd_wasm_bg-DPPWdROu.wasm`; size 788,074 bytes (approximately 770 KiB), below the 8 MiB threshold.
- Fallback installation: if the vendored WASM is unavailable, install the upstream skill with `npx open-kimi-ppt-skill install`; its installer places the patched WASM at `scripts/local-export/pptd_wasm_bg.wasm`.
