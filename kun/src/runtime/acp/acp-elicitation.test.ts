import { describe, expect, test } from 'vitest'
import { InMemoryUserInputGate } from '../../adapters/in-memory-user-input-gate.js'
import type { RuntimeEvent } from '../../contracts/events.js'
import type { UserInputResolution } from '../../ports/user-input-gate.js'
import {
  acpElicitForTurn,
  contentFromAnswers,
  fieldsFromSchema,
  questionsFromFields,
  responseFromAskManager,
  responseFromResolution,
  workerAskInput,
  type AcpElicitationDeps
} from './acp-elicitation.js'

const WORKER_UNIT = {
  kind: 'worker' as const,
  teamId: 'team_1',
  managerThreadId: 'mgr_1',
  label: 'worker-1',
  lifecycle: 'ephemeral' as const,
  control: 'manager' as const
}

const FORM_SCHEMA = {
  type: 'object',
  required: ['mode', 'count'],
  properties: {
    mode: {
      type: 'string',
      title: 'Mode',
      oneOf: [
        { const: 'fast', title: 'Fast', description: 'Ship quickly' },
        { const: 'safe', title: 'Safe' }
      ]
    },
    count: { type: 'integer', title: 'Count', description: 'How many' },
    confirm: { type: 'boolean', title: 'Confirm' },
    tags: {
      type: 'array',
      title: 'Tags',
      items: { type: 'string', enum: ['a', 'b', 'c'] },
      maxItems: 2
    },
    note: { type: 'string', title: 'Note', maxLength: 120 },
    region: { type: 'string', title: 'Region', enum: ['us', 'eu'] }
  }
}

describe('fieldsFromSchema / questionsFromFields', () => {
  test('normalizes each property family into gate questions', () => {
    const fields = fieldsFromSchema(FORM_SCHEMA)
    expect(fields.map((f) => f.name)).toEqual([
      'mode',
      'count',
      'confirm',
      'tags',
      'note',
      'region'
    ])
    const questions = questionsFromFields(fields)
    const byId = new Map(questions.map((q) => [q.id, q]))

    const mode = byId.get('mode')!
    expect(mode.options.map((o) => o.label)).toEqual(['Fast', 'Safe'])
    expect(mode.minSelections).toBe(1)

    const confirm = byId.get('confirm')!
    expect(confirm.options.map((o) => o.label)).toEqual(['True', 'False'])

    const tags = byId.get('tags')!
    expect(tags.selectionMode).toBe('multiple')
    expect(tags.maxSelections).toBe(2)
    expect(tags.options.map((o) => o.label)).toEqual(['a', 'b', 'c'])

    const note = byId.get('note')!
    expect(note.options).toEqual([])
    expect(note.question).toContain('max 120 chars')

    const count = byId.get('count')!
    expect(count.question).toBe('How many')
  })

  test('tolerates missing properties and unknown prop shapes', () => {
    expect(fieldsFromSchema(undefined)).toEqual([])
    expect(fieldsFromSchema({ type: 'object' })).toEqual([])
    expect(fieldsFromSchema({ properties: { x: null } })[0]?.type).toBe('string')
  })
})

describe('contentFromAnswers', () => {
  test('maps labels back to consts and coerces scalars', () => {
    const fields = fieldsFromSchema(FORM_SCHEMA)
    const content = contentFromAnswers(
      [
        { id: 'mode', label: 'Safe', value: '' },
        { id: 'count', label: '3', value: '3' },
        { id: 'confirm', label: 'True', value: '' },
        { id: 'tags', label: 'a', value: 'a', labels: ['a', 'b'] },
        { id: 'note', label: 'hi there', value: 'hi there' },
        { id: 'region', label: 'eu', value: 'eu' }
      ],
      fields
    )
    expect(content).toEqual({
      mode: 'safe',
      count: 3,
      confirm: true,
      tags: ['a', 'b'],
      note: 'hi there',
      region: 'eu'
    })
  })

  test('skips unanswered optional fields', () => {
    const fields = fieldsFromSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } }
    })
    expect(contentFromAnswers([{ id: 'a', label: 'x', value: 'x' }], fields)).toEqual({
      a: 'x'
    })
  })
})

describe('responseFromResolution / responseFromAskManager', () => {
  test('submitted → accept, cancelled/timeout → cancel', () => {
    const fields = fieldsFromSchema(FORM_SCHEMA)
    const submitted: UserInputResolution = {
      status: 'submitted',
      answers: [{ id: 'mode', label: 'Fast', value: '' }]
    }
    expect(responseFromResolution(submitted, fields)).toEqual({
      action: 'accept',
      content: { mode: 'fast' }
    })
    expect(responseFromResolution({ status: 'cancelled' }, fields)).toEqual({
      action: 'cancel'
    })
    expect(responseFromResolution({ status: 'timeout' }, fields)).toEqual({
      action: 'cancel'
    })
  })

  test('manager answers land on the sole or first required field', () => {
    const single = fieldsFromSchema({
      type: 'object',
      properties: { why: { type: 'string' } }
    })
    expect(
      responseFromAskManager(
        { status: 'answered', answer: 'because reasons', answeredBy: 'manager' },
        single
      )
    ).toEqual({ action: 'accept', content: { why: 'because reasons' } })

    const fields = fieldsFromSchema(FORM_SCHEMA)
    expect(
      responseFromAskManager(
        { status: 'answered', answer: 'Safe', answeredBy: 'user' },
        fields
      )
    ).toEqual({ action: 'accept', content: { mode: 'safe' } })
    expect(responseFromAskManager({ status: 'timeout' }, fields)).toEqual({
      action: 'cancel'
    })
    expect(responseFromAskManager({ status: 'cancelled' }, fields)).toEqual({
      action: 'cancel'
    })
    // No property can carry the answer → decline rather than drop it.
    expect(
      responseFromAskManager(
        { status: 'answered', answer: 'x', answeredBy: 'manager' },
        []
      )
    ).toEqual({ action: 'decline' })
  })

  test('workerAskInput folds fields and the first select into ask_manager input', () => {
    const fields = fieldsFromSchema(FORM_SCHEMA)
    const input = workerAskInput('Pick the deploy shape', fields)
    expect(input.question).toContain('Pick the deploy shape')
    expect(input.question).toContain('Mode: one of: Fast, Safe')
    expect(input.question).toContain('Tags: one of: a, b, c (optional)')
    expect(input.options).toEqual(['fast', 'safe'])
  })
})

describe('acpElicitForTurn', () => {
  const baseDeps = (over: Partial<AcpElicitationDeps> = {}): AcpElicitationDeps => ({
    turns: {
      applyItem: async () => ({}),
      updateItem: async () => ({})
    } as never,
    events: { record: async () => ({ seq: 1 }) } as never,
    sessionStore: { loadEventsSince: async () => [] } as never,
    ids: { next: (prefix) => `${prefix}_1` },
    ...over
  })

  test('returns undefined for input-disabled turns and missing gates', () => {
    const thread = { id: 'th' }
    expect(
      acpElicitForTurn(
        baseDeps({ userInputGate: new InMemoryUserInputGate() }),
        thread,
        { id: 'tn', disableUserInput: true },
        new AbortController().signal
      )
    ).toBeUndefined()
    expect(
      acpElicitForTurn(
        baseDeps(),
        thread,
        { id: 'tn' },
        new AbortController().signal
      )
    ).toBeUndefined()
  })

  test('interactive turns bridge to the user_input gate', async () => {
    const userInputGate = new InMemoryUserInputGate()
    let item: { kind?: string; questions?: { id: string }[] } | undefined
    const deps = baseDeps({
      userInputGate,
      turns: {
        applyItem: async (_t: string, i: { kind?: string; questions?: { id: string }[] }) => {
          item = i
          return {}
        },
        updateItem: async () => ({})
      } as never,
      events: {
        record: async (event: RuntimeEvent) => {
          if (event.kind === 'user_input_requested' && 'inputId' in event) {
            userInputGate.resolve(event.inputId as string, {
              status: 'submitted',
              answers: [{ id: 'mode', label: 'Fast', value: '' }]
            })
          }
          return { seq: 1 }
        }
      } as never
    })
    const elicit = acpElicitForTurn(
      deps,
      { id: 'th' },
      { id: 'tn' },
      new AbortController().signal
    )!
    expect(elicit).toBeTypeOf('function')
    const response = await elicit({
      message: 'Choose a mode',
      requestedSchema: FORM_SCHEMA
    })
    expect(response).toEqual({ action: 'accept', content: { mode: 'fast' } })
    expect(item?.kind).toBe('user_input')
    expect(item?.questions?.map((q) => q.id)).toContain('mode')
  })

  test('gate cancellation maps to cancel', async () => {
    const userInputGate = new InMemoryUserInputGate()
    const deps = baseDeps({
      userInputGate,
      events: {
        record: async (event: RuntimeEvent) => {
          if (event.kind === 'user_input_requested' && 'inputId' in event) {
            userInputGate.resolve(event.inputId as string, { status: 'cancelled' })
          }
          return { seq: 1 }
        }
      } as never
    })
    const elicit = acpElicitForTurn(
      deps,
      { id: 'th' },
      { id: 'tn' },
      new AbortController().signal
    )!
    await expect(
      elicit({ message: 'q', requestedSchema: { type: 'object' } })
    ).resolves.toEqual({ action: 'cancel' })
  })

  test('worker turns route through ask_manager and map the answer', async () => {
    const asked: { threadId: string; input: unknown }[] = []
    const deps = baseDeps({
      workerCallbacks: {
        askManager: async (threadId: string, input: unknown) => {
          asked.push({ threadId, input })
          return { status: 'answered', answer: 'Safe', answeredBy: 'manager' }
        }
      }
    })
    const elicit = acpElicitForTurn(
      deps,
      { id: 'th', executionUnit: WORKER_UNIT },
      { id: 'tn', disableUserInput: true },
      new AbortController().signal
    )!
    const response = await elicit({
      message: 'Pick a mode',
      requestedSchema: FORM_SCHEMA
    })
    expect(response).toEqual({ action: 'accept', content: { mode: 'safe' } })
    expect(asked).toHaveLength(1)
    expect(asked[0].threadId).toBe('th')
    expect((asked[0].input as { question: string }).question).toContain('Pick a mode')
    expect((asked[0].input as { options?: string[] }).options).toEqual([
      'fast',
      'safe'
    ])
  })

  test('ask_manager failures decline instead of throwing into the agent', async () => {
    const deps = baseDeps({
      workerCallbacks: {
        askManager: async () => {
          throw new Error('no active dispatch')
        }
      }
    })
    const elicit = acpElicitForTurn(
      deps,
      { id: 'th', executionUnit: WORKER_UNIT },
      { id: 'tn' },
      new AbortController().signal
    )!
    await expect(
      elicit({ message: 'q', requestedSchema: { type: 'object' } })
    ).resolves.toEqual({ action: 'decline' })
  })

  test('worker threads prefer ask_manager even when a gate exists', async () => {
    const userInputGate = new InMemoryUserInputGate()
    const asked: unknown[] = []
    const deps = baseDeps({
      userInputGate,
      workerCallbacks: {
        askManager: async (_t: string, input: unknown) => {
          asked.push(input)
          return { status: 'timeout' as const }
        }
      }
    })
    const elicit = acpElicitForTurn(
      deps,
      { id: 'th', executionUnit: WORKER_UNIT },
      { id: 'tn' },
      new AbortController().signal
    )!
    await elicit({ message: 'q', requestedSchema: { type: 'object' } })
    expect(asked).toHaveLength(1)
    expect(userInputGate.pending()).toHaveLength(0)
  })
})
