import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { beginPaperJob, cancelPaperJob, finishPaperJob } from './paper-jobs'

function sender() {
  const events = new EventEmitter() as EventEmitter & {
    send: (channel: string, payload: unknown) => void
    isDestroyed: () => boolean
    messages: Array<{ channel: string; payload: unknown }>
  }
  events.messages = []
  events.send = (channel, payload) => { events.messages.push({ channel, payload }) }
  events.isDestroyed = () => false
  return events as typeof events & WebContents
}

describe('paper jobs', () => {
  it('does not let one remote sender cancel or replace another sender job', () => {
    const a = sender()
    const b = sender()
    const first = beginPaperJob('same-id', 'import', a)
    const second = beginPaperJob('same-id', 'import', b)
    expect(cancelPaperJob('same-id', b)).toBe(true)
    expect(second.signal.aborted).toBe(true)
    expect(first.signal.aborted).toBe(false)
    finishPaperJob('same-id', 'done', a, first.signal)
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
    finishPaperJob('same-id', 'canceled', b, second.signal)
  })

  it('ignores completion of a superseded job', () => {
    const client = sender()
    const earlier = beginPaperJob('replace', 'import', client)
    const later = beginPaperJob('replace', 'import', client)
    expect(earlier.signal.aborted).toBe(true)
    finishPaperJob('replace', 'done', client, earlier.signal)
    expect(client.messages).toHaveLength(0)
    expect(cancelPaperJob('replace', client)).toBe(true)
    finishPaperJob('replace', 'canceled', client, later.signal)
    expect(client.messages).toHaveLength(1)
  })

  it('aborts a later job on the same sender after the earlier job finished', () => {
    const client = sender()
    const earlier = beginPaperJob('earlier', 'import', client)
    finishPaperJob('earlier', 'done', client, earlier.signal)
    const later = beginPaperJob('later', 'import', client)
    expect(client.listenerCount('destroyed')).toBe(1)
    client.emit('destroyed')
    expect(later.signal.aborted).toBe(true)
  })

  it('aborts owned jobs when their sender is destroyed', () => {
    const client = sender()
    const job = beginPaperJob('disconnect', 'import', client)
    client.emit('destroyed')
    expect(job.signal.aborted).toBe(true)
  })
})
