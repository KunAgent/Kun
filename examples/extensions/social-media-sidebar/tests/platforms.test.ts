import { describe, expect, it } from 'vitest'
import { SOCIAL_PLATFORMS, socialPlatform, socialPlatformForUrl } from '../src/webview/platforms'

describe('social media destinations', () => {
  it('exposes only the three product destinations over HTTPS', () => {
    expect(SOCIAL_PLATFORMS.map((platform) => platform.id)).toEqual([
      'douyin',
      'bilibili',
      'xiaohongshu'
    ])
    expect(SOCIAL_PLATFORMS.every((platform) => new URL(platform.url).protocol === 'https:')).toBe(true)
  })

  it('maps approved subdomains back to the active platform', () => {
    expect(socialPlatform('douyin')?.name).toBe('抖音')
    expect(socialPlatformForUrl('https://space.bilibili.com/123')?.id).toBe('bilibili')
    expect(socialPlatformForUrl('https://www.xiaohongshu.com/explore')?.id).toBe('xiaohongshu')
    expect(socialPlatformForUrl('https://example.com/')?.id).toBeUndefined()
  })
})
