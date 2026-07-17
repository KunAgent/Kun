import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import { useCollaborationStore } from './collaboration-store'
import { NetworkCollaborationBar } from './NetworkCollaborationBar'

describe('NetworkCollaborationBar', () => {
  beforeEach(() => {
    useCollaborationStore.setState({
      networkStatus: {
        state: 'disabled', e2eeState: 'setup_required', protocol: 1,
        transport: 'tls13-spki', encryption: 'rfc9420-openmls'
      }
    })
  })

  it('shows explicit TLS and E2EE state without exposing credential fields', () => {
    const html = renderToStaticMarkup(createElement(NetworkCollaborationBar, { meetingId: 'meeting-1' }))
    expect(html).toContain('联网协作')
    expect(html).toContain('TLS 1.3')
    expect(html).toContain('OpenMLS')
    expect(html).not.toContain('accessToken')
  })

  it('offers the built-in local TLS server from server configuration', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => { renderer = create(createElement(NetworkCollaborationBar, { meetingId: 'meeting-1' })) })
    const configure = renderer!.root.findAllByType('button').find((button) => button.props['aria-label'] === '配置服务器')
    await act(async () => configure?.props.onClick())
    expect(renderer!.root.findAllByType('button').some((button) => button.children.includes('启动内置服务'))).toBe(true)
    await act(async () => renderer!.unmount())
  })
})
