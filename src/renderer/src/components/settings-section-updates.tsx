import type { ReactElement } from 'react'
import type { GuiUpdateChannel } from '@shared/gui-update'
import { GuiUpdateControl } from './settings-gui-update'
import { SettingsCard, SettingRow } from './settings-controls'

export function UpdatesSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    update,
    selectControlClass,
    guiUpdateInfo,
    checkingGuiUpdate,
    downloadingGuiUpdate,
    installingGuiUpdate,
    guiUpdateDownloaded,
    guiUpdateProgress,
    guiUpdateError,
    checkGuiUpdate,
    downloadGuiUpdate,
    installGuiUpdate
  } = ctx
  const channelBusy = checkingGuiUpdate || downloadingGuiUpdate || installingGuiUpdate

  return (
    <SettingsCard title={t('sectionUpdates')}>
      <SettingRow
        title={t('guiUpdateChannel')}
        description={t('guiUpdateChannelDesc')}
        control={
          <select
            className={selectControlClass}
            value={form.guiUpdate.channel}
            disabled={channelBusy}
            aria-busy={channelBusy}
            onChange={(e) =>
              update({
                guiUpdate: { channel: e.target.value as GuiUpdateChannel }
              })
            }
          >
            <option value="frontier">{t('guiUpdateChannelFrontier')}</option>
            <option value="stable">{t('guiUpdateChannelStable')}</option>
          </select>
        }
      />
      <SettingRow
        title={t('guiUpdate')}
        description={t('guiUpdateDesc')}
        control={
          <GuiUpdateControl
            info={guiUpdateInfo}
            checking={checkingGuiUpdate}
            downloading={downloadingGuiUpdate}
            installing={installingGuiUpdate}
            downloaded={guiUpdateDownloaded}
            progress={guiUpdateProgress}
            error={guiUpdateError}
            onCheck={checkGuiUpdate}
            onDownload={downloadGuiUpdate}
            onInstall={installGuiUpdate}
            t={t}
          />
        }
      />
    </SettingsCard>
  )
}
