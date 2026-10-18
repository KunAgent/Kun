import { safeError } from '../chat-format.js'
import type { TuiControllerState } from '../controller.js'
import type { TuiPage } from '../page-model.js'
import { CommandPalettePage, AgentModePage, GoalPage, VariantPage } from '../pages/command-pages.js'
import { ConnectPage } from '../pages/connect-page.js'
import { GraphBoardPage } from '../pages/graph-page.js'
import { ModelPage } from '../pages/model-page.js'
import { ApprovalPage, SkillsPage, TimelinePage, UserInputPage } from '../pages/runtime-pages.js'
import { HelpPage, InspectionPage, PermissionPage, SessionsPage } from '../pages/session-pages.js'
import { SubagentPage } from '../pages/subagent-page.js'
import { TranscriptPage } from '../pages/transcript-page.js'
import { ProviderQuotaPage } from '../provider-quota.js'
import type { ProjectedChildRun } from '../state.js'
import { UsagePage } from '../usage-report.js'
import { createUserInputSession } from '../user-input.js'
import type { TuiCommandDefinition } from '../commands.js'
import type { OfficialProviderCliId } from '../../services/official-provider-cli.js'
import { ChatSessionBase } from './chat-session-base.js'

type SyncedPages = {
  sessions?: SessionsPage
  help?: HelpPage
  approval?: { id: string; page: ApprovalPage }
  input?: { id: string; page: UserInputPage }
  inspection?: { value: TuiControllerState['inspection']; page: InspectionPage }
  graph?: GraphBoardPage
}

export abstract class ChatSessionPages extends ChatSessionBase {
  protected readonly synced: SyncedPages = {}
  protected pendingGraphSelection?: { runId: string; nodeId: string }
  protected subagentPopupReturn?: () => void

  protected abstract executeSlash(name: string): Promise<void>
  protected abstract setComposerText(text: string): void
  protected abstract editExternal(initial: string): Promise<string>
  protected abstract authenticateOfficialProvider(provider: OfficialProviderCliId): Promise<void>
  protected abstract reloadSkillAutocomplete(): Promise<void>

  protected readonly invalidate = (): void => this.changed()

  protected pushPage(page: TuiPage, source: 'user' | 'sync' = 'user'): void {
    const index = this.pages.findIndex((entry) => entry.page === page)
    if (index >= 0) this.pages.splice(index, 1)
    this.pages.push({ page, source })
    this.cancelLeader()
    this.clearPendingGestures()
    this.autocompleteValue = undefined
    this.syncAnimation(this.controller.state)
    this.changed()
  }

  protected removePage(page: TuiPage | undefined): void {
    if (!page) return
    const index = this.pages.findIndex((entry) => entry.page === page)
    if (index < 0) return
    this.pages.splice(index, 1)
    page.dispose?.()
    this.changed()
  }

  protected findPage<T extends TuiPage>(kind: string): T | undefined {
    return this.pages.find((entry) => entry.page.kind === kind)?.page as T | undefined
  }

  protected closeUserPages(...kinds: string[]): void {
    for (const kind of kinds) this.removePage(this.findPage(kind))
  }

  protected override syncPages(state: TuiControllerState): void {
    if (state.view === 'threads') {
      if (!this.synced.sessions) {
        this.synced.sessions = new SessionsPage(this.controller, this.keymap, this.invalidate)
        this.pushPage(this.synced.sessions, 'sync')
        this.threadRefreshTimer = setInterval(() => {
          void this.controller.refreshThreads(this.controller.state.threadSearch)
        }, 2_000)
        this.threadRefreshTimer.unref?.()
      }
    } else if (this.synced.sessions) {
      this.removePage(this.synced.sessions)
      this.synced.sessions = undefined
      if (this.threadRefreshTimer) clearInterval(this.threadRefreshTimer)
      this.threadRefreshTimer = undefined
    }

    if (state.view === 'help') {
      if (!this.synced.help) {
        this.synced.help = new HelpPage(this.controller, this.keymap)
        this.pushPage(this.synced.help, 'sync')
      }
    } else if (this.synced.help) {
      this.removePage(this.synced.help)
      this.synced.help = undefined
    }

    const approval = state.projection?.pendingApproval
    if (approval) {
      if (this.synced.approval?.id !== approval.approvalId) {
        this.removePage(this.synced.approval?.page)
        const page = new ApprovalPage(this.controller, approval.toolName, approval.summary, this.invalidate)
        this.synced.approval = { id: approval.approvalId, page }
        this.pushPage(page, 'sync')
      }
    } else if (this.synced.approval) {
      this.removePage(this.synced.approval.page)
      this.synced.approval = undefined
    }

    const pendingInput = state.projection?.pendingUserInput
    if (pendingInput) {
      if (this.synced.input?.id !== pendingInput.inputId) {
        this.removePage(this.synced.input?.page)
        const page = new UserInputPage(this.controller, createUserInputSession(pendingInput), this.invalidate)
        this.synced.input = { id: pendingInput.inputId, page }
        this.pushPage(page, 'sync')
      }
    } else if (this.synced.input) {
      this.removePage(this.synced.input.page)
      this.synced.input = undefined
    }

    if (state.inspection && !approval && !pendingInput) {
      if (this.synced.inspection?.value !== state.inspection) {
        this.removePage(this.synced.inspection?.page)
        const page = new InspectionPage(this.controller, state.inspection.title, state.inspection.lines, this.invalidate)
        this.synced.inspection = { value: state.inspection, page }
        this.pushPage(page, 'sync')
      }
    } else if (this.synced.inspection) {
      this.removePage(this.synced.inspection.page)
      this.synced.inspection = undefined
    }

    this.syncGraphBoard(state)
  }

  protected syncGraphBoard(state: TuiControllerState): void {
    const target = state.graphBoard
    const mandatory = Boolean(state.projection?.pendingApproval || state.projection?.pendingUserInput)
    const popupOpen = Boolean(this.findPage('subagent-popup'))
    if (!target || mandatory || popupOpen) {
      this.closeGraphBoard(false, Boolean(target))
      return
    }
    const run = state.graphRuns.find((candidate) => candidate.id === target.runId)
    if (!run) {
      this.closeGraphBoard(false)
      return
    }
    if (this.synced.graph?.runId === run.id) return
    this.closeGraphBoard(false)
    const initialNodeId = this.pendingGraphSelection?.runId === run.id ? this.pendingGraphSelection.nodeId : undefined
    this.pendingGraphSelection = undefined
    const page = new GraphBoardPage({
      controller: this.controller,
      state,
      runId: run.id,
      ...(initialNodeId ? { initialNodeId } : {}),
      close: () => this.controller.dismissGraphBoard(),
      openWorker: (runId, nodeId, childThreadId) => this.openGraphWorker(runId, nodeId, childThreadId),
      invalidate: this.invalidate
    })
    this.synced.graph = page
    this.pushPage(page, 'sync')
  }

  protected closeGraphBoard(dismiss = false, preserveSelection = false): void {
    const page = this.synced.graph
    if (!page) {
      if (dismiss) this.controller.dismissGraphBoard()
      return
    }
    if (preserveSelection) this.pendingGraphSelection = { runId: page.runId, nodeId: page.selectedNodeId() }
    this.synced.graph = undefined
    this.removePage(page)
    if (dismiss) this.controller.dismissGraphBoard()
  }

  protected openGraphWorker(runId: string, nodeId: string, childThreadId: string): void {
    const child = this.controller.state.projection?.childRuns.find((candidate) => candidate.childId === childThreadId)
    if (!child) {
      this.controller.notify('This Graph worker session is not available yet.', 'error')
      return
    }
    this.pendingGraphSelection = { runId, nodeId }
    this.closeGraphBoard(false)
    this.controller.dismissGraphBoard()
    this.showSubagentPopup(child, () => {
      if (!this.controller.openGraphBoard(runId)) this.controller.notify('The parent GraphRun is no longer available.', 'error')
    })
  }

  showCommandPalette(): void {
    if (this.findPage('commands')) return
    const page: CommandPalettePage = new CommandPalettePage(this.keymap, (entry?: TuiCommandDefinition) => {
      this.removePage(page)
      if (!entry?.slash) return
      if (entry.argumentRequired) this.setComposerText(`/${entry.slash} `)
      else if (entry.id === 'graph') void this.executeSlash('graph status')
      else void this.executeSlash(entry.slash)
    }, this.invalidate)
    this.pushPage(page)
  }

  showVariants(): void {
    if (this.findPage('reasoning')) return
    const efforts = this.controller.reasoningOptions()
    if (!efforts.length) {
      this.controller.notify('The selected model does not expose reasoning variants.', 'error')
      return
    }
    const page: VariantPage = new VariantPage(this.controller, efforts, () => this.removePage(page), this.invalidate)
    this.pushPage(page)
  }

  showAgentModes(): void {
    if (this.findPage('mode')) return
    const page: AgentModePage = new AgentModePage(this.controller, () => this.removePage(page), () => {
      this.removePage(page)
      this.showGoal()
    }, this.invalidate)
    this.pushPage(page)
  }

  showGoal(): void {
    if (this.findPage('goal')) return
    const page: GoalPage = new GoalPage(this.controller, () => this.removePage(page), this.invalidate)
    this.pushPage(page)
  }

  showPermissions(): void {
    if (this.findPage('permissions')) return
    const thread = this.controller.state.projection?.thread
    if (!thread) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const page: PermissionPage = new PermissionPage(
      this.controller,
      thread.approvalPolicy,
      thread.sandboxMode,
      thread.approvalReviewer,
      () => this.removePage(page),
      this.invalidate
    )
    this.pushPage(page)
  }

  showTimeline(query?: string, target?: string): void {
    this.closeUserPages('timeline')
    const projection = this.controller.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const page: TimelinePage = new TimelinePage(this.controller, projection, query, target, () => this.removePage(page), this.invalidate)
    this.pushPage(page)
  }

  async showSkills(query?: string): Promise<void> {
    this.closeUserPages('skills')
    try {
      if (await this.controller.manageSkills(query, (initial) => this.editExternal(initial))) {
        await this.reloadSkillAutocomplete()
        return
      }
      const workspace = this.controller.state.projection?.thread.workspace ?? this.controller.options.workspace
      const snapshot = await this.controller.client.skills(workspace)
      const page: SkillsPage = new SkillsPage(
        this.controller,
        snapshot,
        query,
        (initial) => this.editExternal(initial),
        () => this.reloadSkillAutocomplete(),
        () => this.removePage(page),
        this.invalidate
      )
      this.pushPage(page)
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  async showConnect(): Promise<void> {
    this.closeUserPages('models', 'usage', 'provider-quota', 'subagents')
    if (this.findPage('connect')) return
    try {
      const snapshot = await this.controller.client.modelConnections()
      const page: ConnectPage = new ConnectPage(
        this.controller,
        snapshot,
        (provider) => this.authenticateOfficialProvider(provider),
        () => this.removePage(page),
        this.invalidate
      )
      this.pushPage(page)
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  async showModels(): Promise<void> {
    this.closeUserPages('connect', 'usage', 'provider-quota', 'subagents')
    if (this.findPage('models')) return
    try {
      const snapshot = this.controller.state.modelConnections ?? await this.controller.client.modelConnections()
      const page: ModelPage = new ModelPage(this.controller, this.keymap, snapshot, () => this.removePage(page), this.invalidate)
      this.pushPage(page)
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  showQuota(): void {
    this.closeUserPages('connect', 'models', 'usage', 'subagents')
    if (this.findPage('provider-quota')) return
    const page: ProviderQuotaPage = new ProviderQuotaPage(
      () => this.controller.client.providerQuotas(),
      () => this.removePage(page),
      this.invalidate
    )
    this.pushPage(page)
    void page.refresh()
  }

  showUsage(): void {
    this.closeUserPages('connect', 'models', 'provider-quota', 'subagents')
    if (this.findPage('usage')) return
    const page: UsagePage = new UsagePage(
      async () => ({
        usage: await this.controller.client.usage(),
        ...(this.controller.state.projection?.thread.id ? { activeThreadId: this.controller.state.projection.thread.id } : {}),
        threadTitles: Object.fromEntries(this.controller.state.threads.map((thread) => [thread.id, thread.title || thread.id]))
      }),
      () => this.removePage(page),
      this.invalidate
    )
    this.pushPage(page)
    void page.refresh()
  }

  showSubagents(): void {
    this.closeUserPages('connect', 'models', 'usage', 'provider-quota')
    if (this.findPage('subagents')) return
    const projection = this.controller.state.projection
    if (!projection) { this.controller.notify('Open or create a session first.', 'error'); return }
    const page: SubagentPage = new SubagentPage(this.controller, projection, () => this.removePage(page), this.invalidate)
    this.pushPage(page)
  }

  showSubagentPopup(child: ProjectedChildRun, onClose?: () => void): void {
    this.closeSubagentPopup(false)
    const projection = this.controller.state.projection
    if (!projection) return
    this.subagentPopupReturn = onClose
    const page = new SubagentPage(this.controller, projection, () => this.closeSubagentPopup(), this.invalidate, true)
    this.pushPage(page)
    void page.open(child)
  }

  protected closeSubagentPopup(restore = true): void {
    const page = this.findPage('subagent-popup')
    if (!page) return
    const onClose = this.subagentPopupReturn
    this.subagentPopupReturn = undefined
    this.removePage(page)
    if (restore) onClose?.()
  }

  showTranscript(): void {
    if (this.findPage('transcript')) return
    const page: TranscriptPage = new TranscriptPage(this.controller, this.showReasoningValue, () => this.removePage(page), this.invalidate)
    this.pushPage(page)
  }
}
