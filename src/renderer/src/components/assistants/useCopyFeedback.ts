import { useEffect, useRef, useState } from 'react'

/** Copies text and remembers which item was copied for two seconds, for "已复制" feedback. */
export function useCopyFeedback(): { copied: string; copy: (id: string, text: string) => Promise<boolean> } {
  const [copied, setCopied] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (id: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return false
    }
    setCopied(id)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(''), 2000)
    return true
  }
  return { copied, copy }
}
