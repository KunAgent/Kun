// Shared CSS custom-property name character class — single source of truth.
// Widest version across all scripts: ASCII word chars + hyphen + CJK Unified
// Ideographs (U+4E00–U+9FFF) + CJK Extension A (U+3400–U+4DBF), supporting
// Chinese token names such as `--碧涛青-1`.
//
// Usage:
//   import { CSS_VAR_NAME } from './css-utils.mjs';
//   new RegExp(`--([${CSS_VAR_NAME}]+)\\s*:`, 'g')

export const CSS_VAR_NAME = 'A-Za-z0-9_\\-\\u4e00-\\u9fff\\u3400-\\u4dbf';

// css.json top-level schema keys — single source of truth shared by the
// producer (css-to-json.mjs) and the validator (check-design-library-phase.mjs).
export const REQUIRED_CSS_JSON_KEYS = [
  'color',
  'font',
  'shadow',
  'radius',
  'spacing',
  'size',
];
