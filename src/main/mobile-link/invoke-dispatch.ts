import { randomUUID } from 'node:crypto'
import { validateCall, hasRemoteOperationScope, READ_METHODS, HISTORY_LIVE_CAPABILITY, READ_CONDITIONAL_CAPABILITY, requestControlLane, type Frame, type RemoteApi, type RequestBudget } from '@kun/remote-protocol'
import type { LinkDependencies } from './service-dependencies'
import type { MobileShareHosts } from './share-host'
import type { MobileSubscriptions } from './subscriptions'
import { conditionalCall, conditionalResult } from './read-version'
import { desktopScheduleDescriptors } from './desktop-schedules'
import { appendHostMetadata } from './catalog-metadata'
import { refreshAfterWrite } from './write-refresh'
const CERTAIN_REJECTIONS = new Set(['INVALID_REQUEST', 'REQUEST_EXPIRED', 'AGENT_NOT_AVAILABLE', 'MODEL_NOT_AVAILABLE'])
type Dispatch = { link: LinkDependencies; owner?: string; hostId?: string; api?: RemoteApi; filePeers: Set<string>; requestBudget: RequestBudget; totalRequestBudget: RequestBudget; shared: MobileShareHosts; subscriptions: MobileSubscriptions; authorizationRemaining(): number; terminalAuthorizationRemaining(): number; send(frame: Frame): void }
/** A validated peer invocation has one admission/reply path; desktop OS work is dispatched only in Main. */
export async function dispatchMobileInvoke(frame: Frame, src: string, authority: { id: string; syncKey: string; scopes: import('../../shared/mobile-link-scopes').MobileLinkScope[] }, current: () => boolean, deps: Dispatch) {
    let fileReserved = false
    let release: (() => void) | undefined
    let control: false | true | 'desktop' = false,
      size = 0

    try {
      // An optional read version is answered here; the runtime envelope never sees it.
      const { call, ifVersion } = conditionalCall(validateCall(frame.payload))
      if (call.requestId !== frame.id) throw new Error('INVALID_REQUEST')
      if (!hasRemoteOperationScope(call.method, authority.scopes)) throw new Error('REMOTE_SCOPE_REQUIRED')
      if (call.method.startsWith('attachment.')) {
        if (deps.filePeers.size >= 2 || deps.filePeers.has(src))
          throw new Error('BACKPRESSURE')
        deps.filePeers.add(src)
        fileReserved = true
      }
      control = requestControlLane(call.method)
      size = Buffer.byteLength(JSON.stringify(call))
      const releasePeer = deps.requestBudget.reserve(src, size, control)
      try {
        const releaseTotal = deps.totalRequestBudget.reserve('all', size, control)
        release = () => { releasePeer(); releaseTotal() }
      } catch (error) { releasePeer(); throw error }
      if (call.expiresAt < Date.now() && !READ_METHODS.has(call.method))
        throw new Error('REQUEST_EXPIRED')
      const desktopCall = call.method.startsWith('desktop.') && !call.method.startsWith('desktop.schedule.')
      // Desktop and terminal calls are ephemeral: no runtime lease, no durable receipt.
      const lease = desktopCall || call.method.startsWith('terminal.') ? undefined : await deps.link.lease()
      if (!current()) return
      let result: unknown
      if (
        call.method === 'attachment.receive' ||
        call.method === 'attachment.export'
      ) {
        if (!deps.link.files || !deps.api || !deps.owner)
          throw new Error('UNSUPPORTED_OPERATION')
        result = await deps.link.files(
          {
            api: deps.api,
            peer: src,
            owner: deps.owner,
            authorizationId: authority.id,
            current,
            lease: async () => lease!
          },
          call
        )
      } else if (call.method === 'shares.list' || call.method === 'shares.manage') {
        result = await deps.shared.ownerInvoke(call.method, call, src, current)
      } else if (call.method.startsWith('desktop.') && !call.method.startsWith('desktop.schedule.')) {
        if (!deps.link.desktop || !deps.owner) throw new Error('DESKTOP_UNSUPPORTED')
        result = await deps.link.desktop.invoke(call.method, call.params, { accountId: deps.owner, deviceId: src, authorizationId: authority.id, scopes: authority.scopes, current, validForMs: deps.authorizationRemaining,
          emit: value => { if (current()) deps.send({ kind: 'event', id: randomUUID(), dst: src, payload: value }) } })
      } else if (call.method.startsWith('terminal.')) {
        if (!deps.link.terminal || !deps.owner) throw new Error('TERMINAL_UNSUPPORTED')
        // Stable grant identity permits attach after a socket change; current() still fences old transports.
        result = await deps.link.terminal.invoke(call.method, call.params, { accountId: deps.owner, deviceId: src,
          authorizationId: authority.syncKey, scopes: authority.scopes, current, validForMs: deps.terminalAuthorizationRemaining,
          emit: value => { if (current()) deps.send({ kind: 'event', id: randomUUID(), dst: src, payload: value }) } })
      } else if (call.method.startsWith('desktop.schedule.')) {
        if (!deps.link.desktopSchedules || !deps.owner) throw new Error('UNSUPPORTED_OPERATION')
        result = await deps.link.desktopSchedules(call.method, call.params, {
          accountId: deps.owner, deviceId: src, authorizationId: authority.id, scopes: authority.scopes }, lease!)
      } else {
        const shareReceipt = call.method === 'request.get' ? await deps.shared.ownerInvoke(call.method, call, src, current) : null
        const response = shareReceipt ? { ok: true, status: 200, body: JSON.stringify(shareReceipt) } : await lease!.request(
          '/v1/remote/invoke',
          'POST',
          JSON.stringify({
            accountId: deps.owner,
            deviceId: src,
            authorizationId: authority.id,
            scopes: authority.scopes,
            call
          })
        )
        const value = JSON.parse(response.body)
        if (!response.ok)
          throw new Error(
            typeof value.code === 'string' ? value.code : 'RUNTIME_REJECTED'
          )
        if (call.method === 'catalog.get') value.capabilityDescriptors = [...(value.capabilityDescriptors ?? []),
          ...(deps.link.desktopSchedules ? desktopScheduleDescriptors(authority.scopes) : []), ...deps.shared.descriptors(authority.scopes), ...(deps.link.desktop?.descriptors(authority.scopes) ?? []), ...(deps.link.terminal?.descriptors(authority.scopes) ?? [])]
        if (call.method === 'catalog.get' && Array.isArray(value.capabilities))
          value.capabilities = [...value.capabilities, READ_CONDITIONAL_CAPABILITY, HISTORY_LIVE_CAPABILITY, ...(deps.link.desktop?.capabilities() ?? []), ...(deps.link.terminal?.capabilities(authority.scopes) ?? [])]
        result = call.method === 'catalog.get' ? appendHostMetadata(value, {
          deviceId: deps.hostId, appVersion: deps.link.appVersion, platform: deps.link.platform }) : value
      }
      if (current())
        deps.send({
          kind: 'result',
          id: frame.id,
          dst: src,
          payload: conditionalResult(call.method, result, ifVersion)
        })
      // The phone's own message should reach its live page now, not after the runtime's next event.
      if (current()) refreshAfterWrite(deps.subscriptions, src, call.method, call.params, result)
    } catch (error) {
      if (current()) {
        try {
          const code =
            error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'REMOTE_ERROR'
          deps.send({
            kind: 'result',
            id: frame.id,
            dst: src,
            payload: {
              error: {
                code,
                uncertain:
                  Boolean(release) &&
                  !READ_METHODS.has(frame.payload?.method) &&
                  !CERTAIN_REJECTIONS.has(code)
              }
            }
          })
        } catch { /* best-effort error reply; the peer may be gone */ }
      }
    } finally {
      if (fileReserved) deps.filePeers.delete(src)
      release?.()
    }
}
