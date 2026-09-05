---
name: kun-tool-router
description: "Route requests to the narrowest real Kun tool family and define the required verification boundary."
---

# Kun Tool Router
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Route requests to the narrowest real Kun tool family and define the required verification boundary.

## Tool routing
| Tool or skill | Use |
|---|---|
| `fast_context` | First retrieval step for repository exploration. |
| `browser_use` | Structured interactive public browsing. |
| `design_update_shapes` | Editable canvas changes. |
| `ppt_agent` | Native presentation workflow. |
| `office_inspect` | Inspect Office documents. |
| `mcp_search` | Discover connected integrations. |

## Workflow
1. Classify the output: prose, file, code, browser action, design, chart, diagram, presentation, media, schedule, or integration.
2. Choose the most specific advertised tool.
3. Inspect current state before mutation.
4. Perform the smallest coherent action.
5. Verify using the closest observable output.

## Completion gates
- Do not assume a surface or tool that is not advertised in the current turn.
- Respect dependent sequencing; parallelize only independent reads.
- Report unresolved failures without hiding them.

## Boundaries
- This skill routes work; it does not grant additional authorization.
- Never replace a specialized governed workflow with a shell workaround.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
