import type { ReactElement } from 'react'
import { ChevronRight, Plus } from 'lucide-react'
import {
  AgentCatalogToolbar,
  CategoryBatchControls,
  ExtensionAgentsControl,
  agentCategoryLabel,
  categoryConfigurationSummary
} from './SubagentCatalogControls'
import {
  AgentCategorySection,
  CatalogAgentRow,
  EmptyCatalogState
} from './SubagentCatalogViews'
import { ModelSelect, ReasoningEffortPicker, Row, RowActions } from './SubagentProfileControls'
import { ProfileDialog } from './SubagentProfileDialog'
import {
  newProfile,
  normalizeStoredReasoning,
  resolveReasoningOptions,
  type AgentCategory,
  type CatalogAgent
} from './subagent-settings-support'

type Context = Record<string, any>

/** The roles tab of the right-panel subagent editor (the Settings page uses its own layout). */
export function SubagentPanelContent({ context }: { context: Context }): ReactElement {
  const {
    className, t, tSettings, subagents, patchSubagents,
    dialog, setDialog, catalogQuery, setCatalogQuery,
    categoryFilter, catalogAgents, selectCategory, categoryCounts, groupedCatalogAgents,
    normalizedQuery, collapsedCategories, toggleCategory, composerModelGroups, setCategoryModels,
    setCategoryReasoning, resetCategoryConfiguration, selectedCatalogAgent, selectCatalogAgent,
    filteredCatalogAgents, setProfileModel, setProfileReasoning, toggleEnabled, removeProfile,
    compactionSlot, persistCompactionSlot, codeReviewSlot, codeReviewReasoning, persistRoleSlot,
    persistRoleReasoning, titleSlot, titleReasoning, summarySlot, summaryReasoning,
    smallModel, saveDialog, isBuiltin, extensionAgentsStatus, enabledExtensionAgentCount,
    setExtensionAgentsEnabled, panelSurface, configuredCount, extensionAgentIds, systemRolesOpen,
    setSystemRolesOpen
  } = context
  return (
    <div className={`ds-no-drag flex h-full min-h-0 flex-col overflow-hidden bg-ds-sidebar ${className ?? ''}`}>
      <div className="shrink-0 border-b border-ds-border-muted px-3 py-3">
        <div
          role="radiogroup"
          aria-label={tSettings('subagentsUseExistingAgents')}
          className="mb-2 grid grid-cols-2 gap-2"
          data-testid="subagent-delegation-mode-control"
        >
          {[
            { value: true, title: t('subagentsPanel.mode.library', 'Pick from roles'), desc: t('subagentsPanel.mode.libraryDesc', 'Use the configured roles and models below') },
            { value: false, title: t('subagentsPanel.mode.adhoc', 'Define on the fly'), desc: t('subagentsPanel.mode.adhocDesc', 'The main agent writes a one-off role per task') }
          ].map((mode) => {
            const active = (subagents.useExistingAgents !== false) === mode.value
            return (
              <button
                key={String(mode.value)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => patchSubagents({ useExistingAgents: mode.value })}
                className={`flex flex-col gap-0.5 rounded-[11px] border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                  active ? 'border-accent bg-accent-soft' : 'border-ds-border bg-ds-card hover:bg-ds-hover/50'
                }`}
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ds-ink">
                  <span className={`h-3 w-3 shrink-0 rounded-full border ${active ? 'border-[3.5px] border-accent' : 'border-ds-border'}`} aria-hidden="true" />
                  {mode.title}
                </span>
                <span className="text-[11px] leading-[1.45] text-ds-muted">{mode.desc}</span>
              </button>
            )
          })}
        </div>
        <ExtensionAgentsControl
          status={extensionAgentsStatus}
          enabledCount={enabledExtensionAgentCount}
          count={extensionAgentIds.size}
          onToggle={setExtensionAgentsEnabled}
          t={t}
        />
        <div className="mb-2.5 flex items-center justify-between gap-3">
          <span className="text-[12px] font-semibold text-ds-ink">
            {t('subagentsPanel.delegatableCount', '{{count}} delegatable roles', { count: catalogAgents.length })}
          </span>
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-semibold text-accent">
            {t('subagentsPanel.configuredCount', '{{count}} configured', { count: configuredCount })}
          </span>
        </div>
        <AgentCatalogToolbar
          query={catalogQuery}
          onQueryChange={setCatalogQuery}
          selectedCategory={categoryFilter}
          onCategoryChange={selectCategory}
          counts={categoryCounts}
          total={catalogAgents.length}
          t={t}
          compact
        />
      </div>

      <div className="h-0 min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto overflow-x-hidden px-2 py-2 [scrollbar-gutter:stable]">
        {groupedCatalogAgents.length > 0 ? groupedCatalogAgents.map(({ category, agents }: { category: AgentCategory; agents: CatalogAgent[] }) => {
          const expanded = normalizedQuery.length > 0
            || categoryFilter !== 'all'
            || !collapsedCategories.has(category)
          const categoryLabel = agentCategoryLabel(t, category)
          return (
            <AgentCategorySection
              key={category}
              category={category}
              count={agents.length}
              expanded={expanded}
              onToggle={() => toggleCategory(category)}
              t={t}
              compact
              summary={categoryConfigurationSummary(agents, t)}
              configuration={(
                <CategoryBatchControls
                  agents={agents}
                  groups={composerModelGroups}
                  categoryLabel={categoryLabel}
                  onModelsChange={setCategoryModels}
                  onReasoningChange={setCategoryReasoning}
                  onReset={resetCategoryConfiguration}
                  t={t}
                />
              )}
            >
              <div className="space-y-1">
                {agents.map((agent: CatalogAgent) => {
                  const selected = selectedCatalogAgent?.profile.id === agent.profile.id
                  const workspaceLocked = agent.source === 'workspace'
                  return (
                    <CatalogAgentRow
                      key={agent.profile.id}
                      agent={agent}
                      selected={selected}
                      variant="panel"
                      onSelect={() => selectCatalogAgent(agent)}
                      t={t}
                    >
                      {selected ? (
                        <div className="space-y-2 border-t border-ds-border-muted px-3 py-2.5">
                          {workspaceLocked ? (
                            <div className="rounded-lg border border-ds-border-muted bg-ds-card-muted px-2.5 py-2 text-[10.5px] leading-4 text-ds-muted">
                              {t('subagentsPanel.workspaceReadOnly', 'Edit this role in .kun/agents/*.md')}
                              {agent.filePath ? (
                                <div className="mt-1 truncate text-[9.5px] text-ds-faint" title={agent.filePath}>
                                  {agent.filePath}
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <ModelSelect
                                  value={agent.profile.model ?? ''}
                                  providerId={agent.profile.providerId ?? ''}
                                  groups={composerModelGroups}
                                  stretch
                                  onChange={(model, providerId) => setProfileModel(agent.profile.id, model, providerId)}
                                />
                                <RowActions
                                  enabled={agent.profile.enabled}
                                  builtin={agent.builtin}
                                  t={t}
                                  onToggle={() => toggleEnabled(agent.profile.id)}
                                  onEdit={() => setDialog({ profile: { ...agent.profile }, isNew: false })}
                                  onDelete={() => void removeProfile(agent.profile.id)}
                                />
                              </div>
                              <ReasoningEffortPicker
                                value={normalizeStoredReasoning(agent.profile.reasoningEffort)}
                                options={resolveReasoningOptions(
                                  composerModelGroups,
                                  agent.profile.model ?? '',
                                  agent.profile.providerId ?? ''
                                )}
                                onChange={(effort) => setProfileReasoning(agent.profile.id, effort)}
                              />
                            </>
                          )}
                        </div>
                      ) : null}
                    </CatalogAgentRow>
                  )
                })}
              </div>
            </AgentCategorySection>
          )
        }) : (
          <EmptyCatalogState query={catalogQuery} t={t} />
        )}

        <div className="mt-2 border-t border-ds-border-muted pt-2">
          <button
            type="button"
            aria-expanded={systemRolesOpen}
            onClick={() => setSystemRolesOpen((open: boolean) => !open)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
          >
            <ChevronRight className={`h-3.5 w-3.5 transition ${systemRolesOpen ? 'rotate-90' : ''}`} />
            <span>{t('subagentsPanel.system', 'System · internal')}</span>
            <span className="ml-auto rounded-full bg-ds-card-muted px-1.5 py-0.5 text-[9.5px]">5</span>
          </button>
          {systemRolesOpen ? (
            <div className="mt-1 space-y-0.5">
              <Row
                roleId="compaction"
                name={t('subagentsPanel.role.compaction.name', 'Compaction')}
                desc={t('subagentsPanel.role.compaction.desc', 'Configurable · defaults to main model')}
              >
                <ModelSelect
                  value={compactionSlot.model}
                  providerId={compactionSlot.providerId}
                  groups={composerModelGroups}
                  small
                  onChange={(m, pid) => void persistCompactionSlot(m, pid)}
                />
              </Row>
              <Row
                roleId="code-review"
                name={t('subagentsPanel.role.codeReview.name', 'Code review')}
                desc={t('subagentsPanel.role.codeReview.desc', 'Isolated read-only run · configurable')}
              >
                <div className="flex min-w-0 flex-col items-end gap-1">
                  <ModelSelect
                    value={codeReviewSlot.model}
                    providerId={codeReviewSlot.providerId}
                    groups={composerModelGroups}
                    onChange={(m, pid) => persistRoleSlot('codeReviewModel', 'codeReviewProviderId', m, pid)}
                  />
                  <ReasoningEffortPicker
                    value={normalizeStoredReasoning(codeReviewReasoning)}
                    options={resolveReasoningOptions(
                      composerModelGroups,
                      codeReviewSlot.model,
                      codeReviewSlot.providerId
                    )}
                    compact
                    onChange={(effort) => persistRoleReasoning('codeReviewReasoningEffort', effort)}
                  />
                </div>
              </Row>
              <Row
                roleId="title"
                name={t('subagentsPanel.role.title.name', 'Title')}
                desc={t('subagentsPanel.role.title.desc', 'LLM · defaults to small model')}
              >
                <div className="flex min-w-0 flex-col items-end gap-1">
                  <ModelSelect
                    value={titleSlot.model}
                    providerId={titleSlot.providerId}
                    groups={composerModelGroups}
                    small
                    onChange={(m, pid) => persistRoleSlot('titleModel', 'titleProviderId', m, pid)}
                  />
                  <ReasoningEffortPicker
                    value={normalizeStoredReasoning(titleReasoning)}
                    options={resolveReasoningOptions(
                      composerModelGroups,
                      titleSlot.model,
                      titleSlot.providerId
                    )}
                    compact
                    onChange={(effort) => persistRoleReasoning('titleReasoningEffort', effort)}
                  />
                </div>
              </Row>
              <Row
                roleId="summary"
                name={t('subagentsPanel.role.summary.name', 'Summary')}
                desc={t('subagentsPanel.role.summary.desc', 'LLM · defaults to small model')}
              >
                <div className="flex min-w-0 flex-col items-end gap-1">
                  <ModelSelect
                    value={summarySlot.model}
                    providerId={summarySlot.providerId}
                    groups={composerModelGroups}
                    small
                    onChange={(m, pid) => persistRoleSlot('summaryModel', 'summaryProviderId', m, pid)}
                  />
                  <ReasoningEffortPicker
                    value={normalizeStoredReasoning(summaryReasoning)}
                    options={resolveReasoningOptions(
                      composerModelGroups,
                      summarySlot.model,
                      summarySlot.providerId
                    )}
                    compact
                    onChange={(effort) => persistRoleReasoning('summaryReasoningEffort', effort)}
                  />
                </div>
              </Row>
              <Row
                roleId="small-model"
                name={t('subagentsPanel.smallModel.name', 'Small model')}
                desc={t('subagentsPanel.smallModel.desc', 'Default for Title & Summary')}
              >
                <ModelSelect
                  value={smallModel.model}
                  providerId={smallModel.providerId}
                  groups={composerModelGroups}
                  small
                  onChange={(m, pid) => persistRoleSlot('smallModel', 'smallModelProviderId', m, pid)}
                />
              </Row>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-ds-border px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-ds-faint">
          {t('subagentsPanel.showingCount', 'Showing {{visible}} of {{total}}', {
            visible: filteredCatalogAgents.length,
            total: catalogAgents.length
          })}
        </span>
        <button data-settings-action="primary" data-settings-size="default"
          type="button"
          onClick={() => setDialog({ profile: newProfile(panelSurface), isNew: true })}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[9px] bg-accent px-3 py-2 text-[11.5px] font-semibold text-white transition hover:bg-accent/90"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
          {t('subagentsPanel.newSubagent', 'New subagent')}
        </button>
      </div>

      {dialog ? (
        <ProfileDialog
          profile={dialog.profile}
          isNew={dialog.isNew}
          builtin={isBuiltin(dialog.profile.id)}
          groups={composerModelGroups}
          onSave={saveDialog}
          onCancel={() => setDialog(null)}
        />
      ) : null}
    </div>
  )
}
