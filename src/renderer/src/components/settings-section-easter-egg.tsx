import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { BookOpen, FolderPlus, Palette, Trash2 } from 'lucide-react'
import { UI_MODE_DEFAULT, UI_MODE_RETROMA } from '../lib/ui-mode'
import { useUiPluginStore } from '../store/ui-plugin-store'
import kunBirdFigure from '../../../asset/img/kun_bird.png'
import { SettingsCard, SettingRow } from './settings-controls'

type ModeCard = {
  mode: string
  title: string
  subtitle: string
  preview: string | null
  removable: boolean
}

function ModeCardButton({
  card,
  active,
  busy,
  onActivate,
  onRemove,
  onTogglePalette,
  paletteOn,
  activeLabel,
  activateLabel,
  removeLabel,
  paletteOnLabel,
  paletteOffLabel
}: {
  card: ModeCard
  active: boolean
  busy: boolean
  onActivate: () => void
  onRemove?: () => void
  /** 切换 Retroma 羊皮纸配色(仅默认 Kun 卡片提供) */
  onTogglePalette?: () => void
  /** Retroma 配色当前是否开启 */
  paletteOn?: boolean
  activeLabel: string
  activateLabel: string
  removeLabel: string
  paletteOnLabel: string
  paletteOffLabel: string
}): ReactElement {
  return (
    <div
      className={`relative flex flex-col items-center gap-2 rounded-2xl border p-4 text-center transition ${
        active
          ? 'border-accent/45 bg-accent/8 shadow-[0_10px_28px_rgba(59,130,216,0.12)]'
          : 'border-ds-border bg-ds-card hover:border-accent/25 hover:bg-ds-hover'
      }`}
    >
      <span className="flex h-16 w-16 items-center justify-center">
        {card.preview ? (
          <img
            src={card.preview}
            alt=""
            className="max-h-16 max-w-16 object-contain"
            draggable={false}
            decoding="async"
            loading="lazy"
          />
        ) : (
          <span className="h-12 w-12 rounded-xl bg-ds-subtle" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block whitespace-normal break-words text-[13.5px] font-semibold leading-5 text-ds-ink">
          {card.title}
        </span>
        <span className="mt-0.5 block whitespace-normal break-words text-[11.5px] leading-4 text-ds-faint">
          {card.subtitle}
        </span>
      </span>
      <button
        type="button"
        disabled={busy || active}
        onClick={onActivate}
        className={`mt-1 w-full rounded-full px-3 py-1.5 text-[12px] font-medium transition ${
          active
            ? 'bg-accent/15 text-accent'
            : 'bg-ds-subtle text-ds-muted hover:bg-accent/12 hover:text-accent'
        } disabled:cursor-default`}
      >
        {active ? activeLabel : activateLabel}
      </button>
      {onTogglePalette ? (
        <button
          type="button"
          disabled={busy}
          onClick={onTogglePalette}
          title={paletteOn ? paletteOnLabel : paletteOffLabel}
          aria-label={paletteOn ? paletteOnLabel : paletteOffLabel}
          aria-pressed={paletteOn ? 'true' : 'false'}
          className={`absolute right-2 top-2 rounded-md p-1 transition disabled:opacity-50 ${
            paletteOn
              ? 'bg-accent/15 text-accent hover:bg-accent/20'
              : 'text-ds-faint hover:bg-accent/12 hover:text-accent'
          }`}
        >
          <Palette className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}
      {card.removable && onRemove ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          title={removeLabel}
          aria-label={removeLabel}
          className="absolute right-2 top-2 rounded-md p-1 text-ds-faint transition hover:bg-ds-danger-soft hover:text-ds-danger disabled:cursor-default disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}

export function EasterEggSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t } = ctx
  const uiMode = useUiPluginStore((s) => s.uiMode)
  const installed = useUiPluginStore((s) => s.installed)
  const busy = useUiPluginStore((s) => s.busy)
  const lastError = useUiPluginStore((s) => s.lastError)
  const initUiPlugins = useUiPluginStore((s) => s.initUiPlugins)
  const activateUiMode = useUiPluginStore((s) => s.activateUiMode)
  const installUiPluginFromDialog = useUiPluginStore((s) => s.installUiPluginFromDialog)
  const removeUiPluginById = useUiPluginStore((s) => s.removeUiPluginById)
  const [installErrors, setInstallErrors] = useState<string[]>([])

  useEffect(() => {
    void initUiPlugins()
  }, [initUiPlugins])

  // 内置只有「默认 Kun」;iKun 是预装的示例插件,从已安装列表自然出现
  const builtinCards: ModeCard[] = [
    {
      mode: UI_MODE_DEFAULT,
      title: t('uiModeDefaultTitle'),
      subtitle: t('uiModeDefaultSubtitle'),
      preview: kunBirdFigure,
      removable: false
    }
  ]

  const pluginCards: ModeCard[] = installed.map((item) => ({
    mode: item.manifest.id,
    title: item.manifest.name,
    subtitle: [item.manifest.author, `v${item.manifest.version}`].filter(Boolean).join(' · '),
    preview: item.previewDataUrl,
    removable: true
  }))

  const handleInstall = async (): Promise<void> => {
    setInstallErrors([])
    const result = await installUiPluginFromDialog()
    if (!result.ok && !result.canceled) {
      setInstallErrors(result.errors ?? [t('uiPluginInstallFailed')])
    }
  }

  return (
    <SettingsCard title={t('easterEggSection')}>
      <SettingRow
        title={t('uiModeWorkshopTitle')}
        description={t('uiModeWorkshopDesc')}
        wideControl
        control={
          <div className="flex w-full flex-col gap-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[...builtinCards, ...pluginCards].map((card) => {
                const isBuiltin = card.mode === UI_MODE_DEFAULT
                // 默认 Kun 卡承载 Retroma 配色:default 或 retroma 均视为该卡激活
                const cardActive =
                  isBuiltin ? uiMode === UI_MODE_DEFAULT || uiMode === UI_MODE_RETROMA : uiMode === card.mode
                const retromaOn = uiMode === UI_MODE_RETROMA
                return (
                  <ModeCardButton
                    key={card.mode}
                    card={card}
                    active={cardActive}
                    busy={busy}
                    onActivate={() => void activateUiMode(card.mode)}
                    onRemove={
                      card.removable ? () => void removeUiPluginById(card.mode) : undefined
                    }
                    onTogglePalette={
                      isBuiltin
                        ? () => void activateUiMode(retromaOn ? UI_MODE_DEFAULT : UI_MODE_RETROMA)
                        : undefined
                    }
                    paletteOn={isBuiltin ? retromaOn : undefined}
                    activeLabel={t('uiPluginActive')}
                    activateLabel={t('uiPluginActivate')}
                    removeLabel={t('uiPluginRemove')}
                    paletteOnLabel={t('uiPaletteRetromaOn')}
                    paletteOffLabel={t('uiPaletteRetromaOff')}
                  />
                )
              })}
            </div>
            {pluginCards.length === 0 ? (
              <p className="text-[12.5px] leading-5 text-ds-faint">{t('uiPluginEmpty')}</p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleInstall()}
                className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full bg-accent/12 px-4 py-2 text-[12.5px] font-medium leading-5 text-accent transition hover:bg-accent/18 disabled:opacity-60"
              >
                <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="min-w-0 whitespace-normal break-words text-center">{t('uiPluginInstall')}</span>
              </button>
              <span className="inline-flex min-w-0 items-center justify-center gap-2 rounded-full border border-ds-border bg-ds-card px-4 py-2 text-[12px] leading-5 text-ds-faint">
                <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="min-w-0 whitespace-normal break-words text-center">{t('uiPluginDocsHint')}</span>
              </span>
            </div>
            {installErrors.length > 0 ? (
              <ul className="rounded-xl bg-ds-danger-soft px-3 py-2 text-[12px] leading-5 text-ds-danger">
                {installErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
            {lastError ? (
              <p className="text-[12px] text-ds-danger">{lastError}</p>
            ) : null}
          </div>
        }
      />
    </SettingsCard>
  )
}
