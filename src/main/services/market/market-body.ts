/** Reads a response body, aborting as soon as it exceeds `maxBytes`. */
export async function readCappedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Download is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`)
  }
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maxBytes) throw new Error('Download is too large.')
    return buffer
  }
  const chunks: Buffer[] = []
  let total = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw new Error(`Download is larger than ${Math.round(maxBytes / (1024 * 1024))} MB.`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}
