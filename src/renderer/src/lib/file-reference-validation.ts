import { useEffect, useMemo, useState } from 'react'
import type { FileReferenceTarget } from './file-references'

type ValidationState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'valid'; path: string }
  | { status: 'invalid' }

type SettledValidation = Extract<ValidationState, { status: 'valid' | 'invalid' }>
type CachedValidation = SettledValidation | Promise<SettledValidation>

const validationCache = new Map<string, CachedValidation>()

function cacheKey(target: FileReferenceTarget | null, workspaceRoot?: string): string {
  return `${workspaceRoot?.trim() ?? ''}\u0000${target?.path ?? ''}`
}

async function validateFileReference(
  target: FileReferenceTarget,
  workspaceRoot?: string
): Promise<SettledValidation> {
  const key = cacheKey(target, workspaceRoot)
  const cached = validationCache.get(key)
  if (cached) return cached instanceof Promise ? cached : cached

  const task = (async (): Promise<SettledValidation> => {
    if (typeof window.dsGui?.resolveWorkspaceFile !== 'function') {
      return { status: 'invalid' }
    }

    const result = await window.dsGui.resolveWorkspaceFile({
      path: target.path,
      line: target.line,
      column: target.column,
      workspaceRoot
    })

    return result.ok ? { status: 'valid', path: result.path } : { status: 'invalid' }
  })()

  validationCache.set(key, task)
  try {
    const resolved = await task
    validationCache.set(key, resolved)
    return resolved
  } catch {
    const fallback = { status: 'invalid' } as const
    validationCache.set(key, fallback)
    return fallback
  }
}

export function useValidatedFileReference(
  target: FileReferenceTarget | null,
  workspaceRoot?: string
): ValidationState {
  const key = useMemo(() => cacheKey(target, workspaceRoot), [target, workspaceRoot])
  const [state, setState] = useState<ValidationState>(() => {
    if (!target?.path) return { status: 'idle' }
    const cached = validationCache.get(key)
    if (!cached) return { status: 'pending' }
    if (cached instanceof Promise) return { status: 'pending' }
    return cached
  })

  useEffect(() => {
    if (!target?.path) {
      setState({ status: 'idle' })
      return
    }

    const cached = validationCache.get(key)
    if (cached && !(cached instanceof Promise)) {
      setState(cached)
      return
    }

    let cancelled = false
    setState({ status: 'pending' })
    void validateFileReference(target, workspaceRoot).then((next) => {
      if (!cancelled) setState(next)
    })

    return () => {
      cancelled = true
    }
  }, [key, target, workspaceRoot])

  return state
}
