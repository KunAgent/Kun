# Engineering Workflow Coach (engineering-workflow-skills)

Senior engineering workflow expert for CodeBuddy. Covers the full lifecycle a staff engineer actually follows: spec → plan → build → verify → review → ship.

This is a port of [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, original work by Addy Osmani). The 21 source skills are reorganized into a single unified skill with progressive disclosure via reference files.

## What's inside

### 1 Agent + 1 Unified Skill (with 21 reference modules)

| Component | Role |
|-----------|------|
| `engineering-workflow-coach` | Main agent. Routes users to the right phase, enforces 6 core operating behaviors, includes specialist modes (Code Review, Security Audit, Test Engineering). |
| `engineering-workflow` | Single registered skill with phase-based routing. Loads detailed reference files on demand. |

### Specialist Modes (built into the main agent)

| Mode | When activated |
|------|---------------|
| Code Review Mode | User wants a five-axis review (correctness, readability, architecture, security, performance) |
| Security Audit Mode | User wants OWASP-style security pass with severity ratings |
| Test Engineering Mode | User wants test design, coverage analysis, or Prove-It bug tests |

### Reference Files (progressive disclosure)

All 21 original skills are preserved as reference files under `skills/engineering-workflow/reference/`, loaded on demand:

| Phase | References |
|-------|-----------|
| Define & Plan | idea-refine, spec-driven-development, planning-and-task-breakdown |
| Build | incremental-implementation, source-driven-development, context-engineering, api-and-interface-design, frontend-ui-engineering |
| Verify | test-driven-development, browser-testing-with-devtools, debugging-and-error-recovery |
| Review | code-review-and-quality, code-simplification, security-and-hardening, performance-optimization |
| Ship | git-workflow-and-versioning, ci-cd-and-automation, documentation-and-adrs, shipping-and-launch, deprecation-and-migration |

## How to use

Just talk to the expert. The coach will identify your engineering phase, load the relevant reference, and guide you through the workflow.

Quick prompts:
- "我有个新功能要开发，帮我从 spec 到任务拆解做完整规划" → Define & Plan
- "从正确性、安全、性能、可维护性几个维度评审这段代码" → Review (Code Review Mode)
- "帮我搭建 CI/CD 流水线和发布检查清单" → Ship

## Architecture: Progressive Disclosure

Instead of registering 21 independent skills (which increases model routing burden), this expert uses a **single entry-point skill** that routes to reference files on demand:

```
Model sees: 1 skill description (engineering-workflow)
                    ↓
SKILL.md routes by user intent
                    ↓
@reference/xxx.md loaded (only what's needed)
```

Benefits:
- Minimal model routing burden (1 description vs 21)
- Full content preserved (zero information loss)
- Fine-grained loading (3-5KB per reference vs 15KB+ per merged phase)
- Easy maintenance (update individual reference files independently)

## Attribution & License

MIT licensed. See [LICENSE](./LICENSE). Original work copyright © 2025 Addy Osmani; CodeBuddy port adds the routing wrapper, progressive disclosure architecture, and packaging adjustments.

Source: <https://github.com/addyosmani/agent-skills>
