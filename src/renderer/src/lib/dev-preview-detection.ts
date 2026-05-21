import type { ChatBlock } from '../agent/types'
import { normalizeDevPreviewUrlInput } from '@shared/dev-preview-url'

const MAX_DETECTED_URLS = 4
const LOCAL_URL_CANDIDATE_RE =
  /\b(?:https?:\/\/)?(?:localhost|(?:[\w-]+\.)?localhost|host\.docker\.internal|[\w.-]+\.local|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])(?::\d{2,5})?(?:\/[^\s'"<>)\]]*)?/gi
const DEV_SERVER_COMMAND_RE =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)|vite(?:\s|$)|next\s+dev|nuxt\s+dev|astro\s+dev|remix\s+dev|webpack(?:-dev-server|\s+serve)|react-scripts\s+start|storybook(?:\s+dev)?|svelte-kit\s+dev)\b/i
const DEV_SERVER_OUTPUT_RE =
  /\b(?:vite v?\d|local:\s*https?:\/\/|network:\s*https?:\/\/|ready in \d+(?:\.\d+)?\s*(?:ms|s)|ready on\s+https?:\/\/|started server|server started|compiled successfully|webpack compiled|app running at|serving at|listening on\s+https?:\/\/)\b/i
const DEV_PREVIEW_STRONG_CONTEXT_RE =
  /\b(?:preview|website|web\s*(?:app|page|site)|frontend|front-end|ui|dev\s+server|development\s+server|vite|next\s+dev|nuxt\s+dev|astro\s+dev|storybook)\b|(?:网页|页面|预览|浏览器|前端|站点|网站|开发服务器)/i
const DEV_PREVIEW_ASSISTANT_CONTEXT_RE =
  /\b(?:preview|website|web\s*(?:app|page|site)|frontend|front-end|ui|dev\s+server|development\s+server|vite|next\s+dev|nuxt\s+dev|astro\s+dev|storybook|served|running|started|open|visit|view)\b|(?:网页|页面|预览|浏览器|前端|站点|网站|开发服务器|本地服务|运行|启动|部署|打开|访问)/i
const NON_PREVIEW_CONTEXT_RE =
  /\b(?:deepseek(?:-tui)?|runtime|runtime:request|health check|bearer token|sse|threads?)\b|\/(?:health|v\d+\/|metrics|readyz?|livez?)(?:\b|\/|\?)/i

function textFromBlock(block: ChatBlock): string {
  if (block.kind === 'tool') {
    let meta = ''
    try {
      meta = block.meta ? JSON.stringify(block.meta) : ''
    } catch {
      meta = ''
    }
    return [block.summary, block.detail, meta].filter(Boolean).join('\n')
  }
  if (block.kind === 'approval' || block.kind === 'user_input') return ''
  return 'text' in block ? block.text : ''
}

function trimUrlCandidate(candidate: string): string {
  return candidate.replace(/[`),.;]+$/g, '')
}

function commandTextFromBlock(block: ChatBlock): string {
  if (block.kind !== 'tool' || !block.meta) return ''
  const command = block.meta.command
  if (Array.isArray(command)) return command.map(String).join(' ')
  if (typeof command === 'string') return command
  return ''
}

function blockCanAdvertiseDevPreview(block: ChatBlock, text: string): boolean {
  if (block.kind === 'assistant') {
    const outputLooksLikeDevServer = DEV_SERVER_OUTPUT_RE.test(text)
    const textLooksLikePreview = DEV_PREVIEW_ASSISTANT_CONTEXT_RE.test(text)
    if (!outputLooksLikeDevServer && !textLooksLikePreview) return false
    if (
      NON_PREVIEW_CONTEXT_RE.test(text) &&
      !outputLooksLikeDevServer &&
      !DEV_PREVIEW_STRONG_CONTEXT_RE.test(text)
    ) {
      return false
    }
    return true
  }

  if (block.kind !== 'tool') return false
  if (block.toolKind && block.toolKind !== 'command_execution') return false

  const commandText = commandTextFromBlock(block)
  const commandLooksLikeDevServer = DEV_SERVER_COMMAND_RE.test(commandText)
  const outputLooksLikeDevServer = DEV_SERVER_OUTPUT_RE.test(text)

  if (!commandLooksLikeDevServer && !outputLooksLikeDevServer) return false
  if (NON_PREVIEW_CONTEXT_RE.test(text) && !commandLooksLikeDevServer) return false
  return true
}

function urlLooksLikePagePreview(url: string): boolean {
  try {
    const parsed = new URL(url)
    const pathname = decodeURIComponent(parsed.pathname).toLowerCase()
    if (/^\/(?:health|metrics|readyz?|livez?|v\d+)(?:\/|$)/.test(pathname)) return false
    if (/\/(?:health|metrics|readyz?|livez?)(?:\/|$)/.test(pathname)) return false
    return true
  } catch {
    return false
  }
}

export function extractDetectedDevPreviewUrls(blocks: ChatBlock[]): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!
    const text = textFromBlock(block)
    if (!blockCanAdvertiseDevPreview(block, text)) continue

    for (const match of text.matchAll(LOCAL_URL_CANDIDATE_RE)) {
      const normalized = normalizeDevPreviewUrlInput(trimUrlCandidate(match[0]))
      if (!normalized || !urlLooksLikePagePreview(normalized) || seen.has(normalized)) continue
      seen.add(normalized)
      urls.push(normalized)
      if (urls.length >= MAX_DETECTED_URLS) return urls
    }
  }

  return urls
}

export function extractLatestTurnDevPreviewUrls(blocks: ChatBlock[]): string[] {
  let latestUserIndex = -1
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i]?.kind === 'user') {
      latestUserIndex = i
      break
    }
  }
  if (latestUserIndex === -1) return []
  return extractDetectedDevPreviewUrls(blocks.slice(latestUserIndex + 1))
}

export function formatDevPreviewUrlLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.host
  } catch {
    return url
  }
}
