import {
  Editor,
  Input,
  Markdown,
  ProcessTerminal,
  TUI,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type Focusable,
  type MarkdownTheme,
  type OverlayHandle,
  type SelectListTheme,
  type SlashCommand
} from '@earendil-works/pi-tui'
import {
  providerCatalogEntries,
  type ProviderCatalogAuthFlow,
  type ProviderCatalogAuthType,
  type ProviderCatalogKind
} from '@kun/provider-catalog'
import { spawn } from 'node:child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { stdin as processStdin, stdout as processStdout } from 'node:process'
import { redactSecrets, redactSecretText } from '../config/secret-redaction.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'
import type { AttachmentMetadata } from '../contracts/attachments.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelReasoningEffort } from '../contracts/capabilities.js'
import {
  KUN_TOOL_PERMISSION_MODES,
  kunToolPermissionModeFromSettings,
  kunToolPermissionModeSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type KunToolPermissionMode,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ClaudeSdkInstallStatus,
  type ModelConnectionOAuthStatus,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { TuiCommand, TuiCommandDefinition } from './commands.js'
import { parseTuiCommand, TUI_COMMAND_DEFINITIONS, TUI_SLASH_COMMANDS } from './commands.js'
import { runSelfUpdateCommand } from '../cli/self-update.js'
import {
  activityFrame,
  formatContextGauge,
  formatTokenCount,
  type ActivityVisualKind
} from './activity.js'
import { parseTuiKeymapConfig, type TuiKeyAction, type TuiKeymap } from './keymap.js'
import { TuiClientError, type KunTuiClient, type SkillsSnapshot } from './client.js'
import type { TuiControllerState } from './controller.js'
import { TuiController } from './controller.js'
import {
  sanitizeTerminalText as stripTerminalControls,
  wrapText
} from './layout.js'
import { codeFenceLanguage, highlightTerminalCode, terminalAssistantMarkdown } from './markdown-code.js'
import {
  contextualFooter,
  pageFrame,
  sectionLabel,
  selectionRow,
  statusGlyph,
  visual,
  visualDensity
} from './visual-system.js'
import { InlineStreamTerminal, ScrollbackPreservingTerminal } from './pi-terminal.js'
import { ProviderQuotaDialog } from './provider-quota.js'
import { UsageDialog } from './usage-report.js'
import {
  installAntigravityCli,
  resolveAntigravityCliCommand,
  resolveGeminiCliCommand,
  type OfficialProviderCliId
} from '../services/official-provider-cli.js'
import {
  copyWithSystemClipboard,
  editTextInExternalEditor,
  lastAssistantText,
  osc52ClipboardSequence,
  renderThreadMarkdown,
  runInteractiveProviderCli,
  writeThreadExport
} from './operations.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  type ProjectedApprovalReview,
  type ProjectedChildRun,
  type ProjectedTurnActivity,
  type ThreadProjection
} from './state.js'
import type { TerminalInput, TerminalOutput } from './pi-terminal.js'
import {
  latestTuiGraphRun,
  moveTuiGraphBoardSelection,
  projectTuiGraphBoard,
  type TuiGraphBoardNode,
  type TuiGraphBoardProjection,
  summarizeTuiGraphRun
} from './graph-mode.js'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  createUserInputSession,
  currentUserInputQuestion,
  isUserInputSessionComplete,
  moveUserInputOption,
  orderedUserInputAnswers,
  selectedUserInputLabels,
  toggleCurrentUserInputOption,
  type UserInputSession
} from './user-input.js'
import {
  ClipboardImageError,
  clipboardImageEmptyHint,
  readClipboardImage,
  type ClipboardImage
} from './clipboard-image.js'
import { WorkspaceFileAutocompleteProvider } from './file-mentions.js'
import { bold, dim, blue, cyan, green, yellow, red, magenta, italic, isCancelInput, EXIT_CONFIRM_WINDOW_MS, UNDO_ESCAPE_WINDOW_MS, TOTAL_ELAPSED_MIN_START_GAP_MS, BRACKETED_PASTE_START, BRACKETED_PASTE_END, ENABLE_MOUSE_TRACKING, DISABLE_MOUSE_TRACKING, DIRECT_SEMANTIC_ACTIONS, sanitizeTerminalText, selectTheme, editorTheme, markdownTheme, parseSgrMouseEvent, writeLocalShareSnapshot, removeLocalShareSnapshot, type SgrMouseEvent, type ExclusiveRouteHandle } from './pi-common.js'
import { PiTuiApplicationInput } from './application-input.js'
import { SubagentDialog } from './subagent-dialog.js'
import { GraphBoardDialog } from './graph-dialog.js'
import { ThreadPickerDialog, HelpDialog, InspectionDialog, PermissionDialog } from './session-dialogs.js'
import { ApprovalDialog, UserInputDialog, TimelineDialog, SkillsDialog } from './runtime-dialogs.js'
import { safeError } from './render-layout.js'

export abstract class PiTuiApplicationOverlays extends PiTuiApplicationInput {
  protected showExclusiveRoute(
    kind: string,
    component: Component & Focusable
  ): ExclusiveRouteHandle {
    let visible = true
    this.root.showPrimaryRoute(kind, component)
    this.tui.setFocus(component)
    this.tui.requestRender()
    return {
      hide: () => {
        if (!visible) return
        visible = false
        this.root.hidePrimaryRoute(component)
        this.tui.setFocus(this.root.activePrimaryRoute() ?? this.root)
        this.tui.requestRender()
      }
    }
  }

  protected override syncOverlays(state: TuiControllerState): void {
    if (state.modelConnections) {
      this.connectRoute?.updateSnapshot(state.modelConnections)
      this.modelRoute?.updateSnapshot(state.modelConnections)
    }

    if (state.view === 'threads') {
      if (!this.threadOverlay) {
        const component = new ThreadPickerDialog(this.controller, this.tui, this.keymap)
        const handle = this.showExclusiveRoute('sessions', component)
        this.threadOverlay = { component, handle }
        this.threadRefreshTimer = setInterval(() => {
          void this.controller.refreshThreads(this.controller.state.threadSearch)
        }, 2_000)
      }
      this.threadOverlay.component.update(state)
    } else if (this.threadOverlay) {
      this.threadOverlay.handle.hide()
      this.threadOverlay = undefined
      if (this.threadRefreshTimer) clearInterval(this.threadRefreshTimer)
      this.threadRefreshTimer = undefined
    }

    if (state.view === 'help') {
      if (!this.helpOverlay) {
        const component = new HelpDialog(this.controller, this.keymap)
        this.helpOverlay = {
          component,
          handle: this.showExclusiveRoute('help', component)
        }
      }
    } else if (this.helpOverlay) {
      this.helpOverlay.handle.hide()
      this.helpOverlay = undefined
    }

    const approval = state.projection?.pendingApproval
    if (approval) {
      if (this.approvalOverlay?.id !== approval.approvalId) {
        this.approvalOverlay?.handle.hide()
        const component = new ApprovalDialog(this.controller, approval.toolName, approval.summary, () => this.terminal.rows)
        this.approvalOverlay = {
          id: approval.approvalId,
          component,
          handle: this.showExclusiveRoute('approval', component)
        }
      }
    } else if (this.approvalOverlay) {
      this.approvalOverlay.handle.hide()
      this.approvalOverlay = undefined
    }

    const pendingInput = state.projection?.pendingUserInput
    if (pendingInput) {
      if (this.inputOverlay?.id !== pendingInput.inputId) {
        this.inputOverlay?.handle.hide()
        const component = new UserInputDialog(this.tui, this.controller, createUserInputSession(pendingInput))
        this.inputOverlay = {
          id: pendingInput.inputId,
          component,
          handle: this.showExclusiveRoute('input', component)
        }
      }
    } else if (this.inputOverlay) {
      this.inputOverlay.handle.hide()
      this.inputOverlay = undefined
    }

    if (state.inspection && !approval && !pendingInput) {
      if (this.inspectionOverlay?.value !== state.inspection) {
        this.inspectionOverlay?.handle.hide()
        const component = new InspectionDialog(
          this.controller,
          state.inspection.title,
          state.inspection.lines,
          () => this.terminal.rows
        )
        this.inspectionOverlay = {
          value: state.inspection,
          component,
          handle: this.showExclusiveRoute('inspection', component)
        }
      }
    } else if (this.inspectionOverlay) {
      this.inspectionOverlay.handle.hide()
      this.inspectionOverlay = undefined
    }
  }

  protected override syncGraphBoard(state: TuiControllerState): void {
    const target = state.graphBoard
    const mandatory = Boolean(
      state.projection?.pendingApproval || state.projection?.pendingUserInput
    )
    if (!target || mandatory || this.subagentPopup) {
      this.closeGraphPopup(false, Boolean(target))
      return
    }
    const run = state.graphRuns.find((candidate) => candidate.id === target.runId)
    if (!run) {
      this.closeGraphPopup(false)
      return
    }
    if (this.graphPopup?.runId === run.id) {
      this.graphPopup.component.update(state)
      return
    }
    this.closeGraphPopup(false)
    const initialNodeId = this.pendingGraphSelection?.runId === run.id
      ? this.pendingGraphSelection.nodeId
      : undefined
    this.pendingGraphSelection = undefined
    const component = new GraphBoardDialog({
      tui: this.tui,
      controller: this.controller,
      state,
      runId: run.id,
      terminalRows: () => this.terminal.rows,
      ...(initialNodeId ? { initialNodeId } : {}),
      close: () => this.controller.dismissGraphBoard(),
      openWorker: (runId, nodeId, childThreadId) =>
        this.openGraphWorker(runId, nodeId, childThreadId)
    })
    const handle = this.tui.showOverlay(component, {
      width: '90%',
      minWidth: 48,
      maxHeight: '85%',
      anchor: 'center',
      margin: 1
    })
    this.graphPopup = { runId: run.id, component, handle }
    this.tui.setFocus(component)
    this.tui.requestRender()
  }

  protected closeGraphPopup(dismiss = false, preserveSelection = false): void {
    const popup = this.graphPopup
    if (!popup) {
      if (dismiss) this.controller.dismissGraphBoard()
      return
    }
    if (preserveSelection) {
      this.pendingGraphSelection = {
        runId: popup.runId,
        nodeId: popup.component.selectedNodeId()
      }
    }
    this.graphPopup = undefined
    popup.handle.hide()
    if (dismiss) this.controller.dismissGraphBoard()
    this.tui.setFocus(this.root.activePrimaryRoute() ?? this.root)
    this.tui.requestRender()
  }

  protected openGraphWorker(runId: string, nodeId: string, childThreadId: string): void {
    const child = this.controller.state.projection?.childRuns.find(
      (candidate) => candidate.childId === childThreadId
    )
    if (!child) {
      this.controller.notify('This Graph worker session is not available yet.', 'error')
      return
    }
    this.pendingGraphSelection = { runId, nodeId }
    this.closeGraphPopup(false)
    this.controller.dismissGraphBoard()
    this.showSubagentPopup(child, () => {
      if (!this.controller.openGraphBoard(runId)) {
        this.controller.notify('The parent GraphRun is no longer available.', 'error')
      }
    })
  }

  protected override showPermissions(): void {
    if (this.permissionOverlay) return
    const thread = this.controller.state.projection?.thread
    if (!thread) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const component = new PermissionDialog(
      this.controller,
      thread.approvalPolicy,
      thread.sandboxMode,
      thread.approvalReviewer,
      () => {
      this.permissionOverlay?.handle.hide()
      this.permissionOverlay = undefined
      this.tui.setFocus(this.root)
      }
    )
    this.permissionOverlay = {
      component,
      handle: this.showExclusiveRoute('permissions', component)
    }
  }

  protected override showTimeline(query?: string, target?: string): void {
    this.timelineOverlay?.handle.hide()
    const projection = this.controller.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const component = new TimelineDialog(this.controller, projection, query, target, () => {
      this.timelineOverlay?.handle.hide()
      this.timelineOverlay = undefined
      this.tui.setFocus(this.root)
    }, () => this.terminal.rows)
    this.timelineOverlay = {
      component,
      handle: this.showExclusiveRoute('timeline', component)
    }
  }

  protected override async showSkills(query?: string): Promise<void> {
    this.skillsOverlay?.handle.hide()
    try {
      if (await this.controller.manageSkills(query, (initial) => this.editExternal(initial))) {
        this.autocompleteWorkspace = undefined
        await this.refreshSkillAutocomplete(
          this.controller.state.projection?.thread.workspace ?? this.controller.options.workspace
        )
        return
      }
      const workspace = this.controller.state.projection?.thread.workspace ?? this.controller.options.workspace
      const snapshot = await this.controller.client.skills(workspace)
      const component = new SkillsDialog(
        this.controller,
        snapshot,
        query,
        (initial) => this.editExternal(initial),
        () => this.reloadSkillAutocomplete(),
        () => {
        this.skillsOverlay?.handle.hide()
        this.skillsOverlay = undefined
        this.tui.setFocus(this.root)
        }
      )
      this.skillsOverlay = {
        component,
        handle: this.showExclusiveRoute('skills', component)
      }
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  protected override async refreshSkillAutocomplete(workspace: string): Promise<void> {
    if (this.autocompleteWorkspace === workspace) return
    if (this.autocompleteRequest) return this.autocompleteRequest
    const request = this.controller.client.skills(workspace).then((snapshot) => {
      if (this.stopped) return
      this.autocompleteWorkspace = workspace
      this.root.setAutocomplete(snapshot.skills, workspace)
    }).catch(() => undefined).finally(() => {
      if (this.autocompleteRequest !== request) return
      this.autocompleteRequest = undefined
      const desired = this.controller.state.projection?.thread.workspace ?? this.controller.options.workspace
      if (desired !== this.autocompleteWorkspace) void this.refreshSkillAutocomplete(desired)
    })
    this.autocompleteRequest = request
    return request
  }

  protected async reloadSkillAutocomplete(): Promise<void> {
    this.autocompleteWorkspace = undefined
    await this.refreshSkillAutocomplete(
      this.controller.state.projection?.thread.workspace ?? this.controller.options.workspace
    )
  }

  protected override async editExternal(initial: string): Promise<string> {
    this.writeMouseTracking(false)
    this.tui.stop()
    this.terminalActive = false
    try {
      return await editTextInExternalEditor(initial)
    } finally {
      if (!this.stopped) {
        this.tui.start()
        this.terminalActive = true
        this.writeMouseTracking(this.mouseTrackingWanted)
        this.terminal.setTitle('Kun')
        this.tui.setFocus(this.root)
        this.tui.requestRender(true)
      }
    }
  }

  protected override async copyLastResponse(): Promise<void> {
    const projection = this.controller.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    const text = lastAssistantText(projection.thread)
    if (!text) { this.controller.notify('No assistant response is available to copy.', 'error'); return }
    const safeText = sanitizeTerminalText(text)
    // Match Kimi's remote-terminal behavior: give the local terminal an
    // OSC52 copy request even when native clipboard tooling exists on the
    // host, then use the native result as the verified delivery method.
    this.terminal.write(osc52ClipboardSequence(safeText))
    const method = await copyWithSystemClipboard(safeText)
    this.controller.notify(`Copied the last assistant response${method ? ` with ${method}` : ' with OSC52'}.`)
  }

  protected override async exportThread(path?: string): Promise<void> {
    const projection = this.controller.state.projection
    if (!projection) { this.controller.notify('Open or create a thread first.', 'error'); return }
    try {
      const written = await writeThreadExport(projection.thread, path)
      this.controller.notify(`Exported Markdown: ${written}`)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      this.controller.notify(code === 'EEXIST'
        ? 'Export target already exists; choose a new path so Kun does not overwrite it.'
        : safeError(error), 'error')
    }
  }

  protected override async shareThread(): Promise<void> {
    const projection = this.controller.state.projection
    if (!projection) {
      this.controller.notify('Open or create a session first.', 'error')
      return
    }
    try {
      const path = await writeLocalShareSnapshot(
        this.controller.options.dataDir,
        projection.thread.id,
        renderThreadMarkdown(projection.thread)
      )
      this.controller.notify(`Local share snapshot updated: ${path}`)
    } catch (error) {
      this.controller.notify(safeError(error), 'error')
    }
  }

  protected override async unshareThread(): Promise<void> {
    const projection = this.controller.state.projection
    if (!projection) {
      this.controller.notify('Open or create a session first.', 'error')
      return
    }
    try {
      await removeLocalShareSnapshot(
        this.controller.options.dataDir,
        projection.thread.id
      )
      this.controller.notify('Local share snapshot removed.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.controller.notify('No local share snapshot exists.')
      else this.controller.notify(safeError(error), 'error')
    }
  }
}
