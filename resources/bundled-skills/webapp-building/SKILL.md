---
name: webapp-building
description: "Build or modify production-oriented web applications by following the repository architecture and validating real user flows."
---

# Web Application Building
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Build or modify production-oriented web applications by following the repository architecture and validating real user flows.

## Tool routing
| Tool or skill | Use |
|---|---|
| `fast_context` | Retrieve repository architecture before exploration. |
| `read` | Read relevant source files. |
| `edit` | Apply focused changes. |
| `write` | Create necessary new files. |
| `bash` | Run project scripts. |
| `verify_changes` | Run focused or full acceptance checks. |
| `design_component` | Prototype a single component when the user requests a prototype rather than production code. |

## Workflow
1. Inspect the repository, package scripts, design system, routing, and data boundaries.
2. Trace the smallest affected user flow.
3. Implement within existing conventions and preserve unrelated behavior.
4. Validate inputs, loading, error, empty, success, and responsive states.
5. Run focused checks, then broader checks proportional to risk.

## Completion gates
- Use semantic HTML, keyboard access, visible focus, and accessible contrast.
- Verify at real API, routing, persistence, and build boundaries.
- Report any baseline failures separately from introduced failures.

## Boundaries
- Do not scaffold a new framework inside an existing app without need.
- Do not deploy, publish, or change external infrastructure without explicit authorization.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
