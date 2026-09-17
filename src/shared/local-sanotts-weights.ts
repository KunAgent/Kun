/**
 * sanoTTS piperlite voices added in 2026-09 ship float16 blobs. The WASM
 * runtime always reads float32, so the loader widens them before synthesis.
 */
export type SanottsWeightDims = {
  meta_bytes?: number
  weight_floats?: number
}

export function widenSanottsF16(bytes: Uint8Array, dims: SanottsWeightDims | undefined): Uint8Array {
  const head = Number(dims?.meta_bytes)
  const count = Number(dims?.weight_floats)
  if (!Number.isInteger(head) || !Number.isInteger(count) || head < 0 || count <= 0) {
    throw new Error('sanoTTS f16 blob has no usable meta_bytes/weight_floats')
  }
  if (bytes.length !== head + 2 * count) {
    throw new Error(`sanoTTS f16 blob is ${bytes.length} bytes, meta.json implies ${head + 2 * count}`)
  }
  const out = new Uint8Array(head + 4 * count)
  out.set(bytes.subarray(0, head), 0)
  const src = new DataView(bytes.buffer, bytes.byteOffset + head, 2 * count)
  const dst = new DataView(out.buffer, head, 4 * count)
  for (let index = 0; index < count; index += 1) {
    dst.setFloat32(index * 4, float16ToFloat32(src.getUint16(index * 2, true)), true)
  }
  return out
}

function float16ToFloat32(bits: number): number {
  const exponent = (bits >> 10) & 0x1f
  const fraction = bits & 0x3ff
  const sign = bits & 0x8000 ? -1 : 1
  if (exponent === 0) return sign * fraction * 5.960464477539063e-8
  if (exponent === 31) return fraction ? Number.NaN : sign * Infinity
  return sign * 2 ** (exponent - 25) * (1024 + fraction)
}
