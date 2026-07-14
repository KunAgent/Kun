import { describe, expect, it } from 'vitest'
import { auditStaticMarkup } from './accessibility-harness'

describe('static accessibility harness', () => {
  it('accepts named controls, labelled fields, and modal dialogs', () => {
    const issues = auditStaticMarkup(`
      <button aria-label="Save"></button>
      <label for="email">Email</label><input id="email" />
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title"><h2 id="dialog-title">Settings</h2></div>
    `)
    expect(issues).toEqual([])
  })

  it('reports unnamed interactive elements, fields, and dialogs', () => {
    const issues = auditStaticMarkup('<button></button><input /><div role="dialog"></div>')
    expect(issues.map((issue) => issue.rule)).toEqual([
      'interactive-name',
      'form-label',
      'dialog-semantics'
    ])
  })

  it('detects duplicate ids and broken labelledby references', () => {
    const issues = auditStaticMarkup(
      '<span id="same"></span><span id="same"></span><button aria-labelledby="missing"></button>'
    )
    expect(issues.map((issue) => issue.rule)).toEqual(['duplicate-id', 'interactive-name'])
  })

  it('ignores aria-hidden and type=hidden implementation details', () => {
    expect(auditStaticMarkup('<button aria-hidden="true"></button><input type="hidden" />')).toEqual([])
  })

  it('does not treat text inside aria-hidden icons as a control name', () => {
    const issues = auditStaticMarkup('<button><span aria-hidden="true">x</span></button>')
    expect(issues).toHaveLength(1)
    expect(issues[0]?.rule).toBe('interactive-name')
  })
})
