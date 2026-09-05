---
name: automation
description: "Create, inspect, update, delete, and run Kun scheduled tasks or saved workflows."
---

# Kun Automation
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Create, inspect, update, delete, and run Kun scheduled tasks or saved workflows.

## Tool routing
| Tool or skill | Use |
|---|---|
| `mcp_gui_schedule_gui_schedule_list` | List current schedules before a mutation. |
| `mcp_gui_schedule_gui_schedule_create` | Create one-time, daily, or interval schedules. |
| `mcp_gui_schedule_gui_schedule_update` | Update a schedule by returned task id. |
| `mcp_gui_schedule_gui_schedule_delete` | Delete only the explicitly selected task. |
| `mcp_gui_schedule_list_workflows` | Discover user-saved workflows. |
| `mcp_gui_schedule_run_workflow` | Run a named saved workflow. |
| `task_graph` | Model dependencies inside the current thread. |

## Workflow
1. Determine whether the user needs a schedule, a saved workflow, or an in-thread dependency graph.
2. Read existing state before updating or deleting.
3. For schedules, choose exactly one kind: at, daily, or interval.
4. Preserve the conversation execution settings when available.
5. Read back the resulting schedule or workflow output.

## Completion gates
- Persistent create/update/delete actions require explicit user intent.
- Report the returned task id and effective timing.
- Never claim a scheduled run has executed before observing its result.

## Boundaries
- Do not infer recurring intent from a one-time request.
- Do not bypass schedule APIs with OS cron or background shell processes.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
