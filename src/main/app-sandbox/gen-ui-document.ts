import type { AppSandboxTheme } from '../../shared/app-sandbox'
import { GEN_UI_BRIDGE_SCRIPT } from './gen-ui-bridge-script'

/** Public page tokens; the renderer sends resolved Kun colors for these keys. */
export const GEN_UI_THEME_KEYS = [
  'foreground',
  'card',
  'muted',
  'mutedForeground',
  'accent',
  'accentSoft',
  'border',
  'ring',
  'danger',
  'success',
  'warning',
  'surface'
] as const
export type GenUiThemeKey = (typeof GEN_UI_THEME_KEYS)[number]

const COLOR_VALUE_PATTERN = /^[#a-zA-Z0-9(),.%\s/+-]{1,80}$/

const FALLBACK: Record<'light' | 'dark', Record<GenUiThemeKey, string>> = {
  light: {
    foreground: '#1f2328', card: '#ffffff', muted: '#f3f4f6', mutedForeground: '#5b636e',
    accent: '#3b6fe0', accentSoft: '#e8efff', border: '#e1e4e8', ring: '#3b6fe0',
    danger: '#d1383d', success: '#1f8a4c', warning: '#b7791f', surface: '#ffffff'
  },
  dark: {
    foreground: '#e6e8eb', card: '#1e2024', muted: '#2a2d32', mutedForeground: '#9aa1ab',
    accent: '#7aa2ff', accentSoft: '#26324d', border: '#33363c', ring: '#7aa2ff',
    danger: '#f06a6f', success: '#4cc27f', warning: '#e0a84a', surface: '#17191c'
  }
}

const SERIES: Record<'light' | 'dark', string[]> = {
  light: ['#3b6fe0', '#e07b39', '#2f9e67', '#8b5cf6', '#d1383d', '#0f9fb0'],
  dark: ['#7aa2ff', '#f0a06a', '#5fd09a', '#b39cff', '#f2797d', '#4cc9d9']
}

/** Accept only plain color syntax so a theme value can never break out of CSS. */
export function sanitizeThemeColors(theme: AppSandboxTheme): Record<GenUiThemeKey, string> {
  const mode = theme.mode === 'dark' ? 'dark' : 'light'
  const resolved = { ...FALLBACK[mode] }
  for (const key of GEN_UI_THEME_KEYS) {
    const value = theme.colors[key]?.trim()
    if (value && COLOR_VALUE_PATTERN.test(value) && !/url\s*\(/i.test(value)) resolved[key] = value
  }
  return resolved
}

function themeCss(theme: AppSandboxTheme): string {
  const mode = theme.mode === 'dark' ? 'dark' : 'light'
  const c = sanitizeThemeColors(theme)
  const series = SERIES[mode]
  return `:root{color-scheme:${mode};--background:transparent;--foreground:${c.foreground};` +
    `--card:${c.card};--card-foreground:${c.foreground};--popover:${c.surface};--popover-foreground:${c.foreground};` +
    `--primary:${c.foreground};--primary-foreground:${c.surface};--secondary:${c.muted};--secondary-foreground:${c.foreground};` +
    `--muted:${c.muted};--muted-foreground:${c.mutedForeground};--accent:${c.accentSoft};--accent-foreground:${c.foreground};` +
    `--brand:${c.accent};--destructive:${c.danger};--success:${c.success};--warning:${c.warning};` +
    `--border:${c.border};--input:${c.border};--ring:${c.ring};` +
    series.map((color, index) => `--viz-series-${index + 1}:${color};`).join('') +
    `--blue:${series[0]};--orange:${series[1]};--green:${series[2]};--purple:${series[3]};--red:${series[4]};--teal:${series[5]};` +
    `--yellow:${c.warning};--radius:10px;--font-size-base:14px}`
}

const BASE_CSS = `*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;color:var(--foreground);font:400 var(--font-size-base)/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}
body{padding:2px 1px 6px;overflow-x:hidden}
h1,h2,h3{margin:0 0 8px;font-weight:500;line-height:1.3}h1{font-size:20px}h2{font-size:17px}h3{font-size:15px}
p{margin:0 0 8px}a{color:var(--brand)}
.card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius);padding:14px}
.stack{display:flex;flex-direction:column;gap:10px}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.grid-3{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}
.text-muted{color:var(--muted-foreground)}.text-small{font-size:12px}.tabular-nums{font-variant-numeric:tabular-nums}
.badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:var(--muted);color:var(--muted-foreground);font-size:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:4px 12px;border-radius:8px;border:1px solid var(--border);background:var(--card);color:var(--foreground);font:inherit;font-weight:500;cursor:pointer}
.btn:hover{background:var(--muted)}.btn:focus-visible{outline:2px solid var(--ring);outline-offset:1px}
.btn-primary{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}.btn-primary:hover{opacity:.9;background:var(--primary)}
button[aria-pressed="true"],button[aria-selected="true"],button.is-selected{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}
.form-label{display:block;margin-bottom:4px;font-size:12px;color:var(--muted-foreground)}
input,select,textarea{font:inherit;color:var(--foreground);background:var(--card);border:1px solid var(--input);border-radius:8px;padding:5px 8px}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--ring);outline-offset:0}
input[type=range],.form-range{-webkit-appearance:none;appearance:none;width:100%;height:20px;padding:0;border:0;background:transparent}
input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--muted)}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-6px;border-radius:50%;background:var(--brand);border:2px solid var(--card);box-shadow:0 0 0 1px var(--border)}
input[type=range]:focus-visible{outline:none}input[type=range]:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px var(--ring)}
input[type=checkbox],input[type=radio]{accent-color:var(--brand)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:6px 8px;border-bottom:1px solid var(--border);text-align:left}th{font-weight:500;color:var(--muted-foreground)}
svg{max-width:100%}svg text{fill:var(--foreground)}
.viz-dotted-background{background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:14px 14px;border-radius:var(--radius);padding:16px}`

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')
}

/**
 * Wrap a model-authored fragment into a complete document. The CSP is also
 * delivered as an HTTP header by the protocol handler; the meta tag only
 * documents it for anyone inspecting the page.
 */
export function buildGenUiDocument(input: {
  fragment: string
  title: string
  csp: string
  theme: AppSandboxTheme
  widgetState: unknown
}): string {
  const boot = escapeScriptJson({
    widgetState: input.widgetState ?? null,
    theme: input.theme.mode,
    locale: input.theme.locale
  })
  const title = input.title.replace(/[<>&"]/g, '')
  return [
    '<!doctype html>',
    `<html lang="${input.theme.locale.replace(/[^A-Za-z-]/g, '') || 'en'}" data-theme="${input.theme.mode}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${input.csp.replace(/"/g, '&quot;')}">`,
    `<title>${title}</title>`,
    `<style>${themeCss(input.theme)}\n${BASE_CSS}</style>`,
    `<script>window.__KUN_GEN_UI_BOOT__=${boot};</script>`,
    `<script>${GEN_UI_BRIDGE_SCRIPT}</script>`,
    '</head>',
    '<body>',
    input.fragment,
    '</body>',
    '</html>'
  ].join('\n')
}

/** The shell frames exactly one guest page and carries no script of its own. */
export function buildShellDocument(input: { guestUrl: string; csp: string; title: string }): string {
  const title = input.title.replace(/[<>&"]/g, '')
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${input.csp.replace(/"/g, '&quot;')}">`,
    `<title>${title}</title>`,
    '<style>html,body{margin:0;padding:0;height:100%;overflow:hidden;background:transparent}',
    'iframe{display:block;border:0;width:100%;height:100%;background:transparent;color-scheme:normal}</style>',
    '</head><body>',
    `<iframe id="kun-app-guest" src="${input.guestUrl}" title="${title}"`,
    ' sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock allow-modals"',
    ' referrerpolicy="no-referrer" allow="fullscreen"></iframe>',
    '</body></html>'
  ].join('\n')
}

/** Insert a CSP meta tag into an MCP App document without rewriting its markup. */
export function withCspMeta(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`
  const head = /<head[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length)
  return meta + html
}
