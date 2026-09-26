/**
 * ACP `elicitation/create` bridging (docs/ade/03 §8.4, P2-10). Form-mode
 * requests map onto Kun's user_input gate for interactive turns and onto
 * ask_manager for worker turns; turns that disable user input never receive
 * a handler here, so the host can decline instead of blocking the agent.
 * URL and custom modes are never advertised in `initialize`.
 */
import type { Turn } from '../../contracts/turns.js'
import type { ThreadRecord } from '../../contracts/threads.js'
import type {
  UserInputAnswer,
  UserInputGate,
  UserInputQuestion,
  UserInputResolution
} from '../../ports/user-input-gate.js'
import type { SessionStore } from '../../ports/session-store.js'
import type { RuntimeEventRecorder } from '../../services/runtime-event-recorder.js'
import type { TurnService } from '../../services/turn-service.js'
import type {
  AskManagerResult,
  WorkerCallbackService
} from '../../services/worker-callback-service.js'
import { makeKunAwaitUserInput } from '../../harness/kun-tool-user-input.js'
import type {
  CreateElicitationResponse,
  ElicitationContentValue
} from './acp-schema.js'

export type AcpElicitFn = (input: {
  message: string
  requestedSchema: unknown
}) => Promise<CreateElicitationResponse>

/** Deps the ACP runtime already carries; the context builder picks a path. */
export type AcpElicitationDeps = {
  userInputGate?: UserInputGate
  workerCallbacks?: Pick<WorkerCallbackService, 'askManager'>
  turns: Pick<TurnService, 'applyItem' | 'updateItem'>
  events: RuntimeEventRecorder
  sessionStore: SessionStore
  ids: { next(prefix: string): string }
  nowIso?: () => string
}

/** One normalized form field; `options` hold the const each label maps to. */
type ElicitField = {
  name: string
  type: string
  title: string
  description?: string
  required: boolean
  multi: boolean
  options?: { label: string; value: string; description: string }[]
  minItems?: number
  maxItems?: number
  hints?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** `oneOf`/`enum` choices shared by string scalars and array item schemas. */
function enumOptions(
  prop: Record<string, unknown> | undefined
): ElicitField['options'] {
  const oneOf = Array.isArray(prop?.oneOf) ? prop.oneOf : undefined
  if (oneOf) {
    const options = oneOf
      .map((entry) => {
        const record = asRecord(entry)
        const value = str(record?.const)
        if (!value) return null
        const title = str(record?.title) ?? value
        return {
          label: title,
          value,
          description: str(record?.description) ?? (title === value ? '' : value)
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .slice(0, 16)
    return options.length ? options : undefined
  }
  const values = Array.isArray(prop?.enum)
    ? prop.enum.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  if (!values.length) return undefined
  return values.slice(0, 16).map((value) => ({ label: value, value, description: '' }))
}

/** Constraint hints appended to the question text for free-form fields. */
function constraintHints(prop: Record<string, unknown>): string | undefined {
  const hints: string[] = []
  const format = str(prop.format)
  if (format) hints.push(`format: ${format}`)
  const minLength = num(prop.minLength)
  if (minLength !== undefined) hints.push(`min ${minLength} chars`)
  const maxLength = num(prop.maxLength)
  if (maxLength !== undefined) hints.push(`max ${maxLength} chars`)
  const pattern = str(prop.pattern)
  if (pattern) hints.push(`pattern: ${pattern.slice(0, 80)}`)
  const minimum = num(prop.minimum)
  if (minimum !== undefined) hints.push(`min ${minimum}`)
  const maximum = num(prop.maximum)
  if (maximum !== undefined) hints.push(`max ${maximum}`)
  return hints.length ? hints.join('; ') : undefined
}

function normalizeField(
  name: string,
  raw: unknown,
  required: boolean
): ElicitField {
  const prop = asRecord(raw) ?? {}
  const type = str(prop.type) ?? 'string'
  const base = {
    name,
    type,
    title: str(prop.title) ?? name,
    description: str(prop.description),
    required
  }
  if (type === 'boolean') {
    return {
      ...base,
      multi: false,
      options: [
        { label: 'True', value: 'true', description: '' },
        { label: 'False', value: 'false', description: '' }
      ]
    }
  }
  if (type === 'array') {
    return {
      ...base,
      multi: true,
      options: enumOptions(asRecord(prop.items)),
      minItems: num(prop.minItems),
      maxItems: num(prop.maxItems)
    }
  }
  return { ...base, multi: false, options: enumOptions(prop), hints: constraintHints(prop) }
}

/** Parse the requested form schema into ordered fields (lenient, capped). */
export function fieldsFromSchema(schema: unknown): ElicitField[] {
  const root = asRecord(schema)
  const properties = asRecord(root?.properties)
  if (!properties) return []
  const required = new Set(
    Array.isArray(root?.required)
      ? root.required.filter((v): v is string => typeof v === 'string')
      : []
  )
  return Object.entries(properties)
    .slice(0, 32)
    .map(([name, raw]) => normalizeField(name, raw, required.has(name)))
}

/** Fields → user_input questions: selects carry options, scalars stay free-form. */
export function questionsFromFields(fields: readonly ElicitField[]): UserInputQuestion[] {
  return fields.map((field) => {
    const hint = field.hints ? ` (${field.hints})` : ''
    return {
      header: field.title,
      id: field.name,
      question: field.description ? `${field.description}${hint}` : `${field.title}${hint}`,
      options: field.options?.map(({ label, description }) => ({ label, description })) ?? [],
      ...(field.multi ? { selectionMode: 'multiple' as const } : {}),
      ...(field.multi && field.minItems && field.minItems > 0
        ? { minSelections: Math.floor(field.minItems) }
        : field.required && field.options?.length
          ? { minSelections: 1 }
          : {}),
      ...(field.multi && field.maxItems && field.maxItems > 0
        ? { maxSelections: Math.floor(field.maxItems) }
        : {})
    }
  })
}

function coerceScalar(type: string, value: string): ElicitationContentValue {
  if (type === 'number' || type === 'integer') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }
  if (type === 'boolean') return value.trim().toLowerCase() === 'true'
  return value
}

function fieldValue(
  field: ElicitField,
  answer: UserInputAnswer
): ElicitationContentValue | undefined {
  if (field.options?.length) {
    const toValue = (label: string) =>
      field.options!.find((option) => option.label === label)?.value ?? label
    if (field.multi) {
      const labels = answer.labels ?? answer.values ?? []
      return labels.map(toValue)
    }
    const label = answer.labels?.[0] ?? answer.label
    return coerceScalar(field.type, toValue(label))
  }
  const raw = answer.value !== '' ? answer.value : answer.label
  if (field.multi) return answer.values ?? [raw]
  return coerceScalar(field.type, raw)
}

/** Answers (one per question id = property name) → accept `content`. */
export function contentFromAnswers(
  answers: readonly UserInputAnswer[],
  fields: readonly ElicitField[]
): Record<string, ElicitationContentValue> {
  const byId = new Map(answers.map((answer) => [answer.id, answer]))
  const content: Record<string, ElicitationContentValue> = {}
  for (const field of fields) {
    const answer = byId.get(field.name)
    if (!answer) continue
    const value = fieldValue(field, answer)
    if (value !== undefined) content[field.name] = value
  }
  return content
}

export function responseFromResolution(
  resolution: UserInputResolution,
  fields: readonly ElicitField[]
): CreateElicitationResponse {
  if (resolution.status !== 'submitted') return { action: 'cancel' }
  return { action: 'accept', content: contentFromAnswers(resolution.answers, fields) }
}

/**
 * Worker elicitations cannot render a form; ask_manager carries a text
 * description of the fields plus the first single-select's options, and the
 * string answer lands on the sole (or first required) property.
 */
export function workerAskInput(
  message: string,
  fields: readonly ElicitField[]
): { question: string; options?: string[] } {
  const lines = fields.map((field) => {
    const kind = field.options?.length
      ? `one of: ${field.options.map((option) => option.label).join(', ')}`
      : field.multi
        ? 'multiple values'
        : field.type
    return `- ${field.title}: ${kind}${field.required ? '' : ' (optional)'}`
  })
  const question = lines.length
    ? `${message}\n\nFields:\n${lines.join('\n')}`
    : message
  const options = fields
    .find((field) => field.options?.length && !field.multi)
    ?.options?.map((option) => option.value)
  return {
    question: question.slice(0, 8_000),
    ...(options?.length ? { options } : {})
  }
}

export function responseFromAskManager(
  result: AskManagerResult,
  fields: readonly ElicitField[]
): CreateElicitationResponse {
  if (result.status !== 'answered') return { action: 'cancel' }
  const target =
    fields.length === 1 ? fields[0] : (fields.find((f) => f.required) ?? fields[0])
  if (!target) return { action: 'decline' }
  const trimmed = result.answer.trim()
  if (target.options?.length) {
    const match = target.options.find(
      (option) => option.value === trimmed || option.label === trimmed
    )
    return {
      action: 'accept',
      content: { [target.name]: coerceScalar(target.type, match?.value ?? trimmed) }
    }
  }
  return {
    action: 'accept',
    content: { [target.name]: target.multi ? [trimmed] : coerceScalar(target.type, trimmed) }
  }
}

/**
 * Pick the elicitation path for a turn: workers go through ask_manager so the
 * question lands in manager notifications; interactive turns go through the
 * user_input gate; input-disabled turns return undefined (host declines).
 */
export function acpElicitForTurn(
  deps: AcpElicitationDeps,
  thread: Pick<ThreadRecord, 'id' | 'executionUnit'>,
  turn: Pick<Turn, 'id' | 'disableUserInput'>,
  signal: AbortSignal
): AcpElicitFn | undefined {
  if (thread.executionUnit?.kind === 'worker') {
    const callbacks = deps.workerCallbacks
    if (!callbacks) return undefined
    return async ({ message, requestedSchema }) => {
      const fields = fieldsFromSchema(requestedSchema)
      const result = await callbacks
        .askManager(thread.id, workerAskInput(message, fields), signal)
        .catch(() => null)
      return result === null
        ? { action: 'decline' }
        : responseFromAskManager(result, fields)
    }
  }
  if (turn.disableUserInput === true || !deps.userInputGate) return undefined
  const awaitUserInput = makeKunAwaitUserInput(
    {
      userInputGate: deps.userInputGate,
      turns: deps.turns,
      events: deps.events,
      sessionStore: deps.sessionStore,
      nowIso: deps.nowIso ?? (() => new Date().toISOString())
    },
    thread.id,
    turn.id,
    signal
  )
  if (!awaitUserInput) return undefined
  return async ({ message, requestedSchema }) => {
    const fields = fieldsFromSchema(requestedSchema)
    const resolution = await awaitUserInput({
      id: deps.ids.next('uinput'),
      itemId: deps.ids.next('item'),
      prompt: message,
      questions: questionsFromFields(fields)
    })
    return responseFromResolution(resolution, fields)
  }
}
