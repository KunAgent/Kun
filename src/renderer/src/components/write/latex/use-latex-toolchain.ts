import { useCallback, useEffect, useRef, useState } from 'react'
import type { LatexEngine, LatexTools } from '@shared/latex-project'
import { latexInstallationActive, type LatexToolchainState, type LatexToolchainStatus } from '@shared/latex-toolchain'

export function useLatexToolchain(engine: LatexEngine, toolDirectory: string, onTools: (tools: LatexTools) => void) {
  const [status, setStatus] = useState<LatexToolchainStatus | null>(null)
  const [state, setState] = useState<LatexToolchainState | null>(null)
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const requests = useRef(0)
  const events = useRef(0)
  const onToolsRef = useRef(onTools)
  onToolsRef.current = onTools
  const refresh = useCallback(async (): Promise<void> => {
    const request = ++requests.current
    const event = events.current
    setChecking(true)
    setError('')
    try {
      const result = await window.kunGui.latexToolchainStatus({ engine, toolDirectory })
      if (!mounted.current || request !== requests.current) return
      if (!result.ok) throw new Error(result.message)
      setStatus(result)
      if (event === events.current) setState(result.state)
      onToolsRef.current(result.tools)
    } catch (error) {
      if (mounted.current && request === requests.current) setError(error instanceof Error ? error.message : String(error))
    } finally { if (mounted.current && request === requests.current) setChecking(false) }
  }, [engine, toolDirectory])
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.kunGui.onLatexToolchainState((state) => {
      events.current++
      setState(state)
      if (!latexInstallationActive(state.phase)) void refresh()
    })
    void refresh()
    return () => { mounted.current = false; unsubscribe() }
  }, [refresh])

  const install = async (): Promise<void> => {
    const event = events.current
    setStarting(true)
    setError('')
    try {
      const result = await window.kunGui.latexInstallTools()
      if (!mounted.current) return
      if (!result.ok) throw new Error(result.message)
      if (event === events.current) setState(result.state)
      await refreshRef.current()
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) setStarting(false) }
  }
  const cancel = async (): Promise<void> => {
    if (!state?.jobId) return
    try {
      const result = await window.kunGui.latexCancelToolInstall({ jobId: state.jobId })
      if (!result.ok) throw new Error(result.message)
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
  }
  return { status, state, checking, error, setError, refresh, install, cancel, busy: starting || !!state && latexInstallationActive(state.phase) }
}
