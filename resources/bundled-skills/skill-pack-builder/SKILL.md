---
name: skill-pack-builder
description: "Create, validate, package, and optionally install original KunAgent skills."
---

# KunAgent Skill Pack Builder
Copyright (c) 2026 KunAgent. Licensed under the MIT License.

## Purpose
Create, validate, package, and optionally install original KunAgent skills.

## Tool routing
| Tool or skill | Use |
|---|---|
| `read` | Inspect existing skill examples or source material. |
| `write` | Create new skill files. |
| `edit` | Apply focused changes to existing skill files. |
| `bash` | Run local validators and package archives. |
| `load_skill` | Load a registered skill by id when needed. |

## Workflow
1. Define the reusable job, triggers, real tool dependencies, boundaries, and verification gates.
2. Create SKILL.md with concise YAML frontmatter and operational instructions.
3. Create skill.json with stable id, version, entry, triggers, and priority.
4. Add only necessary scripts, references, and assets.
5. Validate links, metadata, tool names, syntax, license, and prohibited secrets before packaging.

## Completion gates
- Every advertised tool must exist in the current Kun catalog or be discovered dynamically.
- Installation into ~/.kun/skills requires explicit user intent.
- Keep a root manifest and one license per independently distributable skill.

## Boundaries
- Do not copy proprietary prompts, templates, assets, or licenses into a new copyright package.
- Do not claim compatibility with a service that has not been tested.

## Delivery
Lead with the outcome, name the evidence used for verification, and disclose any real limitation that remains.
