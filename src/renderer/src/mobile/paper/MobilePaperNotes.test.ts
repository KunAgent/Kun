// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobilePaperNotes } from './MobilePaperNotes'

let root: Root
let host: HTMLDivElement
const read = vi.fn()
const write = vi.fn()
const onDirty = vi.fn()

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  read.mockResolvedValue({ ok: true, path: '/library/papers/x/NOTES.md', content: 'original',
    size: 8, mtimeMs: 7, truncated: false })
  write.mockResolvedValue({ ok: true, path: '/library/papers/x/NOTES.md', savedAt: 'today', mtimeMs: 8 })
  ;(window as unknown as { kunGui: unknown }).kunGui = { readWorkspaceFile: read, writeWorkspaceFile: write }
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  read.mockReset(); write.mockReset(); onDirty.mockReset()
})

async function mount() {
  await act(async () => { root.render(createElement(MobilePaperNotes, {
    workspaceRoot: '/library', unitDir: 'papers/x', onDirty
  })) })
  const textarea = host.querySelector('textarea') as HTMLTextAreaElement
  expect(textarea.value).toBe('original')
  return textarea
}

async function edit(textarea: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('mobile paper notes', () => {
  it('preserves a local edit until a version-checked host save succeeds', async () => {
    const textarea = await mount()
    await edit(textarea, 'changed')
    expect(onDirty).toHaveBeenCalledWith(true)
    const save = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('保存笔记'))!
    await act(async () => save.click())
    expect(write).toHaveBeenCalledWith({ workspaceRoot: '/library', path: '/library/papers/x/NOTES.md',
      content: 'changed', expectedMtimeMs: 7 })
    expect(onDirty).toHaveBeenLastCalledWith(false)
  })

  it('keeps the edited text and dirty guard after a host conflict', async () => {
    write.mockResolvedValue({ ok: false, code: 'modified_on_disk', message: 'changed on host' })
    const textarea = await mount()
    await edit(textarea, 'local draft')
    const save = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('保存笔记'))!
    await act(async () => save.click())
    expect(textarea.value).toBe('local draft')
    expect(onDirty).toHaveBeenLastCalledWith(true)
    expect(host.textContent).toContain('主机笔记已被修改')
  })
})
