# Deprecated Guard — Do Not Create Design Systems Here

This workflow is intentionally deprecated. `solo-design` creates and edits design pages; it does **not** create reusable Design Libraries or Design Systems.

## Routing Guard

| User Intent | Correct Route |
| --- | --- |
| Create reusable Design Library / Design System / "沉淀设计风格" without page creation intent | Out of scope for `solo-design`; use `design-library-creator` |
| Create pages while providing brand colors, fonts, or visual style parameters | Use `workflows/create-project.md` Step 1 to generate project-local temporary `colors_and_type.css` |
| Apply a new visual direction to an existing design project | Use `workflows/customize-theme.md` |
| User-selected Design Library exists | Parse and follow that Library via `operation-policies/design-library-parsing.md`; do not create a new system |

## Mandatory Behavior

- Do not dispatch subtasks from this file.
- Do not create a reusable Library directory, `css.json`, component library, or Design System artifact.
- If this file is reached accidentally, stop and reroute using the table above.
