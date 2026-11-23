import { describe, expect, it } from 'vitest'
import type { WorkAnnotation, WorkAnnotationMessage } from '@shared/work-annotations'
import type { WorkAnnotationAnchor } from '@shared/work-annotation-anchor'
import { annotationTurnBody, parseAnnotationAnswer } from './work-annotation-runtime'

const anchor: WorkAnnotationAnchor = { kind: 'markdown', quote: 'chosen', source: 'chosen',
  from: 4, unique: true, version: 'digest', before: 'leading', after: 'trailing' }
const asked: WorkAnnotationMessage = {
  id: 'reply', role: 'assistant', text: '', status: 'pending', createdAt: 'today',
  request: { id: 'admit-key', anchor }
}
const record: WorkAnnotation = {
  id: 'annotation-A', workspaceRoot: '/secret/workspace', filePath: '/secret/draft.md',
  anchor: { ...anchor, quote: 'changed after send' }, resolved: false, createdAt: 'today', updatedAt: 'today',
  messages: [
    { id: '1', role: 'user', text: 'private note here', createdAt: 'today' },
    { id: '2', role: 'assistant', text: 'prior answer', createdAt: 'today' },
    { id: '3', role: 'user', text: '@Kun what does this mean?', createdAt: 'today' }, asked,
    { id: '4', role: 'user', text: 'written after send', createdAt: 'today' }
  ]
}
describe('Work annotation turn boundary', () => {
  it('retains only the frozen passage and preceding discussion for an explicit question', () => {
    const body = annotationTurnBody(record, asked, { model: 'text', providerId: 'api' })
    expect(body).toMatchObject({ clientRequestId: 'admit-key', prompt: '@Kun what does this mean?', sandboxMode: 'read-only',
      paperContext: { scope: 'work-annotation', maxModelRequests: 1 } })
    const source = JSON.parse(body.paperContext.sources[0].text)
    expect(source).toEqual({ kind: 'markdown', quote: 'chosen', before: 'leading', after: 'trailing',
      history: [{ role: 'user', text: 'private note here' }, { role: 'assistant', text: 'prior answer' }] })
    expect(JSON.stringify(body)).not.toContain('/secret/')
  })

  it('keeps proposals separate from prose and bound to the source captured at send time', () => {
    const suggestion = { kind: 'insertAfter', text: 'The added paragraph.' }
    const envelope = JSON.stringify({ text: 'Here is an explanation.', suggestion })
    expect(parseAnnotationAnswer(['```json', envelope, '```'].join('\n'), anchor))
      .toEqual({ text: 'Here is an explanation.', suggestion: { ...suggestion, anchor } })
    expect(parseAnnotationAnswer('Plain explanation', anchor)).toEqual({ text: 'Plain explanation' })
    expect(parseAnnotationAnswer(JSON.stringify({ text: 'Answer', suggestion: { kind: 'deleteFile', text: '/some/path' } }), anchor))
      .toEqual({ text: 'Answer' })
  })
})
