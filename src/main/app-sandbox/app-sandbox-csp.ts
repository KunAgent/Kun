import type { McpAppResourceMeta } from '../../../kun/src/contracts/mcp-apps'
import { GEN_UI_STATIC_ORIGINS } from '../../../kun/src/contracts/gen-ui'
export { GEN_UI_STATIC_ORIGINS } from '../../../kun/src/contracts/gen-ui'

/** The shell only frames its own guest; it loads nothing else. */
export function buildShellCsp(guestOrigin: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `frame-src ${guestOrigin}`,
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}

/**
 * Gen UI pages are model-authored. They may run inline scripts, but they cannot
 * open connections, frame other pages or submit forms.
 */
export function buildGenUiCsp(shellOrigin: string): string {
  const statics = GEN_UI_STATIC_ORIGINS.join(' ')
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' blob: ${statics}`,
    `style-src 'self' 'unsafe-inline' ${statics}`,
    `img-src 'self' data: blob: ${statics}`,
    `font-src 'self' data: ${statics}`,
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
    `frame-ancestors ${shellOrigin}`
  ].join('; ')
}

function origins(values: readonly string[] | undefined): string[] {
  return [...new Set(values ?? [])]
}

/**
 * MCP App CSP: the spec's restrictive default plus only the domains the HTML
 * resource declared in `_meta.ui.csp`. `blob:`/`data:` scripts add no power
 * beyond the required `'unsafe-inline'` and keep single-file bundles working.
 */
export function buildMcpAppCsp(input: {
  shellOrigin: string
  meta: McpAppResourceMeta
}): string {
  const resource = origins(input.meta.csp?.resourceDomains)
  const connect = origins(input.meta.csp?.connectDomains)
  const frame = origins(input.meta.csp?.frameDomains)
  const baseUri = origins(input.meta.csp?.baseUriDomains)
  const scripts = [
    "'self'",
    "'unsafe-inline'",
    'blob:',
    'data:',
    ...(input.meta.unsafeEval ? ["'unsafe-eval'"] : []),
    ...(input.meta.wasmUnsafeEval ? ["'wasm-unsafe-eval'"] : []),
    ...resource
  ]
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ')}`,
    `style-src ${["'self'", "'unsafe-inline'", ...resource].join(' ')}`,
    `img-src ${["'self'", 'data:', 'blob:', ...resource].join(' ')}`,
    `media-src ${["'self'", 'data:', 'blob:', ...resource].join(' ')}`,
    `font-src ${["'self'", 'data:', ...resource].join(' ')}`,
    `connect-src ${connect.length > 0 ? ["'self'", ...connect].join(' ') : "'self'"}`,
    `frame-src ${frame.length > 0 ? frame.join(' ') : "'none'"}`,
    `base-uri ${["'self'", ...baseUri].join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "form-action 'none'",
    `frame-ancestors ${input.shellOrigin}`
  ].join('; ')
}
