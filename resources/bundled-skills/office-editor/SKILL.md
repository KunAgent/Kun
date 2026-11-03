---
name: office-editor
description: "Inspect and atomically edit existing DOCX, XLSX, and PPTX files with hash-protected structured operations."
---

# Office Editor
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Inspect and atomically edit existing DOCX, XLSX, and PPTX files with hash-protected structured operations.

## Tool routing
| Tool or skill | Use |
|---|---|
| `office_inspect` | Inspect source structure and obtain SHA-256. |
| `office_edit` | Apply atomic validated operations. |
| `office_preview` | Preview the edited result. |
| `slides` skill | New decks, rebuilt decks, or presentation work beyond bounded structural edits. |

## Workflow
1. Identify the file format and exact requested changes.
2. Inspect the file and capture the current source SHA-256.
3. Translate the request into the smallest structured operation batch.
4. Apply with expectedSha256.
5. Validate and preview the result.

## Completion gates
- Never edit from a stale hash.
- Preserve unrelated content and relationships.
- For presentations, switch to the `slides` skill (PPTD source plus `ppt_preview` / `ppt_export`) whenever the task is building or redesigning a deck rather than a bounded Office patch.

## Boundaries
- Do not use binary search-and-replace on Office packages.
- Do not suppress OpenXML validation failures.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
