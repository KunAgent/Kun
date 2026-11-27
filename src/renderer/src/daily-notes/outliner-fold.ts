import type { RefObject } from 'react'
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import type { DailyNotesCopy } from './copy'
import { parseTasks, type NoteTask } from './tasks'

export type OutlinerFoldCallbacks = {
  copy: DailyNotesCopy
  onZoomTask?: (line: number) => void
}

export function isTaskSubtreeFolded(state: EditorState, task: NoteTask): boolean {
  if (!task.subRange) return false
  const line = state.doc.line(task.line + 1)
  let folded = false
  foldedRanges(state).between(line.to, Math.min(state.doc.length, task.subtreeEnd), (from, to) => {
    if (from <= line.to && to >= task.subtreeEnd) folded = true
  })
  return folded
}

export function toggleTaskSubtreeFold(view: EditorView, taskLine: number): boolean {
  const tasks = parseTasks(view.state.doc.toString())
  const task = tasks.find(item => item.line === taskLine)
  if (!task || !task.subRange) return false
  const line = view.state.doc.line(task.line + 1)
  const foldFrom = line.to
  const foldTo = Math.min(view.state.doc.length, task.subtreeEnd)
  if (foldTo <= foldFrom) return false

  if (isTaskSubtreeFolded(view.state, task)) {
    view.dispatch({ effects: unfoldEffect.of({ from: foldFrom, to: foldTo }) })
  } else {
    view.dispatch({ effects: foldEffect.of({ from: foldFrom, to: foldTo }) })
  }
  return true
}

export class OutlinerBulletWidget extends WidgetType {
  constructor(
    readonly hasChildren: boolean,
    readonly folded: boolean,
    readonly subCount: number,
    readonly taskLabel: string,
    readonly zoomLabel: string,
    readonly foldLabel: string,
    readonly canZoom: boolean,
    readonly onZoom?: (line: number) => void
  ) {
    super()
  }

  eq(other: OutlinerBulletWidget): boolean {
    return (
      this.hasChildren === other.hasChildren &&
      this.folded === other.folded &&
      this.subCount === other.subCount &&
      this.taskLabel === other.taskLabel &&
      this.canZoom === other.canZoom
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'note-bullet-group' +
      (this.hasChildren ? ' has-children' : '') +
      (this.folded ? ' is-folded' : '')

    if (this.hasChildren) {
      const toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'note-fold-toggle'
      toggle.title = this.foldLabel
      toggle.setAttribute('aria-label', `${this.taskLabel}: ${this.foldLabel}`)
      toggle.setAttribute('aria-expanded', this.folded ? 'false' : 'true')
      toggle.textContent = this.folded ? '▸' : '▾'
      toggle.addEventListener('mousedown', event => {
        event.preventDefault()
        event.stopPropagation()
        const pos = view.posAtDOM(wrap)
        const lineIndex = view.state.doc.lineAt(pos).number - 1
        toggleTaskSubtreeFold(view, lineIndex)
      })
      wrap.append(toggle)
    }

    if (this.canZoom && this.onZoom) {
      const bullet = document.createElement('button')
      bullet.type = 'button'
      bullet.className = 'note-bullet-dot' + (this.hasChildren ? ' is-ringed' : '')
      bullet.title = this.zoomLabel
      bullet.setAttribute('aria-label', `${this.taskLabel}: ${this.zoomLabel}`)
      const inner = document.createElement('i')
      inner.setAttribute('aria-hidden', 'true')
      bullet.append(inner)
      bullet.addEventListener('mousedown', event => {
        event.preventDefault()
        event.stopPropagation()
        const pos = view.posAtDOM(wrap)
        const lineIndex = view.state.doc.lineAt(pos).number - 1
        this.onZoom?.(lineIndex)
      })
      wrap.append(bullet)
    }

    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }
}

export function dailyNoteFoldingExtension(callbacks: RefObject<OutlinerFoldCallbacks>): Extension {
  return codeFolding({
    placeholderDOM(view, onclick) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'note-fold-chip'
      chip.title = callbacks.current.copy.unfoldSubnotes
      chip.setAttribute('aria-label', callbacks.current.copy.unfoldSubnotes)
      chip.textContent = '…'
      chip.addEventListener('mousedown', event => {
        event.preventDefault()
        onclick(event)
      })
      // Keep the editor focused after unfolding via placeholder click.
      chip.addEventListener('click', () => view.focus())
      return chip
    }
  })
}
