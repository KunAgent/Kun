export const KUN_PET_IDS = ['xiao-kun', 'ikun'] as const

export const AI_PET_IDS = ['whale-girl'] as const

export const RETIRED_AI_PET_IDS = new Set([
  'gpt-girl', 'claude-girl', 'grok-girl', 'kimi-girl', 'gemini-girl',
  'glm-girl', 'qwen-girl', 'minimax-girl', 'seed-girl', 'llama-girl',
  'mistral-girl', 'hunyuan-girl', 'mimo-girl', 'doubao-girl'
])

export const BUILTIN_PET_IDS = [...KUN_PET_IDS, ...AI_PET_IDS] as const
export type BuiltinPetId = typeof BUILTIN_PET_IDS[number]

// Upgrade only the previously bundled collection; local and Codex imports keep
// their own namespaces even when they use one of these source IDs.
export const RETIRED_BUILTIN_PET_IDS = new Set([
  ...RETIRED_AI_PET_IDS,
  'alo-asuna', 'anya', 'artoria', 'dordor', 'gojo', 'goku',
  'kawaii-bear-puppy', 'lulu-capybara', 'nezuko', 'nezukocoder',
  'snowy', 'trae', 'yi-er', 'zodiac-pig'
])

export function isBuiltinPetId(value: unknown): value is BuiltinPetId {
  return typeof value === 'string' && (BUILTIN_PET_IDS as readonly string[]).includes(value)
}

export function isKunPetId(value: string): boolean {
  return (KUN_PET_IDS as readonly string[]).includes(value)
}
