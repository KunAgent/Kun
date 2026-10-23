import type { ReactElement } from 'react'
import { Bot, ChevronRight, Plus, Sparkles, Wrench } from 'lucide-react'
import { SettingsSubTabs, SettingsTabPanel, Toggle } from '../settings-controls'
import {
  AgentCatalogToolbar,
  CategoryBatchControls,
  CatalogPagination,
  CompactPolicySetting,
  EditorSettingsCard,
  ExtensionAgentsControl,
  SurfaceTabs,
  agentCategoryLabel,
  categoryConfigurationSummary
} from './SubagentCatalogControls'
import {
  AgentCategorySection,
  AgentDetailsPanel,
  BoundedNumberInput,
  CatalogAgentRow,
  EmptyCatalogState
} from './SubagentCatalogViews'
import { ModelSelect, ReasoningEffortPicker, Row, RowActions, SubagentPanelHeader } from './SubagentProfileControls'
import { ProfileDialog } from './SubagentProfileDialog'
import { SubagentPanelContent } from './SubagentPanelContent'
import { SubagentRetryPolicyControls } from './SubagentRetryPolicyControls'
import {
  newProfile,
  normalizeStoredReasoning,
  resolveReasoningOptions,
  type AgentCategory,
  type CatalogAgent,
  type SubagentSettingsTab
} from './subagent-settings-support'

type Context = Record<string, any>

export function SubagentSettingsContent({ context }: { context: Context }): ReactElement {
  const {
    variant, className, t, tSettings, settingsTab, setSettingsTab, subagents, patchSubagents,
    dialog, setDialog, selectedSurface, setSelectedSurface, catalogQuery, setCatalogQuery,
    categoryFilter, catalogAgents, selectCategory, categoryCounts, groupedCatalogAgents,
    normalizedQuery, collapsedCategories, toggleCategory, composerModelGroups, setCategoryModels,
    setCategoryReasoning, resetCategoryConfiguration, selectedCatalogAgent, selectCatalogAgent,
    filteredCatalogAgents, catalogPage, pageCount, setCatalogPage, setProfileModel,
    setProfileReasoning, toggleSurface, toggleEnabled, removeProfile, compactionSlot,
    persistCompactionSlot, codeReviewSlot, codeReviewReasoning, persistRoleSlot,
    persistRoleReasoning, planSlot, titleSlot, titleReasoning, summarySlot, summaryReasoning,
    smallModel, saveDialog, isBuiltin, extensionAgentsStatus, enabledExtensionAgentCount,
    setExtensionAgentsEnabled, delegatable, panelSurface, configuredCount, extensionAgentIds, systemRolesOpen,
    setSystemRolesOpen
  } = context
  if (variant === 'settings') {
    return (
      <div className={`space-y-5 ${className ?? ''}`} data-testid="subagent-settings-editor">
        <div className="rounded-2xl border border-accent/20 bg-accent-soft/55 px-5 py-3 text-[13px] leading-6 text-ds-muted">
          {tSettings('subagentsSettingsIntro')}
        </div>

        <SettingsSubTabs<SubagentSettingsTab>
          baseId="subagent-settings"
          ariaLabel={tSettings('subagents')}
          items={[
            { id: 'policy', label: tSettings('subagentsRuntimePolicy'), icon: Wrench },
            { id: 'profiles', label: tSettings('subagentsDelegatable'), icon: Bot },
            { id: 'automatic', label: tSettings('subagentsAutomaticRoles'), icon: Sparkles }
          ]}
          value={settingsTab}
          onChange={setSettingsTab}
        />

        <SettingsTabPanel
          baseId="subagent-settings"
          tabId="policy"
          active={settingsTab === 'policy'}
        >
          <section className="overflow-hidden rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25">
          <div className="flex flex-col gap-1 border-b border-ds-border-muted px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ds-ink">{tSettings('subagentsRuntimePolicy')}</h2>
              <p className="mt-0.5 text-[12px] text-ds-muted">{tSettings('subagentsRuntimePolicyDesc')}</p>
            </div>
            <span className="mt-2 inline-flex w-fit rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent sm:mt-0">
              {t('subagentsPanel.policySummary', 'Queue and concurrency')}
            </span>
          </div>
          <div className="grid gap-px bg-ds-border-muted sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CompactPolicySetting
                title={tSettings('subagentsUseExistingAgents')}
                description={tSettings('subagentsUseExistingAgentsDesc')}
              >
                <Toggle
                  checked={subagents.useExistingAgents !== false}
                  onChange={(useExistingAgents) => patchSubagents({ useExistingAgents })}
                  ariaLabel={tSettings('subagentsUseExistingAgents')}
                />
              </CompactPolicySetting>
            </div>
            <div className="sm:col-span-2">
              <CompactPolicySetting
                title={tSettings('subagentsHonorEngineBinding')}
                description={tSettings('subagentsHonorEngineBindingDesc')}
              >
                <Toggle
                  checked={subagents.honorEngineBinding !== false}
                  onChange={(honorEngineBinding) => patchSubagents({ honorEngineBinding })}
                  ariaLabel={tSettings('subagentsHonorEngineBinding')}
                />
              </CompactPolicySetting>
            </div>
            <div className="sm:col-span-2">
              <CompactPolicySetting
                title={tSettings('subagentsMaxParallel')}
                description={tSettings('subagentsMaxParallelDesc')}
              >
                <BoundedNumberInput
                  ariaLabel={tSettings('subagentsMaxParallel')}
                  value={subagents.maxParallel ?? 256}
                  min={1}
                  max={256}
                  onCommit={(maxParallel) => patchSubagents({ maxParallel })}
                />
              </CompactPolicySetting>
            </div>
            <SubagentRetryPolicyControls
              subagents={subagents}
              patchSubagents={patchSubagents}
              tSettings={tSettings}
            />
          </div>
          </section>
        </SettingsTabPanel>

        <SettingsTabPanel
          baseId="subagent-settings"
          tabId="profiles"
          active={settingsTab === 'profiles'}
        >
          <section className="min-w-0 overflow-visible rounded-2xl border border-ds-border bg-ds-card/95 shadow-sm shadow-black/5 dark:shadow-black/25">
          <div className="flex flex-col gap-3 border-b border-ds-border-muted px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[16px] font-semibold text-ds-ink">{tSettings('subagentsDelegatable')}</h2>
                <span className="rounded-full bg-ds-card-muted px-2 py-0.5 text-[10.5px] font-semibold text-ds-muted">
                  {t('subagentsPanel.delegatableCount', '{{count}} delegatable roles', { count: catalogAgents.length })}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-ds-muted">{tSettings('subagentsDelegatableDesc')}</p>
            </div>
            <button data-settings-action="primary" data-settings-size="default"
              type="button"
              onClick={() => setDialog({ profile: newProfile(selectedSurface), isNew: true })}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-accent/90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
              {t('subagentsPanel.newSubagent', 'New subagent')}
            </button>
          </div>

          <div data-testid="settings-subagent-catalog-toolbar" className="border-b border-ds-border-muted bg-ds-main/95 px-4 py-3">
            <SurfaceTabs value={selectedSurface} onChange={setSelectedSurface} t={t} />
            <AgentCatalogToolbar
              query={catalogQuery}
              onQueryChange={setCatalogQuery}
              selectedCategory={categoryFilter}
              onCategoryChange={selectCategory}
              counts={categoryCounts}
              total={catalogAgents.length}
              t={t}
            />
          </div>

          <div className="grid min-h-[360px] lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="min-w-0 border-b border-ds-border-muted px-4 py-3 lg:border-b-0 lg:border-r">
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
                    <div className="grid gap-2 sm:grid-cols-2">
                      {agents.map((agent: CatalogAgent) => (
                        <CatalogAgentRow
                          key={agent.profile.id}
                          agent={agent}
                          selected={selectedCatalogAgent?.profile.id === agent.profile.id}
                          variant="settings"
                          onSelect={() => selectCatalogAgent(agent)}
                          t={t}
                        />
                      ))}
                    </div>
                  </AgentCategorySection>
                )
              }) : (
                <EmptyCatalogState query={catalogQuery} t={t} />
              )}
              {filteredCatalogAgents.length > 0 ? (
                <CatalogPagination
                  page={catalogPage}
                  pageCount={pageCount}
                  total={filteredCatalogAgents.length}
                  onPageChange={setCatalogPage}
                  t={t}
                />
              ) : null}
            </div>

            <div className="min-w-0 bg-ds-main/30 p-4">
              {selectedCatalogAgent ? (
                <AgentDetailsPanel
                  agent={selectedCatalogAgent}
                  groups={composerModelGroups}
                  onModelChange={(model, providerId) =>
                    setProfileModel(selectedCatalogAgent.profile.id, model, providerId)}
                  onReasoningChange={(effort) => setProfileReasoning(selectedCatalogAgent.profile.id, effort)}
                  selectedSurface={selectedSurface}
                  onToggleSurface={() => toggleSurface(selectedCatalogAgent.profile.id, selectedSurface)}
                  onToggle={() => toggleEnabled(selectedCatalogAgent.profile.id)}
                  onEdit={() => setDialog({ profile: { ...selectedCatalogAgent.profile }, isNew: false })}
                  onDelete={() => void removeProfile(selectedCatalogAgent.profile.id)}
                  t={t}
                />
              ) : (
                <EmptyCatalogState query={catalogQuery} t={t} compact />
              )}
            </div>
          </div>
          </section>
        </SettingsTabPanel>

        <SettingsTabPanel
          baseId="subagent-settings"
          tabId="automatic"
          active={settingsTab === 'automatic'}
        >
          <EditorSettingsCard
            title={tSettings('subagentsAutomaticRoles')}
            description={tSettings('subagentsAutomaticRolesDesc')}
          >
          <Row
            variant="settings"
            roleId="compaction"
            name={t('subagentsPanel.role.compaction.name', 'Compaction')}
            desc={t('subagentsPanel.role.compaction.desc', 'Configurable · defaults to main model')}
          >
            <ModelSelect
              value={compactionSlot.model}
              providerId={compactionSlot.providerId}
              groups={composerModelGroups}
              small
              stretch
              onChange={persistCompactionSlot}
            />
          </Row>
          <Row
            variant="settings"
            roleId="code-review"
            name={t('subagentsPanel.role.codeReview.name', 'Code review')}
            desc={t('subagentsPanel.role.codeReview.desc', 'Isolated read-only run · configurable')}
          >
            <div className="flex w-full min-w-0 flex-col gap-1.5">
              <ModelSelect
                value={codeReviewSlot.model}
                providerId={codeReviewSlot.providerId}
                groups={composerModelGroups}
                stretch
                onChange={(model, providerId) =>
                  persistRoleSlot('codeReviewModel', 'codeReviewProviderId', model, providerId)}
              />
              <ReasoningEffortPicker
                value={normalizeStoredReasoning(codeReviewReasoning)}
                options={resolveReasoningOptions(
                  composerModelGroups,
                  codeReviewSlot.model,
                  codeReviewSlot.providerId
                )}
                onChange={(effort) => persistRoleReasoning('codeReviewReasoningEffort', effort)}
              />
            </div>
          </Row>
          <Row
            variant="settings"
            roleId="plan"
            name={t('subagentsPanel.role.plan.name', 'Plan mode')}
            desc={t('subagentsPanel.role.plan.desc', 'Used for planning turns; empty follows the conversation model')}
          >
            <ModelSelect
              value={planSlot.model}
              providerId={planSlot.providerId}
              groups={composerModelGroups}
              stretch
              onChange={(model, providerId) => persistRoleSlot('planModel', 'planProviderId', model, providerId)}
            />
          </Row>
          <Row
            variant="settings"
            roleId="title"
            name={t('subagentsPanel.role.title.name', 'Title')}
            desc={t('subagentsPanel.role.title.desc', 'LLM · defaults to small model')}
          >
            <div className="flex w-full min-w-0 flex-col gap-1.5">
              <ModelSelect
                value={titleSlot.model}
                providerId={titleSlot.providerId}
                groups={composerModelGroups}
                small
                stretch
                onChange={(model, providerId) => persistRoleSlot('titleModel', 'titleProviderId', model, providerId)}
              />
              <ReasoningEffortPicker
                value={normalizeStoredReasoning(titleReasoning)}
                options={resolveReasoningOptions(
                  composerModelGroups,
                  titleSlot.model,
                  titleSlot.providerId
                )}
                onChange={(effort) => persistRoleReasoning('titleReasoningEffort', effort)}
              />
            </div>
          </Row>
          <Row
            variant="settings"
            roleId="summary"
            name={t('subagentsPanel.role.summary.name', 'Summary')}
            desc={t('subagentsPanel.role.summary.desc', 'LLM · defaults to small model')}
          >
            <div className="flex w-full min-w-0 flex-col gap-1.5">
              <ModelSelect
                value={summarySlot.model}
                providerId={summarySlot.providerId}
                groups={composerModelGroups}
                small
                stretch
                onChange={(model, providerId) => persistRoleSlot('summaryModel', 'summaryProviderId', model, providerId)}
              />
              <ReasoningEffortPicker
                value={normalizeStoredReasoning(summaryReasoning)}
                options={resolveReasoningOptions(
                  composerModelGroups,
                  summarySlot.model,
                  summarySlot.providerId
                )}
                onChange={(effort) => persistRoleReasoning('summaryReasoningEffort', effort)}
              />
            </div>
          </Row>
          <Row
            variant="settings"
            roleId="small-model"
            name={t('subagentsPanel.smallModel.name', 'Small model')}
            desc={t('subagentsPanel.smallModel.desc', 'Default for Title & Summary')}
          >
            <ModelSelect
              value={smallModel.model}
              providerId={smallModel.providerId}
              groups={composerModelGroups}
              small
              stretch
              onChange={(model, providerId) => persistRoleSlot('smallModel', 'smallModelProviderId', model, providerId)}
            />
          </Row>
          </EditorSettingsCard>
        </SettingsTabPanel>

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

  return <SubagentPanelContent context={context} />
}
