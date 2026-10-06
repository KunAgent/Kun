import { useEffect, useState } from 'react'

/** Hash exactly the bytes loaded by this viewer, never a racing disk path. */
export async function paperPdfFingerprint(dataBase64: string): Promise<string> {
  const decoded = atob(dataBase64)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function usePaperPdfFingerprint(dataBase64: string): string | undefined {
  const [result, setResult] = useState<{ source: string; hash: string } | null>(null)
  useEffect(() => {
    let active = true
    void paperPdfFingerprint(dataBase64).then((hash) => { if (active) setResult({ source: dataBase64, hash }) }).catch(() => { if (active) setResult(null) })
    return () => { active = false }
  }, [dataBase64])
  return result?.source === dataBase64 ? result.hash : undefined
}
