import { expect, it } from 'vitest'
import { protectedRoomDialogHtml } from './protected-room-dialog-html'
it('renders untrusted command text as escaped data with a single-purpose isolated action bridge', () => {
  const html = protectedRoomDialogHtml({ title: '需要确认', subtitle: 'bash', body: '</script><script>steal()</script>',
    workspaceLabel: '目录', footnote: '仅本次', confirmLabel: '允许一次', cancelLabel: '取消', dark: false }, 'trusted-nonce')
  expect(html).not.toContain('</script><script>steal()')
  expect(html).toContain('\\u003c/script>')
  expect(html).toContain("default-src 'none'")
  expect(html).toContain('event.isTrusted')
  expect(html).not.toContain('window.kunGui')
  expect(html).not.toContain('innerHTML')
})
