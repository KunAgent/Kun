export type CopyImageToClipboardSource = {
  path?: string
  workspaceRoot?: string
  dataUrl?: string
}

export type CopyImageToClipboardResult =
  | { ok: true }
  | { ok: false; message: string }

const DATA_URL_PATTERN = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/
const FETCHABLE_URL_PATTERN = /^(blob:|https?:)/i

export function parseImageDataUrl(
  dataUrl: string | undefined
): { dataBase64: string; mimeType?: string } | null {
  const match = dataUrl?.trim().match(DATA_URL_PATTERN)
  if (!match?.[2]) return null
  return {
    dataBase64: match[2],
    ...(match[1] ? { mimeType: match[1] } : {})
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

async function payloadFromUrl(
  url: string
): Promise<{ dataBase64: string; mimeType?: string } | null> {
  const parsed = parseImageDataUrl(url)
  if (parsed) return parsed
  if (!FETCHABLE_URL_PATTERN.test(url)) return null

  const response = await fetch(url)
  if (!response.ok) return null
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.length === 0) return null
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim()
  return {
    dataBase64: bytesToBase64(buffer),
    ...(mimeType ? { mimeType } : {})
  }
}

async function writeClipboardItem(payload: {
  dataBase64: string
  mimeType?: string
}): Promise<CopyImageToClipboardResult> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.write !== 'function') {
    return { ok: false, message: 'Clipboard image copy is not available.' }
  }
  const mimeType = payload.mimeType?.startsWith('image/') ? payload.mimeType : 'image/png'
  if (mimeType === 'image/svg+xml') {
    return { ok: false, message: 'This image could not be copied as a bitmap.' }
  }
  try {
    const binary = atob(payload.dataBase64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    await navigator.clipboard.write([
      new ClipboardItem({ [mimeType]: new Blob([bytes], { type: mimeType }) })
    ])
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function copyImageToClipboard(
  source: CopyImageToClipboardSource
): Promise<CopyImageToClipboardResult> {
  const writeImage = window.kunGui?.writeClipboardImage
  const path = source.path?.trim()
  if (path && typeof writeImage === 'function') {
    const result = await writeImage({
      path,
      ...(source.workspaceRoot?.trim() ? { workspaceRoot: source.workspaceRoot.trim() } : {})
    })
    if (result.ok || !source.dataUrl?.trim()) return result
  }

  const dataUrl = source.dataUrl?.trim()
  if (!dataUrl) {
    return { ok: false, message: 'Image data is not available to copy.' }
  }

  let payload: { dataBase64: string; mimeType?: string } | null
  try {
    payload = await payloadFromUrl(dataUrl)
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  if (!payload) {
    return { ok: false, message: 'Image data is not available to copy.' }
  }

  if (typeof writeImage === 'function') {
    return writeImage({
      dataBase64: payload.dataBase64,
      ...(payload.mimeType ? { mimeType: payload.mimeType } : {})
    })
  }

  return writeClipboardItem(payload)
}
