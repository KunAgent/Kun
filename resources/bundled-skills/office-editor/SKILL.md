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
| `ppt_agent` | Use the governed workflow for presentation tasks beyond bounded structural edits. |

## Workflow
1. Identify the file format and exact requested changes.
2. Inspect the file and capture the current source SHA-256.
3. Translate the request into the smallest structured operation batch.
4. Apply with expectedSha256.
5. Validate and preview the result.

## Completion gates
- Never edit from a stale hash.
- Preserve unrelated content and relationships.
- For presentations, use ppt_agent whenever the task is a presentation workflow rather than a bounded Office patch.

## Boundaries
- Do not use binary search-and-replace on Office packages.
- Do not suppress OpenXML validation failures.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
