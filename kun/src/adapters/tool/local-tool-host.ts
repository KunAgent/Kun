import type { UserInputQuestion } from '../../ports/user-input-gate.js'
import { buildBuiltinLocalTools } from './builtin-tools.js'
import type { BuiltinLocalToolsOptions } from './builtin-tool-types.js'
import { createCreatePlanTool, type CreatePlanAdapterOptions } from './create-plan-tool.js'
import { LocalToolHost } from './local-tool-host-core.js'
import type { LocalTool } from './local-tool-host-types.js'

export { LocalToolHost } from './local-tool-host-core.js'
export type { LocalTool, LocalToolHostOptions, ToolSideEffect } from './local-tool-host-types.js'

/**
 * Tiny default tool used by smoke tests: echoes its argument so the
 * rest of the loop has a tool to call when the GUI hasn't provided any.
 */
export const echoTool: LocalTool = LocalToolHost.defineTool({
  name: 'echo',
  description: 'Echo the input argument back to the model.',
  toolKind: 'tool_call',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  },
  policy: 'auto',
  execute: async (args) => ({ output: { echoed: args.text ?? '' } })
})

function createUserInputTool(name: string): LocalTool {
  const optionSchema = {
    anyOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' }
        },
        required: ['label']
      }
    ]
  }
  return LocalToolHost.defineTool({
    name,
    description: [
      'Ask the user a structured question only when an unanswered material choice blocks safe or correct progress, or when an active workflow explicitly requires structured confirmation.',
      'Do not use this tool for greetings, status updates, optional follow-ups, offers of more help, information already available in context, or unnecessary repetitions or rephrasings of the same question.',
      'Ask one concise round, then act on the answer. Ask again only when a material workflow state change explicitly requires a new confirmation.'
    ].join(' '),
    toolKind: 'tool_call',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        question: { type: 'string' },
        message: { type: 'string' },
        options: {
          type: 'array',
          description: 'Optional answer choices for a single question. Use strings or {label, description} objects.',
          items: optionSchema
        },
        selectionMode: {
          type: 'string',
          enum: ['single', 'multiple'],
          description: 'Use "multiple" only when the user may choose more than one option.'
        },
        minSelections: {
          type: 'integer',
          minimum: 1,
          description: 'Minimum required selections for a multiple-choice question.'
        },
        maxSelections: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum allowed selections for a multiple-choice question.'
        },
        timeoutSeconds: {
          type: 'integer',
          minimum: 5,
          maximum: 3600,
          description:
            'Optional. If the user does not answer within this many seconds, the request auto-resolves with status "timeout"; you must then proceed with your own best judgment instead of waiting or asking again.'
        },
        questions: {
          type: 'array',
          description: 'One to three structured questions. Each question may include answer options.',
          items: {
            type: 'object',
            properties: {
              header: { type: 'string' },
              id: { type: 'string' },
              question: { type: 'string' },
              prompt: {
                type: 'string',
                description: 'Alias for question used by delegated SDK tool callers.'
              },
              message: {
                type: 'string',
                description: 'Alias for question used by delegated SDK tool callers.'
              },
              options: {
                type: 'array',
                items: optionSchema
              },
              selectionMode: {
                type: 'string',
                enum: ['single', 'multiple']
              },
              minSelections: {
                type: 'integer',
                minimum: 1
              },
              maxSelections: {
                type: 'integer',
                minimum: 1
              }
            }
          }
        }
      },
      required: []
    },
    policy: 'auto',
    execute: async (args, context) => {
      if (!context.awaitUserInput) {
        return {
          output: { error: 'structured user input is not available in this client context' },
          isError: true
        }
      }
      const inputId = `in_${Math.random().toString(36).slice(2, 10)}`
      const itemId = `item_${inputId}`
      const explicitPrompt = firstNonEmptyString(args.prompt, args.question, args.message)
      const questions = normalizeUserInputQuestions(args, inputId, explicitPrompt)
      if (questions.length === 0) {
        return {
          output: {
            error:
              'user_input requires a non-empty prompt, question, message, or questions[].question'
          },
          isError: true
        }
      }
      const prompt = explicitPrompt ?? questions[0]!.question
      const timeoutSeconds = normalizeTimeoutSeconds(args.timeoutSeconds)
      const resolution = await context.awaitUserInput({
        id: inputId,
        itemId,
        prompt,
        questions,
        ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {})
      })
      if (resolution.status === 'timeout') {
        return {
          output: {
            ...resolution,
            message:
              'No answer within the timeout. Do NOT call user_input again for the same question; proceed with your own best judgment based on the conversation so far.'
          },
          isError: false
        }
      }
      return {
        output: resolution,
        isError: resolution.status === 'cancelled'
      }
    }
  })
}

export const userInputTool: LocalTool = createUserInputTool('user_input')
/** Legacy executable alias; capability discovery prefers `user_input` when both exist. */
export const requestUserInputTool: LocalTool = createUserInputTool('request_user_input')

export const defaultLocalTools: LocalTool[] = [
  ...buildBuiltinLocalTools(),
  echoTool,
  userInputTool,
  requestUserInputTool
]

function normalizeTimeoutSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  if (normalized < 5 || normalized > 3600) return undefined
  return normalized
}

function normalizeUserInputQuestions(
  args: Record<string, unknown>,
  fallbackId: string,
  fallbackPrompt: string | undefined
): UserInputQuestion[] {
  const rawQuestions = Array.isArray(args.questions) ? args.questions : null
  if (rawQuestions && rawQuestions.length > 0) {
    const questions = rawQuestions
      .map((question, index) => normalizeUserInputQuestion(question, index, fallbackId))
      .filter((question): question is UserInputQuestion => question !== null)
    if (questions.length > 0) return questions
  }
  if (!fallbackPrompt) return []
  const options = Array.isArray(args.options)
    ? args.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return [
    {
      header: 'Input',
      id: String(args.id ?? fallbackId),
      question: fallbackPrompt,
      options,
      ...normalizeUserInputSelection(args, options.length)
    }
  ]
}

function normalizeUserInputQuestion(
  value: unknown,
  index: number,
  fallbackId: string
): UserInputQuestion | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const question = firstNonEmptyString(raw.question, raw.prompt, raw.message)
  if (!question) return null
  const options = Array.isArray(raw.options)
    ? raw.options
        .map((option) => normalizeUserInputOption(option))
        .filter((option) => option !== null)
    : []
  return {
    header: typeof raw.header === 'string' && raw.header.trim() ? raw.header.trim() : `Question ${index + 1}`,
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `${fallbackId}_${index + 1}`,
    question,
    options,
    ...normalizeUserInputSelection(raw, options.length)
  }
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized) return normalized
  }
  return undefined
}

function normalizeUserInputSelection(
  raw: Record<string, unknown>,
  optionCount: number
): Pick<UserInputQuestion, 'selectionMode' | 'minSelections' | 'maxSelections'> {
  if (raw.selectionMode !== 'multiple' || optionCount === 0) {
    return { selectionMode: 'single' }
  }
  const rawMax = positiveInteger(raw.maxSelections)
  const maxSelections = rawMax === undefined ? undefined : Math.min(rawMax, optionCount)
  const minCeiling = maxSelections ?? optionCount
  const rawMin = positiveInteger(raw.minSelections)
  const minSelections = Math.min(rawMin ?? 1, minCeiling)
  return {
    selectionMode: 'multiple',
    minSelections,
    ...(maxSelections !== undefined ? { maxSelections } : {})
  }
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : undefined
}

function normalizeUserInputOption(
  value: unknown
): { label: string; description: string } | null {
  if (typeof value === 'string' && value.trim()) {
    return {
      label: value.trim(),
      description: ''
    }
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null
  if (!label) return null
  return {
    label,
    description: typeof raw.description === 'string' ? raw.description : ''
  }
}


/**
 * Build the default tool list including the `create_plan` tool. The
 * `create_plan` tool is gated to plan/refine turns via its
 * `shouldAdvertise` predicate, so it is safe to ship with the
 * default set: non-plan turns never see it in the model tool list.
 */
export function buildDefaultLocalTools(
  planOptions: CreatePlanAdapterOptions = {},
  builtinOptions: BuiltinLocalToolsOptions = {}
): LocalTool[] {
  const baseTools = Object.keys(builtinOptions).length
    ? [...buildBuiltinLocalTools(builtinOptions), echoTool, userInputTool, requestUserInputTool]
    : defaultLocalTools
  return [...baseTools, createCreatePlanTool(planOptions)]
}
