import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { antigravityStreamSignal, type AntigravityStreamSignal } from './antigravity-stream.js'

/** Real `agy --print --output-format stream-json` captures: [arrival ms, line]. */
function fixture(name: string): Array<[number, string]> {
  return JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8')) as Array<[number, string]>
}
const signals = (name: string): Array<AntigravityStreamSignal | undefined> =>
  fixture(name).map(([, line]) => antigravityStreamSignal(line))

describe('antigravityStreamSignal', () => {
  it('reads a streamed answer: the prompt is accepted, then pieces of text, then the result', () => {
    const all = signals('agy-stream-bicycle')
    expect(all.slice(0, 2)).toEqual([{ kind: 'prompt-accepted' }, { kind: 'prompt-accepted' }])
    const text = all.filter((signal) => signal?.kind === 'text')
    expect(text.length).toBeGreaterThan(40)
    expect(text[0]).toEqual({ kind: 'text', text: '自行车的' })
    // The final step carries the last piece with the usage; the result event adds nothing.
    expect(all.at(-2)).toEqual({ kind: 'text', text: '的动态平衡。\n' })
    expect(all.at(-1)).toBeUndefined()
  })

  it('reads tool steps and an answer that arrives in one piece', () => {
    expect(signals('agy-stream-tool')).toEqual([
      { kind: 'prompt-accepted' },
      { kind: 'prompt-accepted' },
      undefined, // model step that only decided to call a tool: no text
      { kind: 'tool-started' },
      { kind: 'tool-finished' },
      { kind: 'text', text: '该命令的输出为 `kun-probe`。\n' },
      undefined
    ])
  })

  it('ignores noise, other events and unknown steps', () => {
    expect(antigravityStreamSignal('')).toBeUndefined()
    expect(antigravityStreamSignal('not json')).toBeUndefined()
    expect(antigravityStreamSignal('null')).toBeUndefined()
    expect(antigravityStreamSignal('{"event":"warning","message":"x"}')).toBeUndefined()
    expect(antigravityStreamSignal('{"event":"step_update","step_update":{"step_type":"thought","state":"ACTIVE"}}')).toBeUndefined()
    expect(antigravityStreamSignal('{"event":"step_update","step_update":{"step_type":"tool","state":"PENDING"}}')).toBeUndefined()
    expect(antigravityStreamSignal('{"event":"step_update","step_update":{"step_type":"agent_response","state":"ACTIVE","text_delta":""}}')).toBeUndefined()
  })
})
