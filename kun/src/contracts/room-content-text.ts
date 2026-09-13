/** Ordinary prose only: code examples must not initiate preview network traffic. */
export function firstRoomBodyUrl(body: string): string | undefined {
  let fence: { character: string; length: number } | undefined
  const prose = body.split(/\r?\n/).map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      return ''
    }
    if (marker) { fence = { character: marker[1][0], length: marker[1].length }; return '' }
    if (/^(?: {4}|\t)/.test(line)) return ''
    return line
  }).join('\n').replace(/(`+)[\s\S]*?\1/g, ' ')
  const match = /https?:\/\/[^\s<>()[\]"']+/i.exec(prose)?.[0]?.replace(/[.,!?;:]+$/, '')
  return match && match.length <= 4096 ? match : undefined
}
