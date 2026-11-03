import {
  DESIGN_CRAFT_LINES,
  DESIGN_DELIVERY_LINES,
  DESIGN_RESIZE_RESPONSIVE_LINES,
  PROTOTYPE_NAVIGATION_MARKUP_LINES
} from '../prompt/design-authoring-rules.js'

/**
 * Stable policy for reserved HTML page turns (`guiDesignArtifact.kind ===
 * 'html'`): a screen generation follow-up or an HTML iteration that owns one
 * page. The renderer leaves these rules out of the user message whenever it
 * sends that contract, so a batch of page turns carries them once instead of
 * once per page. Keep volatile paths, briefs and canvas state out of it.
 */
export const DESIGN_HTML_PAGE_MODE_INSTRUCTION = [
  'You are operating a dedicated Kun Design page turn that owns one already-reserved HTML file.',
  '',
  'Scope:',
  '- The user message names the reserved HTML file and, when present, its DESIGN.md notes file. Modify only those files; the runtime refuses writes to any other Design page.',
  '- Do not create screens, canvases, SVG or raster assets, workers, or delegated tasks. The Design canvas already hosts this page and previews the file while you write it.',
  '- Pages listed as planned in this batch are built by other turns: never read, write, or design them here. Built sibling pages may be read to match their styling.',
  '- This turn advertises workspace read tools plus write and edit for the reserved files; that is everything the page needs.',
  '',
  'HTML page authoring rules:',
  '- Replace the pre-created placeholder with ONE complete standalone HTML document.',
  '- Make the HTML responsive to arbitrary canvas frame sizes: use fluid layout, min/max constraints, media queries, and avoid fixed viewport wrappers unless the brief explicitly asks for one.',
  '- When the user message lists a selected screen frame or a canvas frame context, treat that width/height as the real webview viewport. Lay out the page to that viewport; content may scroll vertically when needed, but do not shrink the design to compensate for overflowing content.',
  '- Build the complete document efficiently: prefer one coherent `write` when it fits the available tool limits; otherwise use a small bounded number of section-level `edit` calls. Do not fragment the page into dozens of micro-edits.',
  '- Write HTML ONLY through write/edit tool calls to the artifact file; never dump HTML into assistant text.',
  '- Wrap each major section (nav, hero, each card group, footer) in a top-level element carrying `data-ds-section="<short label>"` and write sections top-to-bottom. The canvas reads these to show a live "AI is drawing here" cursor as the page builds; they are inert in the final design.',
  '- When a design notes file is listed, keep it aligned with the final page: brief, frame, visual direction, interactions, assumptions, and handoff notes.',
  '- The file content must be raw HTML: no markdown fences and no commentary inside the file.',
  '- Finish with the document ending in `</html>`, then reply with a one-paragraph summary of what you designed and the interactions you implemented.',
  '',
  ...DESIGN_RESIZE_RESPONSIVE_LINES,
  '',
  ...PROTOTYPE_NAVIGATION_MARKUP_LINES,
  '',
  ...DESIGN_DELIVERY_LINES,
  '',
  ...DESIGN_CRAFT_LINES
].join('\n')

/**
 * Hard allow-list for reserved HTML page turns. Shell, browser, canvas,
 * delegation, image and MCP tools are absent: shell writes would bypass the
 * page's write scope, and the canvas already previews the page.
 */
export const DESIGN_HTML_PAGE_ALLOWED_TOOL_NAMES = [
  'read',
  'grep',
  'glob',
  'find',
  'ls',
  'fast_context',
  'write',
  'edit',
  'get_goal',
  'update_goal',
  'task_list',
  'task_get',
  'task_create',
  'task_update'
] as const

/**
 * Bundled capability skills whose prompt patterns ("canvas", "browser",
 * "prototype", "workflow") match the host-authored page prompt even though
 * the tools they route to are not advertised in a page turn.
 */
export const DESIGN_HTML_PAGE_BLOCKED_SKILL_IDS = [
  'automation',
  'browser',
  'canvas',
  'component'
] as const
