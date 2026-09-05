import { describe, expect, it } from 'vitest'
import {
  IncrementalSseParser,
  parseReplayResetRequiredFrame,
  parseRuntimeEventFrame
} from './sse.js'

const encoder = new TextEncoder()

describe('IncrementalSseParser', () => {
  it('parses fragmented CRLF frames and multiline data', () => {
    const parser = new IncrementalSseParser()
    expect(parser.push(encoder.encode('id: 2\r\nevent: custom\r\ndata: {"a"'))).toEqual([])
    expect(parser.push(encoder.encode(':1}\r\ndata: tail\r\n\r\n'))).toEqual([
      { id: '2', event: 'custom', data: '{"a":1}\ntail' }
    ])
  })

  it('parses a runtime event and ignores unknown forward-compatible events', () => {
    expect(parseRuntimeEventFrame({
      event: 'turn_started',
      id: '1',
      data: JSON.stringify({
        kind: 'turn_started',
        seq: 1,
        timestamp: '2026-07-22T00:00:00.000Z',
        threadId: 'thr_1',
        turnId: 'turn_1',
        status: 'running'
      })
    })).toMatchObject({ kind: 'turn_started', seq: 1 })
    expect(parseRuntimeEventFrame({ event: 'future', data: '{"kind":"future","seq":2}' })).toBeNull()
  })

  it('surfaces stream error frames without echoing invalid raw JSON', () => {
    expect(() => parseRuntimeEventFrame({ event: 'error', data: '{"message":"reconnect"}' })).toThrow('reconnect')
    expect(() => parseRuntimeEventFrame({ event: 'error', data: '<html>secret</html>' })).toThrow(
      'runtime event stream returned invalid JSON'
    )
  })

  it('strictly parses replay reset control frames', () => {
    expect(parseReplayResetRequiredFrame({
      event: 'replay_reset_required',
      data: '{"threadId":"thr_1","floorSeq":42}'
    })).toEqual({ threadId: 'thr_1', floorSeq: 42 })
    expect(parseReplayResetRequiredFrame({ event: 'turn_started', data: '{}' })).toBeNull()
    expect(() => parseReplayResetRequiredFrame({
      event: 'replay_reset_required',
      data: '{"threadId":"thr_1","floorSeq":-1}'
    })).toThrow('invalid payload')
  })
})
