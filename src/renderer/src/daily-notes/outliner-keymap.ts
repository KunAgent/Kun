import { EditorSelection, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { unfoldEffect } from '@codemirror/language'
import { moveDailyNoteTaskBlockChange, parseTasks } from './tasks'

const TASK_PREFIX = /^(\s*)([-+*])\s+\[([ xX])\](\s*)(.*)$/
const BULLET_PREFIX = /^(\s*)([-+*])\s+(.*)$/

/**
 * Cycles each selected line through: plain text -> `- [ ] ` -> `- [x] ` -> plain text.
 */
export function cycleDailyNoteTodo(view: EditorView): boolean {
  const { state } = view
  const lineNums = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let n = startLine; n <= endLine; n++) lineNums.add(n)
  }

  const changes: Array<{ from: number; to: number; insert: string }> = []
  let singleLineCursorDelta = 0
  const sorted = [...lineNums].sort((a, b) => a - b)

  for (const num of sorted) {
    const line = state.doc.line(num)
    const taskMatch = TASK_PREFIX.exec(line.text)
    if (taskMatch) {
      const indent = taskMatch[1]
      const checked = taskMatch[3] !== ' '
      if (!checked) {
        const markerPos = line.from + indent.length + taskMatch[2].length + 2
        changes.push({ from: markerPos, to: markerPos + 1, insert: 'x' })
      } else {
        const prefixLen = indent.length + taskMatch[2].length + 4 + (taskMatch[4] ? 1 : 0)
        const replaceTo = Math.min(line.to, line.from + prefixLen)
        changes.push({ from: line.from + indent.length, to: replaceTo, insert: '' })
        singleLineCursorDelta = -(replaceTo - (line.from + indent.length))
      }
      continue
    }

    const bulletMatch = BULLET_PREFIX.exec(line.text)
    if (bulletMatch) {
      const indent = bulletMatch[1]
      const markerEnd = line.from + indent.length + bulletMatch[2].length + 1
      const insert = '- [ ] '
      changes.push({ from: line.from + indent.length, to: markerEnd, insert })
      singleLineCursorDelta = insert.length - (markerEnd - (line.from + indent.length))
      continue
    }

    const indent = /^\s*/.exec(line.text)![0]
    const insert = '- [ ] '
    changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert })
    singleLineCursorDelta = insert.length
  }

  if (changes.length === 0) return false
  const main = state.selection.main
  const spec: TransactionSpec = { changes, userEvent: 'input' }
  if (sorted.length === 1 && main.empty) {
    const line = state.doc.line(sorted[0])
    const nextPos = Math.max(line.from, main.head + singleLineCursorDelta)
    spec.selection = EditorSelection.cursor(nextPos)
  }
  view.dispatch(spec)
  return true
}

/**
 * Outliner-aware Enter:
 * - On an empty task/bullet: outdents if nested, or exits list/task mode at root.
 * - On a non-empty task: starts a sibling `- [ ] ` while keeping trailing link/quadrant metadata on the original task.
 * - On a non-empty bullet: starts a sibling `- `.
 */
export function handleDailyNoteEnter(view: EditorView): boolean {
  if (view.composing) return false
  const { state } = view
  const main = state.selection.main
  if (!main.empty) return false

  const line = state.doc.lineAt(main.head)
  const taskMatch = TASK_PREFIX.exec(line.text)
  if (taskMatch) {
    const indent = taskMatch[1]
    const bullet = taskMatch[2]
    const parsed = parseTasks(line.text)[0]
    const bodyText = parsed ? parsed.text : taskMatch[5].trim()

    if (!bodyText && !parsed?.link && !parsed?.quadrant) {
      if (indent.length >= 2) {
        const nextText = line.text.slice(2)
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: nextText },
          selection: EditorSelection.cursor(line.from + nextText.length),
          scrollIntoView: true,
          userEvent: 'input'
        })
      } else {
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: '' },
          selection: EditorSelection.cursor(line.from),
          scrollIntoView: true,
          userEvent: 'input'
        })
      }
      return true
    }

    const prefix = `${indent}${bullet} [ ] `
    const bodyStart = parsed ? line.from + parsed.bodyFrom : line.from + indent.length + 5
    const metaStart = parsed ? line.from + parsed.metaFrom : line.to

    if (main.head <= bodyStart) {
      view.dispatch({
        changes: { from: line.from, to: line.from, insert: prefix + '\n' },
        selection: EditorSelection.cursor(line.from + prefix.length),
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }

    if (main.head >= metaStart) {
      const insert = '\n' + prefix
      view.dispatch({
        changes: { from: line.to, to: line.to, insert },
        selection: EditorSelection.cursor(line.to + insert.length),
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }

    const tailBody = state.doc.sliceString(main.head, metaStart).trimStart()
    const insertNext = '\n' + prefix + tailBody
    view.dispatch({
      changes: [
        { from: main.head, to: metaStart, insert: '' },
        { from: line.to, to: line.to, insert: insertNext }
      ],
      selection: EditorSelection.cursor(line.to - (metaStart - main.head) + 1 + prefix.length),
      scrollIntoView: true,
      userEvent: 'input'
    })
    return true
  }

  const bulletMatch = BULLET_PREFIX.exec(line.text)
  if (bulletMatch) {
    const indent = bulletMatch[1]
    const bullet = bulletMatch[2]
    const body = bulletMatch[3].trim()
    if (!body) {
      const nextText = indent.length >= 2 ? line.text.slice(2) : ''
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: nextText },
        selection: EditorSelection.cursor(line.from + nextText.length),
        scrollIntoView: true,
        userEvent: 'input'
      })
      return true
    }
    const insert = `\n${indent}${bullet} `
    view.dispatch({
      changes: { from: main.head, to: main.head, insert },
      selection: EditorSelection.cursor(main.head + insert.length),
      scrollIntoView: true,
      userEvent: 'input'
    })
    return true
  }

  return false
}

export function indentDailyNoteLine(view: EditorView): boolean {
  if (view.composing) return false
  const { state } = view
  const lineNums = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let n = startLine; n <= endLine; n++) lineNums.add(n)
  }
  const sorted = [...lineNums].sort((a, b) => a - b)
  const changes = sorted.map(num => {
    const line = state.doc.line(num)
    return { from: line.from, to: line.from, insert: '  ' }
  })
  const effects = []
  if (sorted[0] > 1) {
    const prevLine = state.doc.line(sorted[0] - 1)
    effects.push(unfoldEffect.of({ from: prevLine.to, to: state.doc.line(sorted[sorted.length - 1]).to }))
  }
  view.dispatch({ changes, effects, userEvent: 'input.indent' })
  return true
}

export function outdentDailyNoteLine(view: EditorView): boolean {
  if (view.composing) return false
  const { state } = view
  const lineNums = new Set<number>()
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number
    const endLine = state.doc.lineAt(range.to).number
    for (let n = startLine; n <= endLine; n++) lineNums.add(n)
  }
  const changes: Array<{ from: number; to: number; insert: string }> = []
  for (const num of [...lineNums].sort((a, b) => a - b)) {
    const line = state.doc.line(num)
    const spaces = /^ {1,2}/.exec(line.text)?.[0].length ?? (line.text.startsWith('\t') ? 1 : 0)
    if (spaces > 0) changes.push({ from: line.from, to: line.from + spaces, insert: '' })
  }
  if (changes.length === 0) return true
  view.dispatch({ changes, userEvent: 'delete.dedent' })
  return true
}

export function moveDailyNoteBlock(view: EditorView, direction: -1 | 1): boolean {
  if (view.composing) return false
  const { state } = view
  const head = state.selection.main.head
  const currentLine = state.doc.lineAt(head)
  const lineIndex = currentLine.number - 1
  const colOffset = head - currentLine.from
  const docText = state.doc.toString()

  const tasks = parseTasks(docText)
  // Find the task on this line, or the nearest enclosing task if cursor is on a plain sub-note.
  const exactTask = tasks.find(t => t.line === lineIndex)
  const ownerTask = exactTask ?? [...tasks].reverse().find(t => head >= t.lineFrom && head <= t.subtreeEnd)

  if (ownerTask) {
    const moved = moveDailyNoteTaskBlockChange(docText, ownerTask.line, direction)
    if (!moved) return true
    const nextDoc = docText.slice(0, moved.change.from) + moved.change.insert + docText.slice(moved.change.to)
    const lineDelta = lineIndex - ownerTask.line
    const targetLineNum = Math.max(1, Math.min(nextDoc.split('\n').length, moved.nextLine + 1 + lineDelta))
    const lines = nextDoc.split('\n')
    let targetLineFrom = 0
    for (let i = 0; i < targetLineNum - 1; i++) targetLineFrom += lines[i].length + 1
    const targetLineLen = lines[targetLineNum - 1]?.replace(/\r$/, '').length ?? 0
    const nextHead = targetLineFrom + Math.min(colOffset, targetLineLen)
    view.dispatch({
      changes: moved.change,
      selection: EditorSelection.cursor(nextHead),
      scrollIntoView: true,
      userEvent: 'move'
    })
    return true
  }

  // Fallback: swap plain non-task line with adjacent line.
  const targetNum = currentLine.number + direction
  if (targetNum < 1 || targetNum > state.doc.lines) return true
  const otherLine = state.doc.line(targetNum)
  const first = direction < 0 ? otherLine : currentLine
  const second = direction < 0 ? currentLine : otherLine
  const sep = state.doc.sliceString(first.to, second.from)
  const insert = second.text + sep + first.text
  const nextLineFrom = direction < 0 ? first.from : first.from + second.text.length + sep.length
  view.dispatch({
    changes: { from: first.from, to: second.to, insert },
    selection: EditorSelection.cursor(nextLineFrom + Math.min(colOffset, currentLine.length)),
    scrollIntoView: true,
    userEvent: 'move'
  })
  return true
}
