export type SocialPlatformId = 'douyin' | 'bilibili' | 'xiaohongshu'

export type SocialPlatform = {
  id: SocialPlatformId
  name: string
  shortName: string
  url: string
  accent: string
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = Object.freeze([
  Object.freeze({
    id: 'douyin',
    name: '抖音',
    shortName: '抖',
    url: 'https://www.douyin.com/',
    accent: '#20d5ec'
  }),
  Object.freeze({
    id: 'bilibili',
    name: '哔哩哔哩',
    shortName: 'B',
    url: 'https://www.bilibili.com/',
    accent: '#00aeec'
  }),
  Object.freeze({
    id: 'xiaohongshu',
    name: '小红书',
    shortName: '红',
    url: 'https://www.xiaohongshu.com/explore',
    accent: '#ff2442'
  })
])

export function socialPlatform(id: string): SocialPlatform | undefined {
  return SOCIAL_PLATFORMS.find((platform) => platform.id === id)
}

export function socialPlatformForUrl(rawUrl: string): SocialPlatform | undefined {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase()
    return SOCIAL_PLATFORMS.find((platform) => {
      const root = new URL(platform.url).hostname.replace(/^www\./, '')
      return hostname === root || hostname.endsWith(`.${root}`)
    })
  } catch {
    return undefined
  }
}
