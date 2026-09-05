---
name: docx
description: "Inspect, edit, validate, and preview existing Word documents while preserving structure and unrelated content."
---

# DOCX Documents
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Inspect, edit, validate, and preview existing Word documents while preserving structure and unrelated content.

## Tool routing
| Tool or skill | Use |
|---|---|
| `office_inspect` | Inspect existing DOCX structure, text, issues, and obtain the source hash. |
| `office_edit` | Apply atomic hash-protected edits to an existing DOCX. |
| `office_preview` | Preview the edited document. |
| `send_im_attachment` | Send the resulting file through IM when explicitly requested. |

## Workflow
1. Require an existing DOCX file for inspection or editing.
2. Inspect the source and capture its current SHA-256.
3. Translate the request into the smallest structured operation batch.
4. Apply office_edit with expectedSha256.
5. Validate and preview the edited document before delivery.

## Completion gates
- Preserve headings, lists, tables, relationships, and unrelated formatting.
- Check that the output is a valid DOCX package.
- Confirm requested text and layout in preview or inspection output.

## Boundaries
- This Kun environment does not include a native create-from-scratch DOCX generator.
- Do not rename plain text to .docx or install document libraries implicitly.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
