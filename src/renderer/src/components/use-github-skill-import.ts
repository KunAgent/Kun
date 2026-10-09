import { useCallback, useState } from 'react'
import type { Notice } from './plugin-marketplace-config'

type Translate = (key: string, values?: Record<string, unknown>) => string

/** State and action behind the marketplace's "import skills from GitHub" panel. */
export function useGitHubSkillImport(input: {
  t: Translate
  skillRootPath: string | undefined
  setNotice: (notice: Notice | null) => void
  refreshSkills: () => Promise<unknown>
}) {
  const { t, skillRootPath, setNotice, refreshSkills } = input
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ count: number; names: string[] } | null>(null)

  const reset = useCallback((): void => {
    setOpen(false)
    setSummary(null)
  }, [])

  const importSkills = async (): Promise<void> => {
    if (!skillRootPath) {
      setNotice({ tone: 'error', message: t('pluginSkillRootMissing') })
      return
    }
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setNotice({ tone: 'error', message: t('pluginGithubImportUrlRequired') })
      return
    }
    setBusy(true)
    setNotice(null)
    setSummary(null)
    try {
      const result = await window.kunGui.importSkillsFromGitHub(skillRootPath, trimmedUrl)
      if (!result.ok) {
        throw new Error(result.message)
      }
      await refreshSkills()
      setSummary({
        count: result.count,
        names: result.names
      })
      setNotice({ tone: 'success', message: t('pluginGithubImportSuccess', { count: result.count }) })
      setUrl('')
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return { open, setOpen, url, setUrl, busy, summary, reset, importSkills }
}
