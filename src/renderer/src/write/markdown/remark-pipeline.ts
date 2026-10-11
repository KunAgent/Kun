/**
 * Re-export of the shared parse pipeline (see
 * `src/shared/markdown/parse-mdast.ts`). Kept as a module so renderer code
 * has a stable local import path.
 */
export { parseWorkMdast as parseMarkdownToMdast } from '@shared/markdown/parse-mdast'
