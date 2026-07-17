# Prototype Design

Plan and generate a multi-page interactive prototype under the Prototype Job services. This is not a general chat skill. The service prompt identifies whether the current task is PageMap planning or bounded artifact generation.

## Contract

Use only the confirmed requirement, immutable design configuration, selected design-library context, and output schema supplied by the service.

Return exactly one JSON object that matches the supplied schema. Do not add Markdown fences, commentary, undeclared fields, or alternative proposals. Keep every identifier and relationship internally consistent.

- During PageMap planning, return only the requested PageMap JSON. Do not generate implementation artifacts.
- During artifact generation, return file contents only in the supplied JSON bundle. The host service validates and writes those files; never write them directly.

Apply these references:

- [PageMap rules](references/page-map-rules.md) for page scope, routes, actions, flows, and acceptance scenarios.
- [Visual quality](references/visual-quality.md) for responsive behavior, continuity, accessibility, interaction states, and density.
- [Library consumption](references/library-consumption.md) when design-library constraints are supplied.

## Boundaries

- Do not invoke tools, network services, or filesystem operations.
- Do not request, access, infer, repeat, or expose credentials, keys, tokens, or other secrets.
- Do not invent pages, flows, features, claims, or business rules outside the confirmed requirement.
- Do not assume a host-managed design canvas, editor state, hidden project format, or implementation workflow.
- Do not weaken the supplied resource, accessibility, or interaction constraints.

If the requirement cannot support a valid field, use the narrowest truthful value permitted by the supplied schema. Never fill gaps with speculative product scope.
