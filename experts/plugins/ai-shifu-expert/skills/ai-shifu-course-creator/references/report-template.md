# Course Author Report Template

Use the section matching the executed phase. Omit sections for phases not run.

## Formatting Rules

These rules apply to every report produced from this template, and to any other user-visible chat output that includes URLs.

- **Links must be Markdown, never bare URLs.** Whenever you show a URL to the user (admin console, course preview, contact page, etc.), wrap it in Markdown link syntax `[descriptive text](URL)`. Never emit a bare `https://...` on its own line.
- **Why:** the AI-Shifu chat client only treats Markdown links as clickable / copy-on-tap. A bare URL renders as plain text — the user cannot click it and cannot copy it cleanly on mobile.
- **Where this applies:** phase reports below, the opening introduction, contact mentions, and any ad-hoc message that surfaces a URL to the user.
- **Where this does NOT apply:** URLs inside Teaching Prompts (those follow MarkdownFlow image / link rules) and URLs shown inside fenced code blocks for reference.
- **Exception — deployment / management Verification URLs.** When transcribing the `Verification URLs:` block printed by `shifu-cli.py` (`publish` / `import` / `create` / `show`), emit each URL as **three lines**:
  1. A Markdown link — `[<course name> - <用途中文标签>](<URL>)`
  2. The same URL again on its own line (intentionally bare), indented two spaces — so the user can long-press / select to copy it cleanly.
  3. The script's following Chinese `# ...` hint, copied verbatim without the leading `#`.
  The bare URL on line 2 is the only place a bare URL is allowed; it exists because copying out of a rendered Markdown link is unreliable on some clients.

## Segmentation Report

- Source files:
- Processing mode: `standard|fallback`
- Total segments:
- Lesson candidates:
- Immutable blocks preserved:

Validation:

- Source span traceability: `pass|fail`
- Immutable block preservation: `pass|fail`
- One-core-question lesson check: `pass|fail`

Issues:

- Blocking issues:
- Non-blocking suggestions:

Next actions:

- Targeted reruns:
- Downstream handoff notes:

## Orchestration Report

- Input set:
- Execution mode: `standard|fallback`
- Constraints:
- Lesson files generated:
- Course index status:
- Variable table status:

Gate results:

- Preservation gate: `pass|fail`
- One-core-question gate: `pass|fail`
- Interaction safety gate: `pass|fail`
- Variable safety gate: `pass|fail`

Issues:

- Blocking issues:
- Suggestions:

Rerun plan:

- Lessons to rerun:
- Dependency-linked lessons:

## Generation Report

- Lesson id:
- Execution mode: `standard|fallback`
- Constraints:
- Script generated: `yes|no`
- Interaction count:
- Variables used:

Validation:

- Syntax validity: `pass|fail`
- Variable safety: `pass|fail`
- Visual-text coordination: `pass|fail`
- Teaching loop completeness: `pass|fail`

Issues:

- Blocking issues:
- Suggestions:

Follow-up:

- Rerun needed: `yes|no`
- Upstream dependency notes:

## Optimization Report

- Target script(s):
- Source material set:
- Execution mode: `standard|fallback`
- Overall risk: `low|medium|high`

Issue breakdown:

- Coverage gaps:
- Meaning shifts:
- Interaction issues:
- Visual issues:
- Variable/syntax issues:

Changes applied:

- File references:
- Minimal-edit rationale:

Validation:

- Syntax check: `pass|fail`
- Variable safety check: `pass|fail`
- Interaction branching check: `pass|fail`
- Density preservation check: `pass|fail`

## Deployment Report

- Course directory:
- Build result: `success|fail`
- Import result: `success|fail`
- Shifu BID:
- Lesson count imported:
- Publish result: `success|fail`

Validation:

- Import without errors: `pass|fail`
- Course accessible via URL: `pass|fail`
- Lesson count matches source: `pass|fail`
- Preview mode reachable: `pass|fail`

Verification URLs:

The deployment script (`shifu-cli.py publish` / `import` / `create` / `show`) prints a `Verification URLs:` block. **What you must show the user is dictated by what the script printed — don't add lines that aren't there, don't drop lines that are.** Possible lines:

- `Admin console:` — always present.
- `Course preview:` — always present.
- `Published URL:` — present only after `publish` and on `show` (i.e. when the course is in a published state). `create` / `import` deliberately omit it because the course is not yet published; the public address would 404.

Lesson-level preview URLs are no longer printed at all (they used to clutter reports for multi-lesson courses). If the user later asks for a specific lesson link, run `show <shifu_bid>` to find the `outline_bid` and hand-build `<base>/c/<bid>?preview=true&lessonid=<outline_bid>` on demand — don't pre-emit them.

Copy each printed URL **verbatim** (never reconstruct from a template, never hand-edit query parameters) and render it as three lines per the top-level Formatting Rules exception. The third line must be the script's following `# ...` hint copied verbatim, with the leading `#` and surrounding indentation removed. This keeps the script as the single source of truth for link-purpose and credit-consumption wording.

- `Admin console:` → label `管理后台`

  ```md
  - [<course name> - 管理后台](<URL from script>)
    <URL from script>
    <Chinese hint copied verbatim from the script output, without "#">
  ```

- `Course preview:` → label `预览课程`

  ```md
  - [<course name> - 预览课程](<URL from script>)
    <URL from script>
    <Chinese hint copied verbatim from the script output, without "#">
  ```

- `Published URL:` (only when the script printed it) → label `课程学习`

  ```md
  - [<course name> - 课程学习](<URL from script>)
    <URL from script>
    <Chinese hint copied verbatim from the script output, without "#">
  ```

When the script did **not** print `Published URL:` (typical for fresh `create` / `import` runs), show only the two existing blocks and add one line below them: `> 课程尚未发布，运行 \`publish <shifu_bid>\` 后会得到可对外分享的地址。`
