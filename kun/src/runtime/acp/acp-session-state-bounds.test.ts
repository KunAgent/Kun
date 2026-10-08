import { describe, expect, it, vi } from 'vitest'
import { HarnessSessionStateEvent } from '../../contracts/events.js'
import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { AcpEventMapper } from './acp-event-mapper.js'
import { emitTolerantSessionState, SESSION_STATE_BOUNDS } from './acp-session-state-bounds.js'

const models = Array.from({ length: 300 }, (_, index) => `provider/model-${index}`)
const modelOption = (current: string) => ({ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: current,
  options: models.map((value) => ({ value, name: value.toUpperCase() })) })

function mapper() {
  let n = 0
  return new AcpEventMapper({ threadId: 'thr', turnId: 'turn', harnessId: 'codemaker', nextId: (prefix) => `${prefix}_${++n}` })
}

/** The recorder validates a draft with the full event schema; reproduce that. */
function recorded(draft: RuntimeEventDraft) {
  return HarnessSessionStateEvent.safeParse({ ...draft, seq: 1, timestamp: '2026-10-09T00:00:00.000Z' })
}

describe('ACP session state within the event bounds', () => {
  it('records a config_option_update that lists hundreds of models (CodeMaker gateway)', () => {
    const [draft] = mapper().apply({ sessionUpdate: 'config_option_update', configOptions: [modelOption('provider/model-250'),
      { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] }] } as never)
    const result = recorded(draft!)
    expect(result.success, JSON.stringify(result.error?.issues ?? [])).toBe(true)
    const options = (draft as { configOptions: Array<{ id: string; values?: string[]; currentValue?: string }> }).configOptions
    expect(options[0]!.values).toHaveLength(SESSION_STATE_BOUNDS.values)
    // The model in use stays listed even past the bound.
    expect(options[0]!.values![0]).toBe('provider/model-250')
    expect(options[0]!.currentValue).toBe('provider/model-250')
    expect(options[1]).toEqual({ id: 'effort', name: 'Effort', category: 'thought_level', currentValue: 'high', values: ['low', 'high'] })
  })

  it('keeps the list order when the current model is within the bound', () => {
    const [draft] = mapper().apply({ sessionUpdate: 'config_option_update', configOptions: [modelOption('provider/model-3')] } as never)
    expect((draft as { configOptions: Array<{ values?: string[] }> }).configOptions[0]!.values!.slice(0, 4))
      .toEqual(['provider/model-0', 'provider/model-1', 'provider/model-2', 'provider/model-3'])
  })

  it('records long and numerous slash commands', () => {
    const availableCommands = Array.from({ length: 260 }, (_, index) => ({ name: `skill-${index}`, description: 'd'.repeat(9_000), input: { hint: 'h'.repeat(5_000) } }))
    const [draft] = mapper().apply({ sessionUpdate: 'available_commands_update', availableCommands } as never)
    expect(recorded(draft!).success).toBe(true)
    const commands = (draft as { commands: Array<{ description?: string; inputHint?: string }> }).commands
    expect(commands).toHaveLength(SESSION_STATE_BOUNDS.commands)
    expect(commands[0]!.description).toHaveLength(SESSION_STATE_BOUNDS.description)
    expect(commands[0]!.inputHint).toHaveLength(SESSION_STATE_BOUNDS.description)
  })

  it('drops a session-state draft the recorder rejects instead of failing the turn', async () => {
    const recordedKinds: string[] = []
    const emit = vi.fn(async (draft: RuntimeEventDraft) => {
      if (draft.kind === 'harness_session_state') throw new Error('Too big: expected array to have <=128 items')
      recordedKinds.push(draft.kind)
    })
    const dropped = vi.fn()
    await emitTolerantSessionState([
      { kind: 'harness_session_state', threadId: 'thr', turnId: 'turn', harnessId: 'codemaker' } as RuntimeEventDraft,
      { kind: 'heartbeat', threadId: 'thr' } as RuntimeEventDraft
    ], emit, dropped)
    expect(dropped).toHaveBeenCalledOnce()
    expect(recordedKinds).toEqual(['heartbeat'])
    // Every other event still fails the turn.
    await expect(emitTolerantSessionState([{ kind: 'heartbeat', threadId: 'thr' } as RuntimeEventDraft],
      async () => { throw new Error('disk full') }, dropped)).rejects.toThrow('disk full')
  })
})
