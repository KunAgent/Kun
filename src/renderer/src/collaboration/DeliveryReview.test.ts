import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeliveryReview } from './DeliveryReview'

describe('DeliveryReview', () => {
  afterEach(() => { delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT })

  it('does not mutate the workspace during preview and applies only after explicit click', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const onApply = vi.fn(async () => undefined)
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(DeliveryReview, {
        title: 'Review delivery',
        files: [{ path: 'README.md', kind: 'modified', bytes: 5, beforeSha256: 'a'.repeat(64), afterSha256: 'b'.repeat(64) }],
        onApply
      }))
    })
    expect(onApply).not.toHaveBeenCalled()
    await act(async () => { await renderer.root.findByProps({ 'aria-label': '应用交付物' }).props.onClick() })
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})
