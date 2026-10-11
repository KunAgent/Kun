import { settingsButtonClass } from './settings-button'
import { WRITE_AGENT_PRESET_MAX_COUNT, type WriteAgentPresetV1 } from '@shared/app-settings'
import { PencilLine, Plus, Trash2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { SettingRow, SettingsCard, SettingsTabPanel } from './settings-controls'

const textInputClass =
  'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'

export function WriteAgentPresetsSettingsPanel({ view }: { view: Record<string, any> }): ReactElement {
  const { t, agentPresets, updateAgentPresets, setWriteDebugModalOpen, loadWriteDebugEntries, activeTab } = view
  return (
    <>
              <SettingsTabPanel baseId="write-settings" tabId="agents" active={activeTab === 'agents'}>
              <SettingsCard
                title={t('writeAgentPresets')}
                description={t('writeAgentPresetsDesc')}
                className="mt-5"
                collapsible
              >
                <div className="px-3 py-4">
                  <p className="text-[12.5px] leading-5 text-ds-faint">
                    {t('writeAgentPresetsDesc')}
                  </p>
                  {agentPresets.length > 0 ? (
                    <div className="mt-3 flex flex-col gap-3">
                      {agentPresets.map((preset: WriteAgentPresetV1, index: number) => {
                        return (
                          <div
                            key={preset.id}
                            className="rounded-xl border border-ds-border-muted bg-ds-card/70 p-3"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                className={`${textInputClass} max-w-[56px] text-center`}
                                value={preset.emoji}
                                placeholder="🤖"
                                spellCheck={false}
                                onChange={(e) => {
                                  const next = [...agentPresets]
                                  next[index] = { ...preset, emoji: e.target.value }
                                  updateAgentPresets(next)
                                }}
                              />
                              <input
                                className={`${textInputClass} max-w-[220px]`}
                                value={preset.name}
                                placeholder={t('writeAgentPresetNamePlaceholder')}
                                spellCheck={false}
                                onChange={(e) => {
                                  const next = [...agentPresets]
                                  next[index] = { ...preset, name: e.target.value }
                                  updateAgentPresets(next)
                                }}
                              />
                              <button
                                type="button"
                                  className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon', className: 'ml-auto shrink-0' })}
                                title={t('writeAgentPresetRemove')}
                                aria-label={t('writeAgentPresetRemove')}
                                onClick={() =>
                                  updateAgentPresets(
                                    agentPresets.filter((item: WriteAgentPresetV1) => item.id !== preset.id)
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                              </button>
                            </div>
                            <textarea
                              className={`${textInputClass} mt-2 min-h-[84px] resize-y leading-5`}
                              value={preset.persona}
                              placeholder={t('writeAgentPersonaPlaceholder')}
                              spellCheck={false}
                              onChange={(e) => {
                                const next = [...agentPresets]
                                next[index] = { ...preset, persona: e.target.value }
                                updateAgentPresets(next)
                              }}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button className={settingsButtonClass()}
                      type="button"
                      disabled={agentPresets.length >= WRITE_AGENT_PRESET_MAX_COUNT}
                      onClick={() =>
                        updateAgentPresets([
                          ...agentPresets,
                          { id: `custom-${Date.now().toString(36)}`, name: '', emoji: '🤖', persona: '' }
                        ])
                      }
                    >
                      <Plus className="h-4 w-4" strokeWidth={2} />
                      {t('writeAgentPresetAdd')}
                    </button>
                  </div>
                </div>
              </SettingsCard>

              <SettingsCard title={t('writeDebugLogTitle')} className="mt-5">
                <SettingRow
                  title={t('writeDebugLogOpen')}
                  description={t('writeDebugLogDesc')}
                  control={
                    <button className={settingsButtonClass()}
                      type="button"
                      onClick={() => {
                        setWriteDebugModalOpen(true)
                        void loadWriteDebugEntries()
                      }}
                    >
                      <PencilLine className="h-4 w-4" strokeWidth={1.75} />
                      {t('writeDebugLogOpenButton')}
                    </button>
                  }
                />
              </SettingsCard>
              </SettingsTabPanel>
    </>
  )
}
