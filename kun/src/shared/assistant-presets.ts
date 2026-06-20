export type AssistantPresetId = 'code-review' | 'docs-writer' | 'debug' | 'office' | 'research'

export type AssistantPreset = {
  id: AssistantPresetId
  name: string
  systemPrompt: string
  defaultTools: string[]
}

export const ASSISTANT_PRESETS = [
  {
    id: 'code-review',
    name: 'Code Review',
    systemPrompt: [
      'Act as a focused code reviewer.',
      'Prioritize correctness, regressions, security issues, edge cases, and missing tests.',
      'Report concrete findings first with file or symbol references when available.',
      'Avoid broad rewrites unless they directly reduce a demonstrated risk.'
    ].join(' '),
    defaultTools: ['read', 'grep', 'find', 'ls', 'bash']
  },
  {
    id: 'docs-writer',
    name: 'Docs Writer',
    systemPrompt: [
      'Act as a technical documentation writer.',
      'Optimize for clear structure, accurate terminology, practical examples, and concise developer-facing explanations.',
      'Preserve product behavior and avoid inventing unsupported capabilities.'
    ].join(' '),
    defaultTools: ['read', 'grep', 'find', 'ls', 'edit']
  },
  {
    id: 'debug',
    name: 'Debug',
    systemPrompt: [
      'Act as a debugging specialist.',
      'Reproduce or narrow the failure before changing code, state the likely cause, and prefer the smallest verified fix.',
      'Use tests or targeted runtime checks to prove the issue is resolved.'
    ].join(' '),
    defaultTools: ['read', 'grep', 'find', 'ls', 'bash', 'edit']
  },
  {
    id: 'office',
    name: 'Office',
    systemPrompt: [
      'Act as an office productivity assistant.',
      'Help draft, summarize, rewrite, and structure workplace documents, emails, meeting notes, reports, and task lists.',
      'Keep outputs polished, practical, and ready for a business audience unless the user asks for a different tone.'
    ].join(' '),
    defaultTools: ['read', 'grep', 'find', 'ls', 'edit']
  },
  {
    id: 'research',
    name: 'Research',
    systemPrompt: [
      'Act as a research and analysis assistant.',
      'Clarify the question, gather relevant evidence from available project context and tools, compare alternatives, and separate facts from assumptions.',
      'End with a concise synthesis, open questions, and recommended next steps when useful.'
    ].join(' '),
    defaultTools: ['read', 'grep', 'find', 'ls', 'web_search']
  }
] as const satisfies readonly AssistantPreset[]

const ASSISTANT_PRESET_IDS = new Set<AssistantPresetId>(
  ASSISTANT_PRESETS.map((preset) => preset.id)
)

export function isAssistantPresetId(value: string | undefined): value is AssistantPresetId {
  return Boolean(value && ASSISTANT_PRESET_IDS.has(value as AssistantPresetId))
}

export function getAssistantPreset(id: string | undefined): AssistantPreset | null {
  return ASSISTANT_PRESETS.find((preset) => preset.id === id) ?? null
}

export function assistantPresetInstruction(id: string | undefined): string | null {
  const preset = getAssistantPreset(id)
  if (!preset) return null
  return [
    `[Assistant preset: ${preset.name}]`,
    preset.systemPrompt,
    `Default tool emphasis: ${preset.defaultTools.join(', ')}.`
  ].join('\n')
}
