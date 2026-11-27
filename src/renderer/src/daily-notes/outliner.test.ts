/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { cmMarkdownExt } from './outliner-test-helpers'
import {
  cycleDailyNoteTodo,
  handleDailyNoteEnter,
  indentDailyNoteLine,
  moveDailyNoteBlock,
  outdentDailyNoteLine
} from './outliner-keymap'
import { isTaskSubtreeFolded, toggleTaskSubtreeFold } from './outliner-fold'
import {
  applyNoteChange,
  buildDailyNoteTaskPrompt,
  extractDailyNoteTaskSubtree,
  moveDailyNoteTaskBlockChange,
  parseTasks,
  replaceDailyNoteTaskSubtreeChange,
  rolloverIncompleteDailyNoteTasks,
  setDailyNoteTaskTitleChange
} from './tasks'

function makeView(doc: string, cursorOffset = doc.length): EditorView {
  const host = document.createElement('div')
  return new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(cursorOffset),
      extensions: cmMarkdownExt()
    })
  })
}

describe('daily notes subtree, prompt builder, and block move contracts', () => {
  it('tracks nested sub-tasks, parentLine, and extracts/replaces task subtrees cleanly', () => {
    const md = [
      '- [ ] 重构优化 shortcut-index 同步 !1',
      '  - 根源是 4 个叠加问题',
      '  - [ ] 补齐回归测试',
      '    - 先跑本地 e2e',
      '- [ ] 独立待办 !2'
    ].join('\n')

    const tasks = parseTasks(md)
    expect(tasks).toHaveLength(3)
    expect(tasks[0]).toMatchObject({
      line: 0,
      indent: 0,
      parentLine: null,
      subLineCount: 3
    })
    expect(tasks[1]).toMatchObject({
      line: 2,
      indent: 2,
      parentLine: 0,
      subLineCount: 1
    })
    expect(tasks[2]).toMatchObject({
      line: 4,
      indent: 0,
      parentLine: null,
      subLineCount: 0
    })

    const sub = extractDailyNoteTaskSubtree(md, tasks[0])
    expect(sub).toBe([
      '- 根源是 4 个叠加问题',
      '- [ ] 补齐回归测试',
      '  - 先跑本地 e2e'
    ].join('\n'))

    // Updating title preserves link/quadrant and subtree.
    const renamed = applyNoteChange(md, setDailyNoteTaskTitleChange(tasks[0], '重构 shortcut 同步'))
    expect(renamed.split('\n')[0]).toBe('- [ ] 重构 shortcut 同步 !1')

    // Updating subtree re-indents cleanly and clears when emptied.
    const updatedSub = applyNoteChange(md, replaceDailyNoteTaskSubtreeChange(md, tasks[0], '- 新方案单流收敛\n- [x] 验证通过'))
    expect(updatedSub).toBe([
      '- [ ] 重构优化 shortcut-index 同步 !1',
      '  - 新方案单流收敛',
      '  - [x] 验证通过',
      '- [ ] 独立待办 !2'
    ].join('\n'))

    const clearedSub = applyNoteChange(updatedSub, replaceDailyNoteTaskSubtreeChange(updatedSub, parseTasks(updatedSub)[0], '   \n '))
    expect(clearedSub).toBe('- [ ] 重构优化 shortcut-index 同步 !1\n- [ ] 独立待办 !2')
  })

  it('builds hierarchical prompts with optional parent context and rolls over subtrees intact', () => {
    const md = [
      '- [ ] e2ee 模式过一遍主路径 !1',
      '  - [ ] 多人协作路径走通',
      '    - 检查邀请与配对恢复'
    ].join('\n')
    const tasks = parseTasks(md)
    expect(buildDailyNoteTaskPrompt(md, tasks[1], { includeParents: false })).toBe([
      '- 多人协作路径走通',
      '  - 检查邀请与配对恢复'
    ].join('\n'))
    expect(buildDailyNoteTaskPrompt(md, tasks[1], { includeParents: true })).toBe([
      '- e2ee 模式过一遍主路径',
      '  - 多人协作路径走通',
      '    - 检查邀请与配对恢复'
    ].join('\n'))

    const rolled = rolloverIncompleteDailyNoteTasks(md, '')
    expect(rolled.movedCount).toBe(1)
    expect(rolled.nextFrom).toBe('')
    expect(rolled.nextTo).toBe(md)
  })

  it('swaps sibling tasks together with their entire subtrees', () => {
    const md = [
      '- [ ] Task A !1',
      '  - Note A1',
      '- [ ] Task B !2',
      '  - Note B1',
      '  - Note B2'
    ].join('\n')

    const down = moveDailyNoteTaskBlockChange(md, 0, 1)!
    expect(down.nextLine).toBe(3)
    const afterDown = applyNoteChange(md, down.change)
    expect(afterDown).toBe([
      '- [ ] Task B !2',
      '  - Note B1',
      '  - Note B2',
      '- [ ] Task A !1',
      '  - Note A1'
    ].join('\n'))
  })
})

describe('CodeMirror outliner keymap and subtree folding', () => {
  it('cycles Mod-Enter through plain text -> todo -> done -> plain text', () => {
    const view = makeView('整理发布说明', 3)
    cycleDailyNoteTodo(view)
    expect(view.state.doc.toString()).toBe('- [ ] 整理发布说明')
    cycleDailyNoteTodo(view)
    expect(view.state.doc.toString()).toBe('- [x] 整理发布说明')
    cycleDailyNoteTodo(view)
    expect(view.state.doc.toString()).toBe('整理发布说明')
    view.destroy()
  })

  it('continues tasks on Enter while keeping metadata in place, and exits empty tasks cleanly', () => {
    const view = makeView('- [ ] 修复构建 [小Kun](kun://thread/t1) !1')
    expect(handleDailyNoteEnter(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('- [ ] 修复构建 [小Kun](kun://thread/t1) !1\n- [ ] ')

    // Indent into a sub-task, then Enter on empty sub-task outdents first, then exits to plain line.
    indentDailyNoteLine(view)
    expect(view.state.doc.toString()).toBe('- [ ] 修复构建 [小Kun](kun://thread/t1) !1\n  - [ ] ')
    handleDailyNoteEnter(view)
    expect(view.state.doc.toString()).toBe('- [ ] 修复构建 [小Kun](kun://thread/t1) !1\n- [ ] ')
    handleDailyNoteEnter(view)
    expect(view.state.doc.toString()).toBe('- [ ] 修复构建 [小Kun](kun://thread/t1) !1\n')
    view.destroy()
  })

  it('indents, outdents, folds/unfolds subtrees, and moves task blocks with Mod+Shift+Up/Down', () => {
    const view = makeView([
      '- [ ] 第一项',
      '  - 子说明 1',
      '  - [ ] 子待办 2',
      '- [ ] 第二项'
    ].join('\n'), 8)

    expect(toggleTaskSubtreeFold(view, 0)).toBe(true)
    expect(isTaskSubtreeFolded(view.state, parseTasks(view.state.doc.toString())[0])).toBe(true)
    expect(toggleTaskSubtreeFold(view, 0)).toBe(true)
    expect(isTaskSubtreeFolded(view.state, parseTasks(view.state.doc.toString())[0])).toBe(false)

    // Move first task block down below second task.
    moveDailyNoteBlock(view, 1)
    expect(view.state.doc.toString()).toBe([
      '- [ ] 第二项',
      '- [ ] 第一项',
      '  - 子说明 1',
      '  - [ ] 子待办 2'
    ].join('\n'))

    outdentDailyNoteLine(view)
    view.destroy()
  })
})
