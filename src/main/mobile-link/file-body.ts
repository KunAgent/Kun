/** Bound protected runtime/transfer bodies before materializing them in memory. */
export async function readFileBody(response: Response, max: number) {
  if (!response.body) throw new Error('FILE_UNAVAILABLE')
  const reader = response.body.getReader(), chunks: Buffer[] = []
  let count = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      count += value.length
      if (count > max) throw new Error('FILE_LIMIT')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks, count)
}
