import type { ModelReasoningEffort } from '../../contracts/capabilities.js'
import { TUI_COMMAND_DEFINITIONS, type TuiCommandDefinition } from '../commands.js'
import type { TuiController, TuiControllerState } from '../controller.js'
import { isCancelKey, isKey, letter, type TuiKeyEvent } from '../keys.js'
import type { TuiKeymap } from '../keymap.js'
import {
  rowBlock,
  sectionBlock,
  type PageAction,
  type PageBlock,
  type PageMouseEvent,
  type PageSize,
  type PageView,
  type TuiPage
} from '../page-model.js'
import { formatGoalDuration } from '../render-utils.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { TextField } from '../text-field.js'
import { visual } from '../visual-system.js'
import { listCapacity, navigateList, navigateShortList, visibleWindow, type Invalidate } from './page-kit.js'

const { strong: bold, muted: dim, success: green, warning: yellow, danger: red } = visual

export class CommandPalettePage implements TuiPage {
  readonly kind = 'commands'
  private readonly search = new TextField()
  private index = 0

  constructor(
    private readonly keymap: TuiKeymap,
    private readonly close: (entry?: TuiCommandDefinition) => void,
    private readonly invalidate: Invalidate
  ) {}

  private entries(): readonly TuiCommandDefinition[] {
    const query = this.search.getValue().trim().toLowerCase()
    const matches = TUI_COMMAND_DEFINITIONS.filter((entry) => entry.available && entry.slash && (
      !query || `${entry.title} ${entry.category} ${entry.id} ${entry.slash}`.toLowerCase().includes(query)
    ))
    // Group by category (in order of first appearance) so every section
    // header is shown once.
    const categories = [...new Set(matches.map((entry) => entry.category))]
    return categories.flatMap((category) => matches.filter((entry) => entry.category === category))
  }

  view(size: PageSize): PageView {
    const entries = this.entries()
    this.index = Math.min(this.index, Math.max(0, entries.length - 1))
    const body: PageBlock[] = [{ kind: 'field', field: this.search, label: 'Search', focused: true }, { kind: 'spacer' }]
    let category = ''
    for (const { value: entry, index } of visibleWindow(entries, this.index, listCapacity(size, 4))) {
      if (entry.category !== category) {
        category = entry.category
        body.push(sectionBlock(category))
      }
      body.push(rowBlock(entry.title, entry.keyAction ? this.keymap.display(entry.keyAction) : `/${entry.slash}`, index === this.index, index))
    }
    if (!entries.length) body.push({ kind: 'line', text: dim(' No matching commands.') })
    return {
      path: ['KUN', 'Commands'],
      description: 'Search actions by name, category, or slash command.',
      body,
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'run' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    const entries = this.entries()
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateList(key, this.index, entries.length)
    if (next !== undefined) this.index = next
    else if (isKey(key, 'enter')) { this.close(entries[this.index]); return }
    else if (this.search.handleKey(key)) this.index = 0
    else return
    this.invalidate()
  }

  handlePaste(text: string): void {
    this.search.insert(text)
    this.index = 0
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    const entries = this.entries()
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(entries.length - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index) { this.close(entries[this.index]); return }
    else this.index = event.index
    this.invalidate()
  }
}

const EFFORT_DESCRIPTIONS: Partial<Record<ModelReasoningEffort, string>> = {
  off: 'No extended reasoning',
  low: 'Faster, lighter reasoning',
  medium: 'Balanced speed and depth',
  high: 'Deeper reasoning',
  max: 'Maximum supported depth'
}

export class VariantPage implements TuiPage {
  readonly kind = 'reasoning'
  private index: number

  constructor(
    private readonly controller: TuiController,
    private readonly efforts: readonly ModelReasoningEffort[],
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.index = Math.max(0, efforts.indexOf(controller.state.reasoningEffort ?? efforts[0]!))
  }

  view(): PageView {
    const current = this.controller.state.reasoningEffort
    return {
      path: ['KUN', 'Reasoning effort'],
      description: 'Choose a depth supported by the selected model.',
      body: this.efforts.map((effort, index) => rowBlock(
        effort,
        [EFFORT_DESCRIPTIONS[effort], effort === current ? 'current' : undefined].filter(Boolean).join(' · '),
        index === this.index,
        index
      )),
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'select' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateShortList(key, this.index, this.efforts.length)
    if (next !== undefined) { this.index = next; this.invalidate(); return }
    if (isKey(key, 'enter')) this.select()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(this.efforts.length - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index) { this.select(); return }
    else this.index = event.index
    this.invalidate()
  }

  private select(): void {
    this.controller.selectReasoningEffort(this.efforts[this.index]!)
    this.close()
  }
}

const MODE_DESCRIPTIONS = {
  agent: 'Build and act on the next request',
  plan: 'Analyze and plan before making changes',
  graph: 'Plan and execute through durable Graph subagents',
  goal: 'Keep pursuing Goals until complete'
} as const

export class AgentModePage implements TuiPage {
  readonly kind = 'mode'
  private readonly modes = ['agent', 'plan', 'graph', 'goal'] as const
  private index: number

  constructor(
    private readonly controller: TuiController,
    private readonly close: () => void,
    private readonly openGoal: () => void,
    private readonly invalidate: Invalidate
  ) {
    const thread = controller.state.projection?.thread
    const current = thread?.goal?.status === 'active'
      ? 'goal'
      : controller.state.composerOrchestration === 'graph'
        ? 'graph'
        : thread?.mode ?? controller.state.composerMode
    this.index = Math.max(0, this.modes.indexOf(current))
  }

  view(): PageView {
    return {
      path: ['KUN', 'Mode'],
      description: 'Choose Direct, Plan, Graph, or a persistent Goal.',
      body: this.modes.map((mode, index) =>
        rowBlock(mode === 'goal' ? 'Goal' : mode, MODE_DESCRIPTIONS[mode], index === this.index, index)),
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'select' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateShortList(key, this.index, this.modes.length)
    if (next !== undefined) { this.index = next; this.invalidate(); return }
    if (isKey(key, 'enter')) this.select()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(this.modes.length - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index) { this.select(); return }
    else this.index = event.index
    this.invalidate()
  }

  private select(): void {
    const mode = this.modes[this.index]!
    if (mode === 'goal') this.openGoal()
    else if (mode === 'graph') void this.controller.manageGraphMode().then(() => this.close())
    else {
      void this.controller.setPlanMode(mode)
      this.close()
    }
  }
}

export type GoalPageMode = 'menu' | 'objective' | 'budget' | 'confirm-clear'
type GoalAction = { id: 'pause' | 'resume' | 'edit' | 'budget' | 'clear'; label: string; detail: string }

export class GoalPage implements TuiPage {
  readonly kind = 'goal'
  private readonly input = new TextField()
  private state: TuiControllerState
  private mode: GoalPageMode
  private index = 0
  private saving = false
  private error = ''

  constructor(
    private readonly controller: TuiController,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.state = controller.state
    this.mode = this.state.projection?.thread.goal ? 'menu' : 'objective'
  }

  update(state: TuiControllerState): void {
    this.state = state
    this.invalidate()
  }

  private actions(): GoalAction[] {
    const goal = this.state.projection?.thread.goal
    if (!goal) return []
    return [
      goal.status === 'active'
        ? { id: 'pause', label: 'Pause goal', detail: 'Stop automatic continuation; keep progress' }
        : { id: 'resume', label: 'Resume goal', detail: 'Continue working in agent mode now' },
      { id: 'edit', label: 'Edit objective', detail: 'Replace the objective and start pursuing it' },
      { id: 'budget', label: 'Token budget', detail: goal.tokenBudget ? goal.tokenBudget.toLocaleString() : 'unlimited' },
      { id: 'clear', label: 'Clear goal', detail: 'Remove objective and accumulated goal state' }
    ]
  }

  view(): PageView {
    const goal = this.state.projection?.thread.goal
    const summary: PageBlock[] = (goal
      ? [
          `${dim('Status')}     ${goal.status === 'active' ? green(bold('active')) : yellow(goal.status)}`,
          `${dim('Objective')}  ${sanitizeTerminalText(goal.objective)}`,
          `${dim('Usage')}      ${goal.tokensUsed.toLocaleString()} tokens${goal.tokenBudget ? ` / ${goal.tokenBudget.toLocaleString()}` : ''} · ${formatGoalDuration(goal.timeUsedSeconds)}`
        ]
      : [
          yellow(bold('No active goal')),
          dim('Set an objective and Kun will keep working across turns until it is complete, paused, or blocked.')
        ]).map((text): PageBlock => ({ kind: 'text', text }))
    let body: PageBlock[]
    let footer: PageAction[]
    if (this.mode === 'objective' || this.mode === 'budget') {
      const objective = this.mode === 'objective'
      body = [
        ...summary,
        { kind: 'spacer' },
        sectionBlock(objective ? (goal ? 'Edit objective' : 'Start Goal mode') : 'Token budget'),
        { kind: 'field', field: this.input, focused: true, placeholder: objective ? 'objective' : 'tokens or none' },
        {
          kind: 'text',
          text: this.error
            ? red(this.error)
            : dim(objective ? 'Enter starts an agent turn immediately.' : 'Enter a positive token count, or “none” for no limit.')
        }
      ]
      footer = objective
        ? [{ key: 'Enter', label: goal ? 'save and pursue' : 'start goal' }, { key: 'Esc', label: goal ? 'actions' : 'back' }]
        : [{ key: 'Enter', label: 'save budget' }, { key: 'Esc', label: 'actions' }]
    } else if (this.mode === 'confirm-clear') {
      body = [...summary, { kind: 'spacer' }, { kind: 'text', text: red(bold('Clear this goal and its accumulated usage state?')) }]
      footer = [{ key: 'Enter', label: 'clear permanently', tone: 'danger' }, { key: 'Esc', label: 'cancel' }]
    } else {
      const actions = this.actions()
      this.index = Math.min(this.index, Math.max(0, actions.length - 1))
      body = [
        ...summary,
        { kind: 'spacer' },
        sectionBlock('Actions'),
        ...actions.map((action, index) => rowBlock(action.label, action.detail, index === this.index, index))
      ]
      footer = [{ key: '↑/↓', label: 'choose' }, { key: 'Enter', label: 'run' }, { key: 'Esc', label: 'back' }]
    }
    return {
      path: ['KUN', 'Goal mode'],
      description: 'A persistent objective with automatic continuation and shared GUI/TUI state.',
      right: this.saving ? 'saving…' : goal?.status ?? 'not configured',
      body,
      footer
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.saving) return
    if (isCancelKey(key)) {
      if (this.mode === 'menu' || (this.mode === 'objective' && !this.state.projection?.thread.goal)) {
        this.close()
        return
      }
      this.mode = 'menu'
      this.input.clear()
      this.error = ''
      this.invalidate()
      return
    }
    if (this.mode === 'menu') {
      const actions = this.actions()
      const next = navigateShortList(key, this.index, actions.length)
      if (next !== undefined) this.index = next
      else if (isKey(key, 'enter')) void this.runAction(actions[this.index]?.id)
      this.invalidate()
      return
    }
    if (this.mode === 'confirm-clear') {
      if (isKey(key, 'enter') || letter(key) === 'y') void this.clearGoal()
      return
    }
    if (isKey(key, 'enter')) {
      if (this.mode === 'objective') void this.saveObjective()
      else void this.saveBudget()
      return
    }
    if (this.input.handleKey(key)) {
      this.error = ''
      this.invalidate()
    }
  }

  handlePaste(text: string): void {
    if (this.mode !== 'objective' && this.mode !== 'budget') return
    this.input.insert(text)
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (this.mode !== 'menu' || event.type !== 'row') return
    if (event.activate && event.index === this.index) void this.runAction(this.actions()[this.index]?.id)
    else this.index = event.index
    this.invalidate()
  }

  private async runAction(action?: GoalAction['id']): Promise<void> {
    if (!action) return
    if (action === 'edit' || action === 'budget') {
      this.mode = action === 'edit' ? 'objective' : 'budget'
      const goal = this.state.projection?.thread.goal
      this.input.setValue(action === 'edit' ? goal?.objective ?? '' : goal?.tokenBudget?.toString() ?? '')
      this.invalidate()
      return
    }
    if (action === 'clear') {
      this.mode = 'confirm-clear'
      this.invalidate()
      return
    }
    this.saving = true
    this.invalidate()
    const ok = await this.controller.setGoalStatus(action === 'pause' ? 'paused' : 'active')
    this.saving = false
    if (ok && action === 'resume') this.close()
    this.invalidate()
  }

  private async saveObjective(): Promise<void> {
    const objective = this.input.getValue().trim()
    if (!objective) {
      this.error = 'Enter an objective before starting Goal mode.'
      this.invalidate()
      return
    }
    this.saving = true
    this.invalidate()
    const ok = await this.controller.activateGoal(objective, this.state.projection?.thread.goal?.tokenBudget)
    this.saving = false
    if (ok) this.close()
    this.invalidate()
  }

  private async saveBudget(): Promise<void> {
    const value = this.input.getValue().trim().toLowerCase()
    const budget = value === '' || value === 'none' || value === 'unlimited'
      ? null
      : Number(value.replace(/[, _]/gu, ''))
    if (budget !== null && (!Number.isSafeInteger(budget) || budget <= 0)) {
      this.error = 'Use a positive whole number, or “none”.'
      this.invalidate()
      return
    }
    this.saving = true
    this.invalidate()
    const ok = await this.controller.setGoalBudget(budget)
    this.saving = false
    if (ok) {
      this.mode = 'menu'
      this.input.clear()
    }
    this.invalidate()
  }

  private async clearGoal(): Promise<void> {
    this.saving = true
    this.invalidate()
    const ok = await this.controller.clearGoal()
    this.saving = false
    if (ok) this.close()
    this.invalidate()
  }
}
