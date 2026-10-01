// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { protectedRoomDialogHtml, type ProtectedRoomDialogContent } from './protected-room-dialog-html'

const content: ProtectedRoomDialogContent = {
  title: '需要你确认', subtitle: '整理项目 · bash', body: 'git status --short', kind: 'command',
  description: '读取当前工作区的修改状态。', workspace: '/Users/example/project', workspaceLabel: '作用目录',
  footnote: '仅决定本次操作，不改变后续权限。', confirmLabel: '允许一次', cancelLabel: '取消', dark: false, language: 'zh'
}

const cleanup: Array<() => void> = []
beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1 })
})

function mount(patch: Partial<ProtectedRoomDialogContent> = {}) {
  const html = protectedRoomDialogHtml({ ...content, ...patch }, 'trusted-nonce')
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  document.documentElement.lang = parsed.documentElement.lang
  document.documentElement.dataset.theme = parsed.documentElement.dataset.theme
  document.body.innerHTML = parsed.body.innerHTML
  const confirm = vi.fn()
  Object.defineProperty(window, 'kunProtectedRoom', { configurable: true, value: { confirm } })
  const add = vi.spyOn(document, 'addEventListener')
  const windowAdd = vi.spyOn(window, 'addEventListener')
  // Run only the host-authored script; action strings remain serialized data.
  const run = new Function(parsed.querySelector('script')!.textContent!)
  run()
  const handler = add.mock.calls.find(([type]) => type === 'keydown')?.[1] as EventListener
  const resize = windowAdd.mock.calls.find(([type]) => type === 'resize')?.[1] as EventListener
  cleanup.push(() => window.removeEventListener('resize', resize))
  windowAdd.mockRestore()
  add.mockRestore()
  document.removeEventListener('keydown', handler)
  return { html, confirm, key: (key: string, shiftKey = false, isTrusted = true) => {
    const preventDefault = vi.fn()
    handler({ key, shiftKey, isTrusted, preventDefault } as unknown as Event)
    return preventDefault
  } }
}

function button(id: 'cancel' | 'confirm'): HTMLButtonElement {
  return document.getElementById(id) as HTMLButtonElement
}
function trustedClick(id: 'cancel' | 'confirm'): void {
  button(id).onclick!.call(button(id), { isTrusted: true } as PointerEvent)
}
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose())
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('protected approval content and appearance', () => {
  it('keeps command, paths and optional descriptions as plain text with nonce-only CSP', () => {
    const attack = '</script><script>steal()</script><img src=x onerror=steal()>'
    const { html } = mount({ body: attack, description: attack, details: attack })
    expect(document.getElementById('body')?.textContent).toBe(attack)
    expect(document.getElementById('details-body')?.textContent).toBe(attack)
    expect(document.querySelector('img')).toBeNull()
    expect(html).not.toContain('</script><script>steal()')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('window.kunGui')
    expect(html).not.toContain('innerHTML')
  })

  it('preserves every target, provides theme/language metadata and starts with details collapsed', () => {
    const body = Array.from({ length: 16 }, (_, index) => `/project/very-long-path/${index}/file.txt`).join('\n')
    mount({ body, dark: true, details: 'Full operation parameters', detailsLabel: '查看参数' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.lang).toBe('zh')
    expect(document.getElementById('body')?.textContent).toBe(body)
    expect(document.getElementById('workspace-value')?.textContent).toBe(content.workspace)
    expect(document.querySelector('details')?.open).toBe(false)
    expect(document.querySelector('details')?.hidden).toBe(false)
    expect(document.getElementById('details-label')?.textContent).toBe('查看参数')
    expect(document.querySelector('[data-protected-confirmation]')?.getAttribute('role')).toBe('dialog')
    expect(document.querySelector('.heading-icon svg')).not.toBeNull()
    expect(document.querySelector('.heading-icon')?.textContent).not.toContain('✓')
    expect(document.activeElement).toBe(button('cancel'))
  })

  it('keeps legacy Rooms content compatible and hides absent regions', () => {
    mount({ language: undefined, kind: undefined, description: undefined, workspace: undefined, details: undefined })
    expect(document.documentElement.lang).toBe('zh')
    expect(document.querySelector<HTMLElement>('#description')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#workspace')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#details')?.hidden).toBe(true)
    expect(document.getElementById('body-label')?.textContent).toBe('操作详情')
    expect(button('cancel').hidden).toBe(false)
  })

  it('renders notices with one focused OK button and no empty action card', () => {
    mount({ variant: 'notice', language: 'en', body: '', description: 'Changes saved.', confirmLabel: 'OK', footnote: '' })
    expect(document.documentElement.lang).toBe('en')
    expect(button('cancel').hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#action-card')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#details')?.hidden).toBe(true)
    expect(document.activeElement).toBe(button('confirm'))
  })

  it('rejects nonce values that could escape CSP attributes', () => {
    expect(() => protectedRoomDialogHtml(content, '" onload=steal()')).toThrow('Invalid protected dialog nonce')
  })

  it('keeps a complete long business message in a bounded scrollable header', () => {
    const title = 'Long confirmation title with a complete file scope. '.repeat(80)
    const { html } = mount({ title, body: '', description: '', variant: 'confirmation' })
    expect(document.getElementById('title')?.textContent).toBe(title)
    expect(html).toMatch(/header \{[^}]*max-height: 40%;[^}]*overflow-y: auto;/)
    expect(html).toMatch(/footer \{ flex: none;/)
    const header = document.getElementById('dialog-header')!
    Object.defineProperties(header, { scrollHeight: { value: 900 }, clientHeight: { value: 180 } })
    window.dispatchEvent(new Event('resize'))
    expect(header.tabIndex).toBe(0)
    expect(button('cancel').disabled).toBe(false)
    expect(button('confirm').disabled).toBe(false)
  })

  it('reserves the existing amber emphasis for permissions and leaves the action button neutral', () => {
    const { html } = mount({ kind: 'permissions', accent: true })
    expect(document.querySelector('main')?.dataset.emphasis).toBe('permissions')
    expect(html).toContain('[data-emphasis="permissions"] .heading-icon')
    expect(html).toContain('button.primary { border-color: transparent; background: var(--ds-control);')
    mount({ kind: 'command', accent: true })
    expect(document.querySelector('main')?.dataset.emphasis).toBe('none')
  })
})

describe('protected approval decisions and keyboard behavior', () => {
  it('ignores synthetic actions and passes the nonce once after an actual confirmation', () => {
    const { confirm, key } = mount()
    button('confirm').click()
    key('Escape', false, false)
    expect(confirm).not.toHaveBeenCalled()
    trustedClick('confirm')
    trustedClick('confirm')
    trustedClick('cancel')
    expect(confirm).toHaveBeenCalledExactlyOnceWith(true, 'trusted-nonce')
    expect(button('confirm').disabled).toBe(true)
    expect(button('cancel').disabled).toBe(true)
    expect(document.querySelector('main')?.getAttribute('aria-busy')).toBe('true')
  })

  it('cancels without changing the decision when Escape or Cancel is used', () => {
    const { confirm, key } = mount()
    key('Enter')
    expect(confirm).not.toHaveBeenCalled()
    const preventDefault = key('Escape')
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(confirm).toHaveBeenCalledExactlyOnceWith(false, 'trusted-nonce')
    const next = mount()
    trustedClick('cancel')
    expect(next.confirm).toHaveBeenCalledExactlyOnceWith(false, 'trusted-nonce')
  })

  it('cycles Tab within visible controls and keeps hidden details out of the focus order', () => {
    const { key } = mount()
    button('confirm').focus()
    expect(key('Tab')).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(document.getElementById('body'))
    expect(key('Tab', true)).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(button('confirm'))
    const next = mount({ variant: 'notice', body: '', workspace: undefined })
    expect(next.key('Tab')).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(button('confirm'))
    expect(next.key('Tab', true)).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(button('confirm'))
  })
})
