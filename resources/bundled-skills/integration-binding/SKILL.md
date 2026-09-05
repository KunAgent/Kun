---
name: integration-binding
description: "Connect a task to MCP tools, workflows, resources, files, or visual outputs through explicit validated interfaces."
---

# Integration Binding
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Connect a task to MCP tools, workflows, resources, files, or visual outputs through explicit validated interfaces.

## Tool routing
| Tool or skill | Use |
|---|---|
| `mcp_search` | Discover an integration by intent. |
| `mcp_describe` | Load the exact input schema. |
| `mcp_call` | Invoke a connected MCP tool. |
| `mcp_list_resources` | List server resources. |
| `mcp_read_resource` | Read one selected resource. |
| `mcp_read_only_call` | Use an approved read-only integration in Plan mode. |

## Workflow
1. Name the required capability and whether it reads or mutates external state.
2. Discover candidates instead of guessing an id.
3. Inspect the selected schema.
4. Call with the minimum arguments and privilege.
5. Validate the returned data at the next system boundary.

## Completion gates
- Use exact tool ids, resource URIs, and schemas from discovery output.
- For mutations, confirm that user authorization covers the exact external effect.
- Read back or otherwise verify externally visible changes.

## Boundaries
- Never invent a connector or silently fall back to an unrelated service.
- Never include secrets or private source material in discovery queries.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
