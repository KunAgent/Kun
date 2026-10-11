import type { HarnessModelInfo } from '../../../../../kun/src/contracts/harness-models'

export function devinModelPresentation(info: HarnessModelInfo) {
  const name = info.displayName?.trim() || info.id
  const fusion = info.category === 'fusion' || info.id.startsWith('fusion-')
  const parts = fusion ? /^Fusion \((.+) \+ (.+)\)$/.exec(name) : null
  const identity = [info.id, name].find((value) => /^(swe|fusion|adaptive|gpt|o\d|claude|gemini|glm|kimi|deepseek|grok)/i.test(value)) ?? info.id
  const brand = /^(swe|fusion|adaptive)/i.test(identity) ? 'devin'
    : /^(gpt|o\d)/i.test(identity) ? 'codex'
      : /^claude/i.test(identity) ? 'claude-subscription'
        : /^gemini|^MODEL_GOOGLE/i.test(identity) ? 'gemini-cli-subscription'
          : /^glm/i.test(identity) ? 'zai' : /^kimi/i.test(identity) ? 'moonshot-global'
            : /^deepseek/i.test(identity) ? 'deepseek' : /^grok/i.test(identity) ? 'grok-subscription' : undefined
  return { name, fusion, brand, title: parts?.[1] ?? name, companion: parts?.[2] }
}

const RECENT_KEY = 'kun.devin.recent-models.v1'
export function readDevinRecentModels(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 5) : []
  } catch { return [] }
}
export function rememberDevinModel(id: string): void {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readDevinRecentModels().filter((old) => old !== id)].slice(0, 5))) }
  catch { /* Selection still works when storage is unavailable. */ }
}
