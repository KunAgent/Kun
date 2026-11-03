import { settingsButtonClass } from './settings-button'
import { FolderOpen, GitBranch, History } from 'lucide-react'
import { Suspense, useState, type ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsTabPanel, SettingsTabs } from './settings-controls'
import { CheckpointSettingsPanel } from './settings-section-general-checkpoints'
import { lazySection } from './settings-lazy-section'

// Worktree management talks to git and the chat store; load it only when its tab opens.
const WorktreeSettingsSection = lazySection(() =>
  import('./settings-section-worktree').then((module) => ({ default: module.WorktreeSettingsSection }))
)

type CodeSettingsTab = 'directories' | 'worktree' | 'checkpoints'

const pathInputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

function FolderSettingRow({
  title,
  description,
  value,
  placeholder,
  error,
  resetLabel,
  browseLabel,
  onChange,
  onReset,
  onBrowse
}: {
  title: string
  description: string
  value: string
  placeholder: string
  error?: string | null
  resetLabel: string
  browseLabel: string
  onChange: (value: string) => void
  onReset: () => void
  onBrowse: () => void
}): ReactElement {
  return (
    <SettingRow
      title={title}
      description={description}
      wideControl
      control={
        <div className="grid w-full min-w-0 gap-2">
          <div className="flex min-w-0 flex-wrap gap-2">
            <input
              className={`${pathInputClass} flex-1 basis-64`}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
            <button type="button" onClick={onBrowse} className={settingsButtonClass({ className: 'shrink-0' })}>
              {browseLabel}
            </button>
            <button type="button" onClick={onReset} className={settingsButtonClass({ variant: 'ghost', className: 'shrink-0' })}>
              {resetLabel}
            </button>
          </div>
          {error ? <p className="text-[13px] leading-5 text-amber-700 dark:text-amber-300">{error}</p> : null}
        </div>
      }
    />
  )
}

/** Where Code works, how it isolates branches, and the snapshots it can roll back to. */
export function CodeSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t, form, update, selectControlClass, compactHomePath, expandHomePath,
    pickWorkspace, resetWorkspaceToDefault, workspacePickerError,
    pickConversationWorkspace, resetConversationWorkspaceToDefault, conversationWorkspacePickerError
  } = ctx
  const [tab, setTab] = useState<CodeSettingsTab>(() =>
    ctx.settingsSection === 'worktree' ? 'worktree' : 'directories'
  )
  return (
    <>
      <SettingsTabs<CodeSettingsTab>
        baseId="code-settings"
        ariaLabel={t('settingsIaCode')}
        items={[
          { id: 'directories', label: t('settingsIaCodeDirectoriesTab'), icon: FolderOpen },
          { id: 'worktree', label: t('settingsIaCodeWorktreeTab'), icon: GitBranch },
          { id: 'checkpoints', label: t('settingsIaCodeCheckpointsTab'), icon: History }
        ]}
        value={tab}
        onChange={setTab}
      />
      <SettingsTabPanel baseId="code-settings" tabId="directories" active={tab === 'directories'}>
        <SettingsCard title={t('settingsIaCodeDirectoriesTab')}>
          <FolderSettingRow
            title={t('workspaceRoot')}
            description={t('workspaceRootDesc')}
            value={compactHomePath(form.workspaceRoot)}
            placeholder={t('workspaceRootPlaceholder')}
            error={workspacePickerError}
            resetLabel={t('restoreWorkspaceDefault')}
            browseLabel={t('browse')}
            onChange={(value) => update({ workspaceRoot: expandHomePath(value) })}
            onReset={resetWorkspaceToDefault}
            onBrowse={() => void pickWorkspace()}
          />
          <FolderSettingRow
            title={t('conversationWorkspaceRoot')}
            description={t('conversationWorkspaceRootDesc')}
            value={compactHomePath(form.conversationWorkspaceRoot)}
            placeholder={t('conversationWorkspaceRootPlaceholder')}
            error={conversationWorkspacePickerError}
            resetLabel={t('restoreConversationWorkspaceDefault')}
            browseLabel={t('browse')}
            onChange={(value) => update({ conversationWorkspaceRoot: expandHomePath(value) })}
            onReset={resetConversationWorkspaceToDefault}
            onBrowse={() => void pickConversationWorkspace()}
          />
        </SettingsCard>
      </SettingsTabPanel>
      <SettingsTabPanel baseId="code-settings" tabId="worktree" active={tab === 'worktree'}>
        {tab === 'worktree' ? (
          <Suspense fallback={null}>
            <WorktreeSettingsSection ctx={ctx} />
          </Suspense>
        ) : null}
      </SettingsTabPanel>
      <SettingsTabPanel baseId="code-settings" tabId="checkpoints" active={tab === 'checkpoints'}>
        <CheckpointSettingsPanel t={t} form={form} update={update} selectControlClass={selectControlClass} />
      </SettingsTabPanel>
    </>
  )
}
