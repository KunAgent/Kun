# Visual Quality

Encode quality decisions in page purpose, components, states, actions, shared shell, and acceptance scenarios. Do not describe an implementation that the PageMap schema does not request.

## Responsive behavior

- Honor the configured platform, viewport, responsive flag, and breakpoints.
- When responsiveness is enabled, plan layouts that can reflow rather than merely shrink: columns stack, navigation adapts, controls retain usable width, and dense data receives an intentional narrow-screen treatment.
- Preserve one brand system across viewport sizes. Layout density, type scale, and navigation form may adapt; color, typography family, radius language, and component character must remain continuous.
- Prefer several focused pages or progressive disclosure over one overloaded surface. Keep task pages compact and give dense content enough room to scan.

## Cross-page continuity

- Reuse a stable shell, navigation vocabulary, primary action treatment, type hierarchy, spacing rhythm, radius scale, and surface/depth model.
- Preserve at least two explicit continuity anchors across related pages. Do not redesign the header, navigation, cards, or controls independently on each page.
- Represent sibling states with the same shell and component structure. Change only the state-specific content or active control identified by the requirement.
- Keep back, close, cancel, retry, and completion behavior predictable across flows.

## Accessibility and interaction

- Plan semantic controls with clear labels, keyboard-reachable actions, visible focus, sufficient target size, and understandable feedback.
- When WCAG AA is configured, require adequate contrast and do not rely on color alone to communicate state.
- Include relevant default, hover/focus, disabled, validation, submitting/loading, empty, error, success, and populated states. Include only states that make sense for the page.
- Require labels for inputs, useful alternative text for meaningful images, and reduced or absent motion according to configuration.
- Make destructive actions explicit and recoverable when the confirmed requirement includes them.

## Density and hierarchy

- Follow the configured density instead of applying one layout rhythm everywhere.
- For information-dense pages, prioritize scanning, grouping, and clear actions; reduce decoration and fragmented card grids.
- For task-driven pages, give controls the dominant usable area and keep supporting information secondary.
- For showcase pages, allow more whitespace and visual rhythm while preserving concise headings and real business content.
- Group related content more tightly than unrelated sections. Avoid narrow multi-column regions, nested cards, pill overload, arbitrary decoration, and multiple competing primary actions.

## Fidelity and realism

- Use business-specific labels and representative data without fabricating customer names, measured outcomes, endorsements, or unsupported product capabilities.
- Prefer one clear visual hierarchy and one primary action per page.
- Ensure every planned component supports the page purpose or a confirmed interaction; omit decorative filler.
