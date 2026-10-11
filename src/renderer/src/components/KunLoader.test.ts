import { describe, expect, it } from 'vitest'
import { kunLoaderLabelText } from './KunLoader'

describe('kunLoaderLabelText', () => {
  it('drops the trailing ellipsis so the animated dots replace it', () => {
    expect(kunLoaderLabelText('加载中…')).toBe('加载中')
    expect(kunLoaderLabelText('Loading Kun...')).toBe('Loading Kun')
    expect(kunLoaderLabelText('加载中。。。')).toBe('加载中')
    expect(kunLoaderLabelText('Loading')).toBe('Loading')
  })
})
