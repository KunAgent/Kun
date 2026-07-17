---
name: Responsive Design Patterns
description: Mobile-first responsive design techniques and breakpoints
category: responsive
tags: ["responsive", "mobile", "breakpoints"]
difficulty: intermediate
---

# Responsive Design Patterns

Mobile-first approach with progressive enhancement for larger screens.

## Breakpoints

Standard breakpoints for responsive layouts:

```css
/* Mobile: 320px - 767px */
/* Tablet: 768px - 1023px */
/* Desktop: 1024px+ */

@media (min-width: 768px) {
  /* Tablet styles */
}

@media (min-width: 1024px) {
  /* Desktop styles */
}
```

## References

[MDN Responsive Design](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)
