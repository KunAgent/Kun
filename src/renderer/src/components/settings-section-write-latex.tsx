import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettingsPatch, AppSettingsV1 } from '@shared/app-settings'
import { normalizeLatexSettings, type LatexEngine } from '@shared/latex-project'
import { SettingRow, SettingsCard, Toggle } from './settings-controls'
import { LatexToolchainDialog } from './write/latex/LatexToolchainDialog'

export function WriteLatexSettingsCard({ settings, update }: { settings: AppSettingsV1; update: (patch: AppSettingsPatch) => void }): ReactElement {
  const { t } = useTranslation('common')
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const value = normalizeLatexSettings(settings.write.latex)
  const inputClass = 'rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink'
  return <SettingsCard title={t('latexSettingsTitle')} className="mt-5">
    <p className="px-1 text-[12px] leading-6 text-ds-muted">{t('latexSettingsHint')}</p>
    <SettingRow title={t('latexEnvironmentTitle')} description={t('latexSettingsEnvironmentHint')} control={<button type="button" className={inputClass} onClick={() => setEnvironmentOpen(true)}>{t('latexEnvironmentManage')}</button>} />
    <SettingRow title={t('latexDefaultEngine')} control={<select className={inputClass} value={value.engine} onChange={(event) => update({ write: { latex: { engine: event.target.value as LatexEngine } } })}>
      <option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select>} />
    <SettingRow title={t('latexAutoCompile')} control={<Toggle checked={value.autoCompile} onChange={(autoCompile) => update({ write: { latex: { autoCompile } } })} />} />
    <SettingRow title={t('latexTexPath')} description={t('latexTexPathHint')} control={<input className={`${inputClass} w-full md:max-w-md`} value={value.texPath} onChange={(event) => update({ write: { latex: { texPath: event.target.value } } })} placeholder="/Library/TeX/texbin" />} />
    {environmentOpen ? <LatexToolchainDialog engine={value.engine} toolDirectory={value.texPath} onClose={() => setEnvironmentOpen(false)} onTools={() => {}}
      onDirectoryChange={(texPath) => update({ write: { latex: { texPath } } })} /> : null}
  </SettingsCard>
}
