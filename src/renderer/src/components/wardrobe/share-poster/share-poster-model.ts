export type PosterStyle = 'night' | 'sunset' | 'paper'
export type PosterSize = 'portrait' | 'square'
export const POSTER_STYLES: PosterStyle[] = ['night', 'sunset', 'paper']
export const POSTER_SIZES: PosterSize[] = ['portrait', 'square']
export const POSTER_THEMES = {
  night: { bg: ['#111a2f', '#161a35', '#1d1a2a'], ink: '#eef1ff', ink2: '#b9c3e5', card: '#ffffff14', qrfg: '#111a2f', chip: '#ffffff1a', art: 'share-bg-night' },
  sunset: { bg: ['#ffe8d2', '#ffd6c9', '#e9d4ff'], ink: '#3b2540', ink2: '#70516a', card: '#ffffffb3', qrfg: '#3b2540', chip: '#ffffff99', art: 'share-bg-sunset' },
  paper: { bg: ['#fbfbf8', '#fbfbf8', '#fbfbf8'], ink: '#20242d', ink2: '#606879', card: '#ffffff', qrfg: '#20242d', chip: '#eef1f5', art: 'share-bg-paper' }
} as const

/** Coordinates are the design's em units multiplied by 36, rounded to output pixels. */
export function posterLayout(size: PosterSize) {
  const square = size === 'square'
  const height = square ? 1080 : 1440
  const margin = square ? 72 : 79
  const avatarSize = square ? 378 : 540
  const avatarY = square ? 130 : 182
  const brandY = height - (square ? 47 : 58)
  const cardY = brandY - 32 - 26 - 295
  return { width: 1080, height, margin, avatar: { x: (1080 - avatarSize) / 2, y: avatarY, size: avatarSize, radius: square ? 68 : 86 },
    kickerY: square ? 65 : 86, titleY: avatarY + avatarSize + (square ? 12 : 20), titleSize: square ? 59 : 74,
    card: { x: margin, y: cardY, width: 1080 - margin * 2, height: 295 }, brandY, qrSize: 223 }
}
const COPY = {
  zh: { kicker: '来自好友的邀请', title: ['一起养一只', '会干活的 Kun'], lead: ['注册并用一次 Kun，我们各得漂流瓶，', '开出新装扮'], code: '邀请码', scan: '扫码或打开链接', gift: '注册领取漂流瓶', brand: 'Kun · 写代码、查资料、整理文档的桌面助手' },
  en: { kicker: 'An invitation from a friend', title: ['Raise a Kun', 'that gets work done'], lead: ['Sign up and try Kun. We both get bottles', 'with new outfits inside.'], code: 'Invite code', scan: 'Scan or open the link', gift: 'Sign up for welcome bottles', brand: 'Kun · Your desktop assistant for code, research and docs' }
} as const
export const posterCopy = (language: string) => COPY[language.toLowerCase().startsWith('zh') ? 'zh' : 'en']
export const posterFileName = (code: string, language: string): string =>
  `Kun-${language.startsWith('zh') ? '邀请' : 'Invite'}-${code.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '').slice(0, 32) || 'Kun'}.png`
export const posterDisplayCode = (code: string): string => code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code

/** Preserve the server-issued link exactly; never fabricate an invitation when the read failed. */
export function posterQrContent(code: string, link: string): string {
  if (!/^[a-zA-Z0-9]{4}-?[a-zA-Z0-9]{4}$/.test(code)) throw new Error('missing-invite')
  let url: URL
  try { url = new URL(link) } catch { throw new Error('missing-invite') }
  if (url.protocol !== 'https:' || url.username || url.password || link.length > 512 ||
      decodeURIComponent(url.pathname.split('/').at(-1) ?? '').replace(/-/g, '').toUpperCase() !== code.replace(/-/g, '').toUpperCase()) throw new Error('missing-invite')
  return link
}
