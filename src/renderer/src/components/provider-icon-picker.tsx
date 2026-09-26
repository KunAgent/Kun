import type { ModelProviderProfileV1 } from '@shared/app-settings'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useRef, useState, type ReactElement } from 'react'
import { ProviderIcon } from './provider-icon'

const MAX_ICON_BYTES = 1024 * 1024

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Custom provider icon picker: uploads a small image through
 * `provider:icon:import` (main process validates + content-addresses it) and
 * stores the returned `iconId` on the profile.
 */
export function ProviderIconPicker({
  provider,
  t,
  onChange
}: {
  provider: ModelProviderProfileV1
  t: (key: string, options?: Record<string, unknown>) => string
  onChange: (patch: Partial<ModelProviderProfileV1>) => void
}): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError('')
    if (file.size > MAX_ICON_BYTES) {
      setError(t('modelProviderIconTooLarge'))
      return
    }
    setBusy(true)
    try {
      const result = await window.kunGui.importProviderIcon({
        mime: file.type || 'application/octet-stream',
        dataBase64: await fileToBase64(file)
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onChange({ iconId: result.iconId })
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="grid gap-1.5">
      <span className="text-[12.5px] font-medium text-ds-muted">{t('modelProviderIconLabel')}</span>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-ds-border-muted bg-ds-main/45 text-ds-muted">
          <ProviderIcon
            presetId={provider.presetSource?.presetId}
            providerId={provider.id}
            iconId={provider.iconId}
            className="h-5 w-5"
          />
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          className="hidden"
          onChange={(event) => void pick(event.target.files?.[0])}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:opacity-55"
        >
          <ImagePlus className="h-3.5 w-3.5" strokeWidth={1.9} />
          {provider.iconId ? t('modelProviderIconReplace') : t('modelProviderIconUpload')}
        </button>
        {provider.iconId ? (
          <button
            type="button"
            onClick={() => onChange({ iconId: undefined })}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
            {t('modelProviderIconRemove')}
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-[12px] leading-5 text-red-600 dark:text-red-300">{error}</p>
      ) : null}
      <p className="text-[11.5px] leading-4 text-ds-faint">{t('modelProviderIconHint')}</p>
    </div>
  )
}
