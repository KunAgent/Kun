/** The list query supplies at most this many code points, never a full message. */
export const ROOM_MESSAGE_PREVIEW_INPUT_LIMIT = 4096

/** A compact plain-text hint, with link destinations and embedded media removed. */
export function roomMessagePreview(body: string): string {
  const text = body
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
      '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' '
    })[entity] ?? entity)
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, code: string) => {
      const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)
      return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value) : entity
    })
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/^\s{0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/gm, '')
    // Accept unfinished destinations because the bounded SQL prefix may cut a link.
    .replace(/!?\[([^\]\n]*)\]\((?:\\.|[^)])*(?:\)|$)/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\[[^\]\n]*\]/g, '$1')
    .replace(/<!--[^]*?(?:-->|$)|<\/?[a-z][^>]*(?:>|$)/gi, ' ')
    .replace(/(?:[a-z][a-z\d+.-]*:\/\/|data:|www\.)[^\s<]+/gi, ' ')
    .replace(/^\s*(?:`{3,}|~{3,})[^\n]*(?:\n|$)/gm, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/!?(?:\[([^\]\n]+)\])/g, '$1')
    .replace(/(?<![\p{L}\p{N}])(\*{1,3}|_{1,3}|~~)(?=\S)([^]*?\S)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/`+/g, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(text).slice(0, 160).join('')
}
