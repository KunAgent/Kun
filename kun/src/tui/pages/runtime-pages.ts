import type { TurnItem } from '../../contracts/items.js'
import type { SkillsSnapshot } from '../client.js'
import type { TuiController } from '../controller.js'
import { isCancelKey, isKey, letter, type TuiKeyEvent } from '../keys.js'
import { sanitizeTerminalText as stripTerminalControls, wrapText } from '../layout.js'
import {
  rowBlock,
  sectionBlock,
  type PageBlock,
  type PageMouseEvent,
  type PageSize,
  type PageView,
  type TuiPage
} from '../page-model.js'
import { oneLine } from '../render-utils.js'
import { sanitizeTerminalText } from '../safe-text.js'
import type { ThreadProjection } from '../state.js'
import { TextField } from '../text-field.js'
import {
  answerCurrentUserInputWithText,
  confirmCurrentUserInput,
  currentUserInputQuestion,
  isUserInputSessionComplete,
  moveUserInputOption,
  orderedUserInputAnswers,
  selectedUserInputLabels,
  toggleCurrentUserInputOption,
  type UserInputSession
} from '../user-input.js'
import { visual } from '../visual-system.js'
import { listCapacity, navigateList, visibleWindow, type Invalidate } from './page-kit.js'

const { strong: bold, muted: dim, danger: red, warning: yellow } = visual

export type TimelineEntry = {
  turnId: string
  ordinal: number
  label: string
  preview: string[]
}

export class TimelinePage implements TuiPage {
  readonly kind = 'timeline'
  private index = 0
  private expanded = false
  private readonly openedFromJump: boolean
  private detailOffset = 0
  private readonly entries: TimelineEntry[]
  private lastHeight = 30

  constructor(
    private readonly controller: TuiController,
    projection: ThreadProjection,
    query: string | undefined,
    target: string | undefined,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    this.openedFromJump = Boolean(target)
    const needle = query?.trim().toLowerCase()
    this.entries = projection.thread.turns.flatMap((turn, turnIndex) => {
      const user = turn.items.find((item): item is Extract<TurnItem, { kind: 'user_message' }> => item.kind === 'user_message')
      const assistant = turn.items.filter((item): item is Extract<TurnItem, { kind: 'assistant_text' }> => item.kind === 'assistant_text')
      const text = [user?.displayText ?? user?.text ?? turn.prompt, ...assistant.map((item) => item.text)].join('\n')
      if (needle && !text.toLowerCase().includes(needle) && !turn.id.toLowerCase().includes(needle)) return []
      return [{
        turnId: turn.id,
        ordinal: turnIndex + 1,
        label: `${turnIndex + 1}. ${oneLine(user?.displayText ?? user?.text ?? turn.prompt)}`,
        preview: text.split('\n').filter(Boolean).map((line) => sanitizeTerminalText(line))
      }]
    })
    const numeric = Number(target)
    const selected = Number.isSafeInteger(numeric) && numeric > 0
      ? this.entries.findIndex((entry) => entry.ordinal === numeric)
      : target
        ? this.entries.findIndex((entry) => `${entry.turnId} ${entry.label}`.toLowerCase().includes(target.toLowerCase()))
        : -1
    if (selected >= 0) this.index = selected
    if (target && selected >= 0) this.expanded = true
  }

  private bodyHeight(height: number): number {
    return Math.max(6, height - 8)
  }

  view(size: PageSize): PageView {
    this.lastHeight = size.height
    const selected = this.entries[this.index]
    if (this.expanded && selected) {
      const bodyHeight = this.bodyHeight(size.height)
      const lines = selected.preview.length ? selected.preview : ['No text was recorded for this turn.']
      this.detailOffset = Math.min(this.detailOffset, Math.max(0, lines.length - bodyHeight))
      return {
        path: ['KUN', 'Timeline', `Turn ${selected.ordinal}`],
        right: `${selected.turnId} · ${this.detailOffset + 1}-${Math.min(lines.length, this.detailOffset + bodyHeight)}/${lines.length}`,
        body: lines.slice(this.detailOffset, this.detailOffset + bodyHeight).map((text): PageBlock => ({ kind: 'line', text })),
        footer: [
          { key: '↑/↓ PgUp/PgDn', label: 'scroll' },
          { key: 'f', label: 'fork here' },
          { key: 'Esc', label: 'turn list' }
        ]
      }
    }
    const capacity = Math.max(4, listCapacity(size, 8))
    const body: PageBlock[] = visibleWindow(this.entries, this.index, capacity).map(({ value: entry, index }) =>
      rowBlock(entry.label, index === this.index ? `turn ${entry.ordinal}` : '', index === this.index, index))
    if (!this.entries.length) body.push({ kind: 'line', text: dim('No matching turns.') })
    if (selected) {
      body.push(
        { kind: 'spacer' },
        { kind: 'line', text: bold(`Turn ${selected.ordinal} · ${sanitizeTerminalText(selected.turnId)}`) },
        ...selected.preview.slice(0, 6).map((line): PageBlock => ({ kind: 'line', text: dim(line) }))
      )
    }
    return {
      path: ['KUN', 'Timeline'],
      right: `${this.entries.length} turns`,
      body,
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'open turn' },
        { key: 'f', label: 'fork here' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.expanded) {
      const page = this.bodyHeight(this.lastHeight)
      if (isCancelKey(key)) {
        if (this.openedFromJump) { this.close(); return }
        this.expanded = false
        this.detailOffset = 0
      } else if (isKey(key, 'up') || letter(key) === 'k') this.detailOffset = Math.max(0, this.detailOffset - 1)
      else if (isKey(key, 'down') || letter(key) === 'j') this.detailOffset += 1
      else if (isKey(key, 'pageUp')) this.detailOffset = Math.max(0, this.detailOffset - page)
      else if (isKey(key, 'pageDown')) this.detailOffset += page
      else if (isKey(key, 'home')) this.detailOffset = 0
      else if (letter(key) === 'f' && this.entries[this.index]) { this.forkSelected(); return }
      else return
      this.invalidate()
      return
    }
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateList(key, this.index, this.entries.length, 8)
    if (next !== undefined) this.index = next
    else if (isKey(key, 'enter') && this.entries[this.index]) {
      this.expanded = true
      this.detailOffset = 0
    } else if (letter(key) === 'f' && this.entries[this.index]) { this.forkSelected(); return }
    else return
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type === 'scroll') {
      if (this.expanded) this.detailOffset = Math.max(0, this.detailOffset + event.delta)
      else this.index = Math.max(0, Math.min(this.entries.length - 1, this.index + event.delta))
    } else if (!this.expanded) {
      if (event.activate && event.index === this.index) {
        this.expanded = true
        this.detailOffset = 0
      } else this.index = event.index
    }
    this.invalidate()
  }

  private forkSelected(): void {
    const entry = this.entries[this.index]
    if (!entry) return
    this.close()
    void this.controller.forkAtTurn(entry.turnId, `Fork at turn ${entry.ordinal}`)
  }
}

export class SkillsPage implements TuiPage {
  readonly kind = 'skills'
  private index = 0
  private readonly entries: SkillsSnapshot['skills']
  private deleteConfirm = false

  constructor(
    private readonly controller: TuiController,
    private readonly snapshot: SkillsSnapshot,
    query: string | undefined,
    private readonly editText: (initial: string) => Promise<string>,
    private readonly changed: () => Promise<void>,
    private readonly close: () => void,
    private readonly invalidate: Invalidate
  ) {
    const needle = query?.trim().toLowerCase()
    this.entries = needle
      ? snapshot.skills.filter((skill) => `${skill.id} ${skill.name} ${skill.description ?? ''}`.toLowerCase().includes(needle))
      : snapshot.skills
  }

  view(size: PageSize): PageView {
    const body: PageBlock[] = visibleWindow(this.entries, this.index, listCapacity(size, 2)).map(({ value: skill, index }) =>
      rowBlock(
        sanitizeTerminalText(skill.id),
        `${skill.source}${skill.description ? ` · ${sanitizeTerminalText(skill.description)}` : ''}`,
        index === this.index,
        index
      ))
    if (!this.entries.length) body.push({ kind: 'line', text: dim('No skills are visible in this workspace.') })
    if (this.snapshot.validationErrors.length) {
      body.push({ kind: 'spacer' }, { kind: 'line', text: red(`${this.snapshot.validationErrors.length} skill validation error(s)`) })
    }
    return {
      path: ['KUN', 'Skills'],
      right: `${this.entries.length} visible · ${this.snapshot.enabled ? 'enabled' : 'disabled'}`,
      description: 'Workspace and user skills available to this session.',
      body,
      footer: [
        { key: '↑/↓', label: 'choose' },
        { key: 'Enter', label: 'invoke' },
        { key: 'e', label: 'edit' },
        { key: 'd', label: 'disable' },
        { key: 'x', label: this.deleteConfirm ? 'Enter confirms delete' : 'delete managed' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    const skill = this.entries[this.index]
    if (this.deleteConfirm) {
      if (isCancelKey(key)) {
        this.deleteConfirm = false
        this.invalidate()
      } else if (isKey(key, 'enter') && skill) {
        this.close()
        void this.runMutation(`delete ${skill.id} --yes`)
      }
      return
    }
    if (isCancelKey(key)) { this.close(); return }
    const next = navigateList(key, this.index, this.entries.length)
    if (next !== undefined) { this.index = next; this.invalidate(); return }
    if (!skill) return
    if (isKey(key, 'enter')) {
      this.close()
      void this.controller.invokeSkill(skill.id)
    } else if (letter(key) === 'e') {
      this.close()
      void this.runMutation(`edit ${skill.id}`)
    } else if (letter(key) === 'd') {
      this.close()
      void this.runMutation(`disable ${skill.id}`)
    } else if (letter(key) === 'x') {
      this.deleteConfirm = true
      this.invalidate()
    }
  }

  handleMouse(event: PageMouseEvent): void {
    if (event.type === 'scroll') this.index = Math.max(0, Math.min(this.entries.length - 1, this.index + event.delta))
    else if (event.activate && event.index === this.index && this.entries[this.index]) {
      const skill = this.entries[this.index]!
      this.close()
      void this.controller.invokeSkill(skill.id)
      return
    } else this.index = event.index
    this.invalidate()
  }

  private async runMutation(action: string): Promise<void> {
    await this.controller.manageSkills(action, this.editText)
    await this.changed()
  }
}

/** Enter presses this soon after the page opens were typed for the composer. */
const APPROVAL_ENTER_GUARD_MS = 400

export class ApprovalPage implements TuiPage {
  readonly kind = 'approval'
  private detailOffset = 0
  private totalLines = 0
  private pageSize = 10
  private choice: 'allow' | 'deny' = 'allow'
  private readonly openedAt = Date.now()
  private deciding = false

  constructor(
    private readonly controller: TuiController,
    private readonly toolName: string,
    private readonly summary: string,
    private readonly invalidate: Invalidate
  ) {}

  view(size: PageSize): PageView {
    const workspace = this.controller.state.projection?.thread.workspace
    const details = wrapText(stripTerminalControls(this.summary), Math.max(8, size.width - 4))
    this.totalLines = details.length
    this.pageSize = Math.max(4, size.height - 17)
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, details.length - this.pageSize))
    const scrollable = details.length > this.pageSize
    return {
      path: ['KUN', 'Approval required'],
      right: scrollable ? `${this.detailOffset + 1}-${Math.min(details.length, this.detailOffset + this.pageSize)}/${details.length}` : undefined,
      description: 'Review the requested action before Kun continues.',
      body: [
        sectionBlock('Request'),
        { kind: 'line', text: ` ${dim('Tool')}       ${bold(sanitizeTerminalText(this.toolName))}` },
        ...(workspace ? [{ kind: 'line' as const, text: ` ${dim('Workspace')}  ${sanitizeTerminalText(workspace)}` }] : []),
        ...(scrollable ? [{ kind: 'line' as const, text: ` ${dim('Complete action (scroll to review all content)')}` }] : [{ kind: 'spacer' as const }]),
        ...details.slice(this.detailOffset, this.detailOffset + this.pageSize).map((line): PageBlock => ({ kind: 'line', text: ` ${line}` })),
        { kind: 'spacer' },
        rowBlock(`${this.choice === 'allow' ? yellow('Allow once') : 'Allow once'}  ${dim('y')}`, 'run this action now', this.choice === 'allow', 0),
        rowBlock(`${this.choice === 'deny' ? red('Deny') : 'Deny'}  ${dim('n')}`, 'block this action', this.choice === 'deny', 1)
      ],
      footer: [
        { key: '←/→', label: 'choose' },
        { key: 'Enter', label: 'confirm' },
        ...(scrollable ? [{ key: '↑/↓ PgUp/PgDn', label: 'scroll' }] : []),
        { key: 'y', label: 'allow once', tone: 'warning' as const },
        { key: 'n/Esc', label: 'deny', tone: 'danger' as const }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (this.deciding) return
    if (isKey(key, 'up') || letter(key) === 'k') this.detailOffset = Math.max(0, this.detailOffset - 1)
    else if (isKey(key, 'down') || letter(key) === 'j') this.detailOffset += 1
    else if (isKey(key, 'pageUp')) this.detailOffset = Math.max(0, this.detailOffset - this.pageSize)
    else if (isKey(key, 'pageDown')) this.detailOffset += this.pageSize
    else if (isKey(key, 'home')) this.detailOffset = 0
    else if (isKey(key, 'end')) this.detailOffset = Math.max(0, this.totalLines - this.pageSize)
    else if (isKey(key, 'left', 'right', 'tab', 'shift+tab')) this.choice = this.choice === 'allow' ? 'deny' : 'allow'
    else if (isKey(key, 'enter')) {
      if (Date.now() - this.openedAt < APPROVAL_ENTER_GUARD_MS) return
      this.decide(this.choice)
      return
    } else if (letter(key) === 'y') { this.decide('allow'); return }
    else if (letter(key) === 'n' || isCancelKey(key)) { this.decide('deny'); return }
    else return
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    if (this.deciding) return
    if (event.type === 'scroll') {
      this.detailOffset = Math.max(0, this.detailOffset + event.delta)
    } else {
      const choice = event.index === 0 ? 'allow' : event.index === 1 ? 'deny' : undefined
      if (!choice) return
      if (event.activate && choice === this.choice) { this.decide(choice); return }
      this.choice = choice
    }
    this.invalidate()
  }

  private decide(decision: 'allow' | 'deny'): void {
    this.deciding = true
    void this.controller.decideApproval(decision).finally(() => { this.deciding = false })
  }
}

export class UserInputPage implements TuiPage {
  readonly kind = 'input'
  private readonly answer = new TextField()

  constructor(
    private readonly controller: TuiController,
    private session: UserInputSession,
    private readonly invalidate: Invalidate
  ) {}

  view(): PageView {
    const question = currentUserInputQuestion(this.session)
    const selected = selectedUserInputLabels(this.session)
    const options = question.options.map((option, index) => {
      const mark = question.selectionMode === 'multiple'
        ? (selected.has(option.label) ? '[x]' : '[ ]')
        : `${index + 1}.`
      const recommendation = option.recommended ? '[recommended] ' : ''
      return rowBlock(
        `${mark} ${recommendation}${sanitizeTerminalText(option.label)}`,
        option.description ? sanitizeTerminalText(option.description) : '',
        index === this.session.optionIndex,
        index
      )
    })
    return {
      path: ['KUN', 'Question', question.header],
      right: `Question ${this.session.questionIndex + 1} of ${this.session.questions.length}`,
      body: [
        { kind: 'text', text: ` ${bold(sanitizeTerminalText(question.question))}` },
        { kind: 'spacer' },
        ...options,
        { kind: 'spacer' },
        {
          kind: 'field',
          field: this.answer,
          label: question.options.length ? 'Or type' : 'Answer',
          focused: true,
          placeholder: question.options.length ? 'a custom answer' : 'type your answer'
        }
      ],
      footer: [
        { key: '↑/↓', label: 'choose' },
        ...(question.selectionMode === 'multiple' ? [{ key: 'Space', label: 'toggle' }] : []),
        { key: 'Enter', label: 'confirm' },
        { key: 'Esc', label: 'cancel' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    const question = currentUserInputQuestion(this.session)
    const empty = !this.answer.getValue()
    if (isCancelKey(key)) { void this.controller.cancelUserInput(); return }
    if (isKey(key, 'up', 'ctrl+p') && empty && question.options.length) this.session = moveUserInputOption(this.session, -1)
    else if (isKey(key, 'down', 'ctrl+n') && empty && question.options.length) this.session = moveUserInputOption(this.session, 1)
    else if (isKey(key, 'space') && empty && question.selectionMode === 'multiple') this.session = toggleCurrentUserInputOption(this.session)
    else if (isKey(key, 'enter')) { this.confirm(); return }
    else if (!this.answer.handleKey(key)) return
    this.invalidate()
  }

  handlePaste(text: string): void {
    this.answer.insert(text)
    this.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    const question = currentUserInputQuestion(this.session)
    if (event.type !== 'row' || !question.options.length) return
    this.session = moveUserInputOption(this.session, event.index - this.session.optionIndex)
    if (event.activate) {
      if (question.selectionMode === 'multiple') this.session = toggleCurrentUserInputOption(this.session)
      else { this.confirm(); return }
    }
    this.invalidate()
  }

  private confirm(): void {
    const text = this.answer.getValue().trim()
    this.session = text ? answerCurrentUserInputWithText(this.session, text) : confirmCurrentUserInput(this.session)
    this.answer.clear()
    if (isUserInputSessionComplete(this.session)) {
      void this.controller.resolveUserInput(orderedUserInputAnswers(this.session))
    }
    this.invalidate()
  }
}
