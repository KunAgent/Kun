import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComposerContextAttachmentSchema } from '@kun/extension-api'
import { pendingWorkerNoticeBundle, postWorkerNoticeHold } from './ade-notices'
import { rendererRuntimeClient } from './runtime-client'

function installDsGui(runtimeRequest: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal('window', {
    kunGui: { runtimeRequest }
  })
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

const pendingBody = {
  notices: [
    { noticeId: 'ntc_1', workerId: 'wrk_1', kind: 'dispatch_completed', title: 'fix login' },
    { noticeId: 'ntc_2', workerId: 'wrk_2', kind: 'question', title: 'need input', detail: 'which env?' }
  ],
  text: '<kun_worker_updates>\n- [Completed] fix login\n</kun_worker_updates>',
  displayText: '2 worker updates'
}

describe('pendingWorkerNoticeBundle', () => {
  it('wraps pending notices in a worker-notices composer context with ack ids', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify(pendingBody)
    }))
    installDsGui(runtimeRequest)

    const bundle = await pendingWorkerNoticeBundle('thr_mgr', '/repo', 'en')

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/teams/thr_mgr/pending-notices?language=en',
      'GET'
    )
    expect(bundle?.ackNoticeIds).toEqual(['ntc_1', 'ntc_2'])
    const context = bundle!.context
    expect(() => ComposerContextAttachmentSchema.parse(context)).not.toThrow()
    expect(context.provenance).toMatchObject({ source: 'worker-notices' })
    expect(context.attachmentId).toMatch(/^worker-notices-context:[a-f0-9]{64}$/)
    expect(context.reference).toMatchObject({
      kind: 'worker-notices',
      text: pendingBody.text
    })
    const notices = (context.reference as { notices: Array<{ noticeId: string }> }).notices
    expect(notices.map((entry) => entry.noticeId)).toEqual(['ntc_1', 'ntc_2'])
  })

  it('returns null when nothing is pending or the request fails', async () => {
    const empty = vi.fn(async () => ({ ok: true, status: 200, body: JSON.stringify({ notices: [] }) }))
    installDsGui(empty)
    expect(await pendingWorkerNoticeBundle('thr_mgr', '/repo')).toBeNull()

    installDsGui(vi.fn(async () => ({ ok: false, status: 503, body: '{}' })))
    expect(await pendingWorkerNoticeBundle('thr_mgr', '/repo')).toBeNull()
  })
})

describe('postWorkerNoticeHold', () => {
  it('posts a bounded hold and swallows failures', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    installDsGui(runtimeRequest)
    await postWorkerNoticeHold('thr_mgr')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/teams/thr_mgr/notice-hold',
      'POST',
      JSON.stringify({ holdMs: 45_000 })
    )
    installDsGui(vi.fn(async () => { throw new Error('offline') }))
    await expect(postWorkerNoticeHold('thr_mgr')).resolves.toBeUndefined()
  })
})
