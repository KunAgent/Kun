# Redesign UI (Fork Copy Workflow)

> When the user expresses intent like "tweak the UI", "redesign the UI", "optimize the interface", "the UI doesn't look good, adjust it", use this workflow.
>
> [Note] **Core Principle: Fork a copy, do not touch originals.** Fork a copy from the target `.design` file (including `.design` entry + associated HTML + theme files), perform UI changes on the copy, and leave the original project unchanged. This way the user can see both the original and draft versions simultaneously, then decide whether to adopt the changes.
>
> [Note] **Version Rule**: The copy project's brand CSS is marked as `draft` status (e.g., filename contains `-draft` suffix), indicating this copy is a draft proposal.

| Section | Description | User-facing Title |
|---------|-------------|-------------------|
| [Applicable Scenarios](#applicable-scenarios) | Determine if user intent should follow this workflow | — |
| [Step 1 — Analyze Original Project](#step-1--analyze-original-project-main-agent) | Read original project structure and theme, determine redesign scope | Analyzing current design |
| [Step 2 — Fork Project Copy](#step-2--fork-project-copy-main-agent-direct-execution) | Main Agent directly creates draft copy directory and `.design` entry | Creating backup proposal |
| [Step 3 — Execute Design Modifications per User Intent](#step-3--execute-design-modifications-per-user-intent) | Execute UI changes on the copy | Redesigning pages |
| [Step 4 — Update copy .design](#step-4--update-copy-design-if-structural-changes-occurred--main-agent-direct-execution) | Main Agent directly updates `.design` if structural changes occurred | (Silent background, not displayed) |
| [Step 5 — Blocking Validation](#step-5--one-pass-complete-validation-main-agent-blocking--must-not-skip) | Validate copy completeness and compliance | (Silent background, not displayed) |
| [Step 6 — Guide Preview](#step-6--guide-preview-main-agent) | Guide user to preview and compare original vs. draft | Done, ready for comparison preview |

> **User-facing Title**: When the Agent displays this step in TodoList or progress messages, it **must use the expression from this column**. Using the internal section names on the left is [FORBIDDEN]. Full rules in `operation-policies/user-facing-language.md` "Language Constraints for Task Planning and Progress Display".

## Applicable Scenarios

| User Intent | Use This Workflow |
|-------------|-------------------|
| "Tweak the UI" / "Optimize the interface" / "Redesign" | Yes |
| "UI doesn't look good, adjust it" / "Switch UI style" | Yes |
| "Change this page's layout" / "Redesign the navbar" | Yes |
| Only changing colors/fonts (no layout structure changes) | No → Use `customize-theme.md` |
| Try a different layout for comparison | No → Use `generate-variants.md` |

## Step 1 — Analyze Original Project (Main Agent)

1. Determine target `.design` project path (see `operation-policies/decision-rules.md` "Pre-execution Preparation")
2. Read original `.design` file — get complete `DesignFileData` (all nodes, config, directory structure)
3. Read brand CSS file — understand current design constraints
4. Determine the scope to redesign:
   - **All pages**: User requests overall UI redesign
   - **Some pages**: User specified particular pages (e.g., "tweak the homepage UI")
5. Confirm copy project name: `{original-project-name}-draft` (e.g., `my-portfolio-draft`)
6. **Style Discovery**: If the redesign direction is unclear, use **AskUserQuestion** to collect creative intent (tone adjectives, reference brands, color/density preferences) before forking.
7. **Redesign Audit Snapshot**: Before dispatching page modifications, produce a compact audit object (max 5 actionable items). This is not a long report; it is the minimum execution brief that prevents redesign from becoming arbitrary restyling:

```json
{
  "redesignAudit": {
    "primaryIssue": "flat hierarchy | card wall | weak brand | crowding | inconsistent surfaces | missing states",
    "fixPriority": ["typography", "spacing", "surface", "interaction"],
    "preserve": ["business copy", "core navigation", "existing assets"],
    "change": ["hero composition", "card rhythm", "CTA hierarchy"],
    "risk": "do not break existing domIds"
  }
}
```

Rules:
- Pick the single most important `primaryIssue`; do not list every minor visual preference.
- `fixPriority` must contain 2-4 items ordered by expected visual impact.
- `preserve` must include any existing business content, navigation, assets, or `data-dom-id` interactions that should remain stable.
- `change` must name concrete visual structures to alter, not vague goals like "make it prettier".
- If the original page is already Library-bound, preserve Library component and token authority; the audit only identifies where the page underuses that system.

## Step 2 — Fork Project Copy (Main Agent direct execution)

> **Architecture consistency**: This step writes the `.design` file. Per SKILL.md, the Main Agent owns all `.design` writes — [FORBIDDEN] dispatching any part of this step to Sub-Agents via the Task tool. All operations below are trivial file copies/edits executed directly by the Main Agent in one pass.

Target directory structure:

```
{original-project-path}/../{original-project-name}-draft/
├── {original-project-name}-draft.design   # Copy entry file
├── assets/                    # Copy of original project's assets
└── pages/                     # Copy of original project's HTML pages
```

Execute the following in a single pass:

1. **Copy directory contents**: Create the draft directory, then copy the original project's `pages/` and `assets/` directories into it unchanged (file copy; do not use symlinks — they break on export). Do not modify any HTML content; UI changes happen in Step 3.
2. **Copy brand CSS source**: Copy the original brand CSS file into the draft project with a `-draft` suffix in its filename (e.g., `colors_and_type-draft.css`), for future `fill-html-head.mjs --replace-head` operations.
3. **Write copy `.design` entry file**: Read the original `.design`, then write `{draftProjectPath}/{draft-project-name}.design` with:
   - The complete `data` array and config fields copied from the original
   - All page nodes' `devMetadata.htmlSrc` paths kept relative (`pages/...`) so they resolve inside the draft directory
   - All nodes' `id`, `group`, `interactions` unchanged
   - Project `name` updated to the draft project name
4. Do NOT run `validate-design-file.mjs` here. Full validation is handled in Step 5.

## Step 3 — Execute UI changes on copy (Main Agent orchestration, must dispatch in parallel for multi-page)

After the copy is created, execute the user's requested UI changes on the copy project.

> **Image Pre-generation**: If the UI redesign involves new image requirements (e.g., replacing Hero image, adding feature showcase images, etc.), the Main Agent must first dispatch image generation sub-tasks in parallel (same as `create-project.md` Step 2.5). All images must complete before dispatching page UI change sub-tasks. Page change Sub-Agents are [FORBIDDEN] from calling image generation tools themselves — they can only reference existing images in `assets/`.
>
> **Sub-Agent failure handling**: See `page-generation-template.md` "Sub-Agent Failure Fallback (Universal)" for retry and skip policy.

**When involving UI redesign of multiple pages, all page change sub-tasks must be dispatched to Sub-Agents in the same round in parallel**. Sequential execution one by one is [FORBIDDEN]. Dispatch sub-tasks based on change scope:

Sub-tasks are based on the shared template `{SKILL_DIR}/workflows/page-generation-template.md` (constraint files and shared rules all in that file). All shared dispatch fields are assembled per `operation-policies/dispatch-schema.md`. Only **redesign-specific differentiated parameters** are listed below:

```
Task: Redesign page "{page title}" UI
Output: {draftProjectPath}/pages/{page-name}.html (overwrite existing file in copy)
Shared template: {SKILL_DIR}/workflows/page-generation-template.md
All shared dispatch fields: assemble per {SKILL_DIR}/operation-policies/dispatch-schema.md, populated with this project's concrete values
Differentiated input (redesign-specific):
  - Current page content: {read HTML from copy}
  - Modification requirements: {user's specific requirements}
  - Redesign audit snapshot: {redesignAudit object from Step 1; format per dispatch-schema.md §9}
  - Design context: {overall style of original project, layout references from other pages}
  - Available image resources: {format per dispatch-schema.md §11; include both newly generated images and existing reusable assets from the copy's assets/ directory, filtered to this page. When no new images were generated, pass existing reusable assets only.}
Additional notes (redesign-specific rules):
  - This is a UI redesign task (overwrite modification, not appending new pages); do not append .design nodes.
  - Do not run fill-html-head.mjs unless the redesign involves theme CSS changes (in which case use `fill-html-head.mjs --replace-head` to update `<head>` while preserving `<main>` content).
  - HTML structure, layout, and component choices may be modified, but keep the page's core business content (copy, images) unchanged.
  - Use the Redesign audit snapshot as the primary fix target. Completion report must include `redesignEvidence` with `issuesFixed`, `contentPreserved`, and `domIdImpact`.
  - Maintain style consistency with other pages in the copy.
  - After modification, if elements with data-dom-id attributes are removed or restructured, update the corresponding interactions in .design.
```

## Step 4 — Update copy .design (if structural changes occurred) → Main Agent direct execution

> **Architecture consistency**: Since the Main Agent exclusively manages `.design` files, this step is executed directly by the Main Agent (not dispatched as a sub-task).

If the UI redesign process caused changes in inter-page interaction relationships (e.g., a navigation link was removed or `data-dom-id` was migrated to a different element):

1. **Collect change reports** from Sub-Agents: Each Sub-Agent that restructured elements carrying `data-dom-id` reports which domIds were removed, added, or migrated
2. **Read** the copy `.design` file once
3. **Update interactions**: For each affected page node:
   - Remove interaction entries whose `domId` no longer exists in the HTML
   - Keep interaction entries whose `domId` was migrated to a new element (the wiring remains valid)
   - If a Sub-Agent added new `data-dom-id` (per wiring-strategy.md rules), add corresponding interaction entries
4. **Write back** once
5. **Re-read once** to confirm all interaction entries reference valid domIds and targetPageIds

If no structural changes affected `data-dom-id` attributes, skip this step entirely.

### 4b — Register Image Nodes (if new images were generated in Step 3)

> **Mandatory when Step 3 Image Pre-generation produced new files under `assets/`.** Per Core Invariant #6a, every image file under `assets/` must be registered as a `type: "image"` node in `.design`.

If Step 3 generated new image assets:

1. **List** all new image files created in `{draftProjectPath}/assets/` during this workflow
2. **Read** the copy `.design` file
3. **Append** one image node per new file to the `data` array, using the "Image Node" spec in `file-specs/design-file-structure.md` (the SSOT for the full field template — `id` continues the project-wide `image-NNN` counter, `title` is a semantic description in the user's language and never a mechanical Title Case conversion, plus `version`/`createdAt`/`devMetadata.imageSrc`/`canvasData` per that spec)
4. **Write back** the updated `.design` file

If Step 3 did NOT involve image pre-generation, skip this sub-step entirely.

## Step 5 — One-pass Complete Validation (Main Agent, Blocking — must not skip)

> **This step is blocking. Before guiding the user to preview, the Main Agent must personally execute this validation.**

Use `scan-design-directory.mjs` for one-pass complete validation of the copy project, avoiding multiple tool calls:

```bash
node {SKILL_DIR}/script/scan-design-directory.mjs <draft-project-path> --expected-pages=<N>
```

Where `<draft-project-path>` is the copy project root directory path, and `<N>` is the total page count in the copy project.

When exit code is 1, follow the repair procedure in `operation-policies/design-project-validation.md`.

## Step 6 — Guide Preview (Main Agent)

Inform the user:
1. A UI redesign draft copy has been created
2. The original project remains unchanged and can be compared at any time
3. Keep the textual summary link-free and rely on the host-rendered artifact entry for the copy project's `.design` artifact

**Finish summary must not include manual links** (see SKILL.md "Artifact Declaration" section). The host-rendered artifact entry should represent the **copy project's** `.design` artifact; textual summary still contains no link.

> This workflow's brand CSS output must carry the `-draft` suffix. [FORBIDDEN] Modifying the original project's brand CSS or any original project file.
