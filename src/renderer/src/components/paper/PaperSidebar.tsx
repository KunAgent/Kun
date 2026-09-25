import type { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Compass,
  Import,
  LibraryBig,
  Settings,
  Smartphone
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore, type SettingsRouteSection } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { activePaperViewId } from '../../write/write-editor-layout'
import { usePaperModeStore } from '../../paper/paper-mode-store'
import { openPaperViewTab } from '../../paper/paper-view'
import { WorkspaceModeTabs } from '../chat/WorkspaceModeTabs'
import { ConnectPhoneSidebarPanel } from '../chat/ConnectPhoneView'
import {
  SidebarCommandRow,
  SidebarFrame,
  SidebarIconButton,
  SidebarSearchField,
  SidebarSectionHeader
} from '../sidebar/SidebarPrimitives'
import { SidebarFocusModeControl } from '../sidebar/SidebarFocusModeControl'
import { PaperModeToggle } from './PaperModeToggle'
import { PaperLibrarySwitcher } from './sidebar/PaperLibrarySwitcher'
import { PaperTree } from './sidebar/PaperTree'
import { PaperInfoPanel } from './sidebar/PaperInfoPanel'

type Props = {
  activeView: 'chat' | 'write' | 'claw' | 'schedule' | 'workflow'
  connectPhoneSidebarOpen: boolean
  focusModeEnabled: boolean
  onCodeOpen: () => void
  onWriteOpen: () => void
  onFocusModeChange: (enabled: boolean) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onToggleConnectPhone: () => void
}

const STATUS_CHIPS = [
  { key: 'all', labelKey: 'writePaperFilterAll' },
  { key: 'recent', labelKey: 'writePaperFilterRecent' },
  { key: 'unread', labelKey: 'writePaperFilterUnread' },
  { key: 'reading', labelKey: 'writePaperFilterReading' },
  { key: 'read', labelKey: 'writePaperFilterRead' }
] as const

/**
 * Papers-surface sidebar (U3): mode toggle, library switcher, search +
 * status/tag/group filters that drive the library tab, a grouped paper tree
 * with title rows instead of the raw file tree, and a persistent info panel
 * pinned to the bottom for the focused paper.
 */
export function PaperSidebar({
  activeView,
  connectPhoneSidebarOpen,
  focusModeEnabled,
  onCodeOpen,
  onWriteOpen,
  onFocusModeChange,
  onOpenSettings,
  onToggleConnectPhone
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const clawChannels = useChatStore((s) => s.clawChannels)
  const addClawChannel = useChatStore((s) => s.addClawChannel)
  const deleteClawChannel = useChatStore((s) => s.deleteClawChannel)
  const activePaperView = useWriteWorkspaceStore((s) => activePaperViewId(s.editorLayout))
  const {
    filter,
    counts,
    tags,
    groups,
    setFilter,
    setImportDialogOpen
  } = usePaperModeStore(
    useShallow((s) => ({
      filter: s.filter,
      counts: s.counts,
      tags: s.tags,
      groups: s.groups,
      setFilter: s.setFilter,
      setImportDialogOpen: s.setImportDialogOpen
    }))
  )

  const statusCounts: Record<string, number> = {
    all: counts.total,
    unread: counts.unread,
    reading: counts.reading,
    read: counts.read
  }
  const activeChip = filter.recent
    ? 'recent'
    : filter.status === ''
      ? 'all'
      : filter.status

  const applyFilter = (patch: Parameters<typeof setFilter>[0]): void => {
    setFilter(patch)
    openPaperViewTab('library')
  }

  return (
    <SidebarFrame
      title={t('appName')}
      footer={
        <div className="space-y-1">
          <SidebarFocusModeControl
            enabled={focusModeEnabled}
            onChange={onFocusModeChange}
          />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarCommandRow
                icon={<Settings className="h-4 w-4" strokeWidth={1.75} />}
                label={t('settings')}
                onClick={() => onOpenSettings('write')}
                variant="footer"
              />
            </div>
            <SidebarIconButton
              title={t('claw')}
              ariaLabel={t('claw')}
              onClick={onToggleConnectPhone}
              active={connectPhoneSidebarOpen}
            >
              <Smartphone className="h-4 w-4" strokeWidth={1.75} />
            </SidebarIconButton>
          </div>
        </div>
      }
    >
      <div className="workspace-mode-controls ds-no-drag flex flex-col px-0.5">
        <WorkspaceModeTabs
          activeView={activeView}
          onCodeOpen={onCodeOpen}
          onWriteOpen={onWriteOpen}
        />
        <PaperModeToggle />
        <SidebarCommandRow
          icon={<Import className="h-4 w-4" strokeWidth={1.9} />}
          label={t('writePaperImport')}
          onClick={() => setImportDialogOpen(true)}
          variant="accent"
        />
      </div>

      <div className="ds-no-drag mx-1.5 my-3" />

      {connectPhoneSidebarOpen ? (
        <ConnectPhoneSidebarPanel
          channels={clawChannels}
          onAddProvider={async (provider, agentProfile, platformCredential, options) => {
            await addClawChannel(provider, agentProfile, platformCredential, options)
            onToggleConnectPhone()
          }}
          onDisconnect={(channelId) => deleteClawChannel(channelId)}
          onOpenSettings={() => onOpenSettings('claw')}
        />
      ) : (
        <div className="ds-no-drag flex min-h-0 flex-1 flex-col">
          <PaperLibrarySwitcher />

          <div className="px-1 pt-2">
            <SidebarSearchField
              value={filter.query}
              placeholder={t('writePaperSearchPlaceholder')}
              clearLabel={t('clearSearch')}
              onChange={(query) => applyFilter({ query })}
            />
          </div>

          <div className="flex flex-wrap gap-1 px-2 pt-2" role="group" aria-label={t('writePaperFilterStatus')}>
            {STATUS_CHIPS.map(({ key, labelKey }) => {
              const active = activeChip === key
              const count = statusCounts[key]
              return (
                <button
                  key={key}
                  type="button"
                  data-cursor-spotlight-target
                  onClick={() => applyFilter(
                    key === 'recent'
                      ? { recent: true, status: '' }
                      : key === 'all'
                        ? { recent: false, status: '' }
                        : { recent: false, status: key }
                  )}
                  className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11.5px] transition ${
                    active
                      ? 'border-accent/40 bg-accent/10 font-medium text-accent'
                      : 'border-ds-border-muted bg-transparent text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                  }`}
                >
                  {t(labelKey)}
                  {typeof count === 'number' ? (
                    <span className="text-[10.5px] text-ds-faint">{count}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {tags.length > 0 || groups.length > 0 ? (
            <div className="flex flex-col gap-1.5 px-2 pt-2">
              {tags.length > 0 ? (
                <select
                  value={filter.tag}
                  onChange={(event) => applyFilter({ tag: event.target.value })}
                  className="h-8 w-full rounded-lg border border-ds-border-muted bg-transparent px-2 text-[12px] text-ds-ink outline-none focus:border-accent/55"
                  aria-label={t('writePaperFilterTag')}
                >
                  <option value="">{t('writePaperFilterTagAll')}</option>
                  {tags.map((tag) => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
              ) : null}
              {groups.length > 0 ? (
                <select
                  value={filter.group}
                  onChange={(event) => applyFilter({ group: event.target.value })}
                  className="h-8 w-full rounded-lg border border-ds-border-muted bg-transparent px-2 text-[12px] text-ds-ink outline-none focus:border-accent/55"
                  aria-label={t('writePaperFilterGroup')}
                >
                  <option value="">{t('writePaperFilterGroupAll')}</option>
                  {groups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              ) : null}
            </div>
          ) : null}

          <div className="pt-1">
            <SidebarCommandRow
              icon={<LibraryBig className="h-4 w-4" strokeWidth={1.9} />}
              label={t('writePaperModeLibraryView')}
              onClick={() => openPaperViewTab('library')}
              active={activePaperView === 'library'}
            />
            <SidebarCommandRow
              icon={<Compass className="h-4 w-4" strokeWidth={1.9} />}
              label={t('writePaperModeDiscover')}
              onClick={() => openPaperViewTab('discover:arxiv')}
              active={activePaperView?.startsWith('discover:') ?? false}
            />
          </div>

          <SidebarSectionHeader label={t('writePaperModePapers')} />
          <PaperTree />
          <PaperInfoPanel />
        </div>
      )}
    </SidebarFrame>
  )
}
