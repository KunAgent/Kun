# Generate Additional Kit Type

> Read when: User asks to add a new kit type to an existing Library (e.g., "add a website kit" when only an app kit exists).

## Prerequisites

- Existing Library with `colors_and_type.css` and `css.json`
- Preferred: `components/_evidence/index.json` and `uikit-plan.json`
- At least one kit already generated in `ui_kits/`

### TodoWrite Policy (per SKILL.md invariant #12)

HARD CAP = 2. Allowed positions: ① after kit type is confirmed, ② before final validation. Never standalone — always batch with the next action.

## Flow

### Step 1 — Analyze Existing Library (Main Agent)

1. Confirm `css.json` exists — pass it as the token understanding source
2. Read existing `ui_kits/*/index.html` — understand current kit scope and screens
3. Resolve ComponentContractFiles for the kit sub-agent: if `components/_evidence/index.json` exists, pass evidence index and relevant evidence files; otherwise pass `components/index.json` and relevant `components/{slug}.json` files
4. Read only the relevant `README.md` brand summary and file index, or pass the README path if the sub-agent can read files
5. Determine new kit type from user request

### Step 2 — Generate New Kit (Sub-Agent ×1)

```
Task: Generate interactive UI Kit (type: {newKitType}).
Output:
  - ui_kits/{newKitType}/index.html
OutputDir: {output_dir}
OutputFileRel:
  - ui_kits/{newKitType}/index.html
OutputFileAbs:
  - {output_dir}/ui_kits/{newKitType}/index.html
Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/ui-kit.md — React 18 standalone, screens
  - {SKILL_DIR}/file-specs/design-library-output.md — Overall library structure
Input data:
  - CSSFile: {output_dir}/colors_and_type.css
  - CSSLink: "../../colors_and_type.css"
  - READMEFile: {output_dir}/README.md
  - ComponentEvidenceIndexFile: optional {output_dir}/components/_evidence/index.json
  - ComponentContractFiles: {output_dir}/components/{slug}.json when exists; else {output_dir}/components/_evidence/{slug}.json — resolve per component
  - ComponentIndexFile: {output_dir}/components/index.json when no per-component files exist
  - UIKitPlanFile: {output_dir}/uikit-plan.json if present
  - KitType: {newKitType}
  - OutputFileRel: ui_kits/{newKitType}/index.html (return contract only)
  - OutputFileAbs: {output_dir}/ui_kits/{newKitType}/index.html (physical Write target)
Write rule:
  - Write to OutputFileAbs exactly.
    - Do NOT write relative `ui_kits/{newKitType}/index.html`; that path is only for reported writtenFiles.
  ReturnReportFileAbs: {tmp_dir}/agent-reports/additional-kit-{newKitType}.json
  Report file format:
  - writtenFiles: ["ui_kits/{newKitType}/index.html"]
  - stats: { screensGenerated: 3, componentsUsed: N }
  - warnings: string[]
  Final response:
    已完成 UI Kit。
```

### Step 3 — Update Documentation (Sub-Agent ×1)

Dispatch a documentation update sub-agent. Main Agent must not directly rewrite `README.md`.

```
Task: Update Design Library README after adding "{newKitType}" kit.
Output:
  - README.md
Constraint files (MUST read before execution):
  - {SKILL_DIR}/file-specs/documentation.md — README structure and content requirements
  - {SKILL_DIR}/file-specs/design-library-output.md — Output directory structure and file roles
Input data:
  - Existing README file index and brand summary: {relevant README excerpt}
  - New kit files:
    - ui_kits/{newKitType}/index.html
  - New kit summary: {screensGenerated, componentsUsed, kitType}
  - Do NOT modify SKILL.md (it's a short gateway, kit-type agnostic)
  - OutputDir: {library output root path}
    - ReturnReportFileAbs: {tmp_dir}/agent-reports/additional-kit-readme.json
  Report file format:
  - writtenFiles: ["README.md"]
  - warnings: string[]
  Final response:
    已完成设计系统说明。
```

### Step 4 — Quality Gate (Main Agent)

From `operation-policies/quality-gates.md`, verify:
- **Gate 1** (Structure): new kit files exist at expected paths
- Main Agent MUST check `path.join(OutputDir, OutputFileRel)` / `OutputFileAbs`; do not trust reported `writtenFiles` as proof of physical output.
- **Gate 2** (CSS Reference): new index.html links `../../colors_and_type.css`

> Note: Screen count and visual quality are NOT blocking gates (see quality-gates.md Gate 4). The validator checks structural correctness only.

## Constraints

- Do NOT modify `colors_and_type.css`
- Do NOT regenerate existing kits or preview pages
- New kit MUST reuse the same token system
- New kit MUST use `<link rel="stylesheet" href="../../colors_and_type.css">` for tokens
- When component evidence exists, new kit MUST read the evidence ComponentContractFiles and MUST NOT read full component JSON during normal generation
- New kit MUST NOT invent component families absent from `components/_evidence/index.json` when evidence exists; otherwise use `components/index.json` as the allowed family list unless user explicitly requests inference mode
- Brand language and visual tone must be consistent with existing Library
