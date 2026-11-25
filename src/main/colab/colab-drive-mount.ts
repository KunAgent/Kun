import { spawn, type ChildProcess } from 'node:child_process'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { shell } from 'electron'
import type {
  ColabDriveMountResult,
  ColabDriveMountState
} from '../../shared/colab/colab-notebook-types'
import {
  buildDriveMountSessionPython,
  buildDriveProbeSessionPython,
  buildDriveUnmountSessionPython,
  checkedDriveAuthUrl,
  DRIVE_AUTH_WAIT_TIMEOUT_MS,
  parseDriveMountMarkerLine,
  sanitizeDriveMountPoint,
  terminateDriveHelper
} from './colab-drive-protocol'
import type { ColabService } from './colab-service'

export {
  buildDriveFlushSessionPython,
  buildDriveMountSessionPython,
  buildDriveProbeSessionPython,
  buildDriveUnmountSessionPython,
  checkedDriveAuthUrl,
  DRIVE_AUTH_WAIT_TIMEOUT_MS,
  drivefsAuthHookPython,
  driveMountedRootExpr,
  driveRuntimeCleanup,
  driveRuntimeSetup,
  parseDriveMountMarkerLine,
  runSessionDriveFlushHelper,
  sanitizeDriveMountPoint,
  terminateDriveHelper
} from './colab-drive-protocol'

type PreparedEnv = {
  sessionName: string
  connectionId: string
  sessionsJsonPath: string
  env: Record<string, string>
}

type ActiveMountJob = {
  child: ChildProcess
  controller: AbortController
  mountPoint: string
  forceRemount: boolean
  pendingPromise: Promise<ColabDriveMountResult>
  finalPromise: Promise<ColabDriveMountResult>
  settleStep: (result: ColabDriveMountResult) => void
  authorization?: { url: string; expiresAt: number }
  expired?: boolean
}

/** Manages mounting and unmounting Google Drive (/content/drive) on active Colab sessions. */
export class ColabDriveMountManager {
  private readonly states = new Map<string, ColabDriveMountState>()
  private readonly jobs = new Map<string, ActiveMountJob>()
  private readonly listeners = new Set<(state: ColabDriveMountState) => void>()
  private readonly unsubscribeService: () => void
  private shuttingDown = false

  constructor(
    private readonly service: ColabService,
    private readonly openExternal: (url: string) => Promise<void> = (url) => shell.openExternal(url),
    private readonly spawnProcess = spawn
  ) {
    this.unsubscribeService =
      this.service.subscribe?.((snapshot) => {
        const liveIds = new Set(
          snapshot.sessions.filter((s) => s.phase === 'running').map((s) => s.id)
        )
        for (const sessionId of [...this.jobs.keys(), ...this.states.keys()]) {
          if (!liveIds.has(sessionId)) {
            this.jobs.get(sessionId)?.controller.abort()
            this.jobs.delete(sessionId)
            this.states.delete(sessionId)
            this.notifyListeners({ sessionId, status: 'unmounted' })
          }
        }
      }) ?? (() => undefined)
  }

  subscribe(listener: (state: ColabDriveMountState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(state: ColabDriveMountState): void {
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        // Ignore subscriber error.
      }
    }
  }

  private setState(state: ColabDriveMountState): ColabDriveMountState {
    this.states.set(state.sessionId, state)
    this.notifyListeners(state)
    return state
  }

  private async prepareSession(
    sessionId: string
  ): Promise<{ ok: true; data: PreparedEnv } | { ok: false; message: string }> {
    const cliStatus = await this.service.cli.ensureInstalled()
    if (cliStatus.state !== 'ready') {
      return { ok: false, message: cliStatus.message || 'Colab CLI is not ready.' }
    }
    const snapshot = await this.service.getSnapshot()
    const session = snapshot.sessions.find((s) => s.id === sessionId)
    if (!session || session.phase !== 'running') {
      return { ok: false, message: 'Colab runtime is not connected.' }
    }
    const credFile = await this.service.credentials.materializeRuntimeToken(session.connectionId)
    const { paths, env } = await this.service.isolation.prepareConnectionEnvironment(
      session.connectionId,
      credFile
    )
    return {
      ok: true,
      data: {
        sessionName: session.sessionName,
        connectionId: session.connectionId,
        sessionsJsonPath: paths.sessionsJsonPath,
        env
      }
    }
  }

  async getState(
    sessionId: string,
    options?: { probe?: boolean }
  ): Promise<ColabDriveMountState> {
    const existing = this.states.get(sessionId)
    if (
      existing &&
      (existing.status === 'mounting' ||
        existing.status === 'needs_auth' ||
        existing.status === 'unmounting')
    ) {
      return existing
    }
    if (!options?.probe) {
      return existing ?? { sessionId, status: 'unmounted' }
    }
    const prepared = await this.prepareSession(sessionId)
    if (!prepared.ok) return existing ?? { sessionId, status: 'unmounted' }

    const probeRoot =
      existing?.status === 'mounted' ? posix.dirname(existing.mountPath) : '/content/drive'
    const script = buildDriveProbeSessionPython(
      prepared.data.sessionsJsonPath,
      prepared.data.sessionName,
      probeRoot
    )
    const child = this.spawnProcess(this.service.cli.venvPythonPath, ['-c', script], {
      env: prepared.data.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const output = await new Promise<string>((resolve) => {
      let stdout = ''
      const timer = setTimeout(() => terminateDriveHelper(child), 25_000)
      child.stderr?.resume()
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < 64_000) stdout += chunk.toString('utf8')
      })
      child.once('error', () => {
        clearTimeout(timer)
        resolve(stdout)
      })
      child.once('close', () => {
        clearTimeout(timer)
        resolve(stdout)
      })
    })
    await this.service.credentials.syncRuntimeTokenBack(prepared.data.connectionId).catch(() => undefined)

    if (this.jobs.has(sessionId)) {
      return this.states.get(sessionId) ?? { sessionId, status: 'mounting' }
    }

    for (const line of output.split(/\r?\n/)) {
      const marker = parseDriveMountMarkerLine(line)
      if (marker?.kind === 'mounted') {
        const next: ColabDriveMountState =
          marker.mounted && marker.mountPath
            ? { sessionId, status: 'mounted', mountPath: marker.mountPath }
            : { sessionId, status: 'unmounted' }
        return this.setState(next)
      }
    }
    return existing ?? { sessionId, status: 'unmounted' }
  }

  async mount(input: {
    sessionId: string
    forceRemount?: boolean
    mountPoint?: string
  }): Promise<ColabDriveMountResult> {
    const { sessionId } = input
    if (this.shuttingDown) {
      return { ok: false, code: 'canceled', message: 'Colab is shutting down.' }
    }
    const inFlight = this.jobs.get(sessionId)
    if (inFlight) {
      const cur = this.states.get(sessionId)
      if (cur?.status === 'needs_auth') return { ok: true, state: cur }
      return inFlight.pendingPromise
    }

    const prepared = await this.prepareSession(sessionId)
    if (!prepared.ok) {
      return { ok: false, message: prepared.message }
    }

    const recheck = this.jobs.get(sessionId)
    if (recheck) {
      const cur = this.states.get(sessionId)
      if (cur?.status === 'needs_auth') return { ok: true, state: cur }
      return recheck.pendingPromise
    }

    const targetMountPoint = sanitizeDriveMountPoint(input.mountPoint)
    const forceRemount = Boolean(input.forceRemount)
    this.setState({ sessionId, status: 'mounting' })
    const controller = new AbortController()
    const script = buildDriveMountSessionPython(
      prepared.data.sessionsJsonPath,
      prepared.data.sessionName,
      { forceRemount, mountPoint: targetMountPoint }
    )
    const child = this.spawnProcess(this.service.cli.venvPythonPath, ['-c', script], {
      env: prepared.data.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let resolveInitial!: (res: ColabDriveMountResult) => void
    let resolveFinal!: (res: ColabDriveMountResult) => void
    const initialPromise = new Promise<ColabDriveMountResult>((r) => {
      resolveInitial = r
    })
    const finalPromise = new Promise<ColabDriveMountResult>((r) => {
      resolveFinal = r
    })

    const job: ActiveMountJob = {
      child,
      controller,
      mountPoint: targetMountPoint,
      forceRemount,
      pendingPromise: initialPromise,
      finalPromise,
      settleStep: resolveInitial
    }
    this.jobs.set(sessionId, job)

    const decoder = new StringDecoder('utf8')
    let remainder = ''
    let authExpiry = 0
    let timer: ReturnType<typeof setTimeout>
    let finished = false
    let outcome: ColabDriveMountResult = {
      ok: false,
      message: 'Could not mount Google Drive on this runtime.'
    }

    const abortHelper = (): void => terminateDriveHelper(child)
    const resetTimer = (ms: number, expireAuth = false): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (expireAuth) job.expired = true
        else outcome = { ok: false, message: 'Mounting Google Drive timed out. Try again.' }
        abortHelper()
      }, ms)
    }

    resetTimer(90_000)
    controller.signal.addEventListener('abort', abortHelper, { once: true })
    child.stdin?.on('error', () => undefined)
    child.stderr?.resume()

    const acceptLine = (line: string): void => {
      if (controller.signal.aborted) return
      const marker = parseDriveMountMarkerLine(line)
      if (!marker) return
      if (marker.kind === 'auth') {
        const url = checkedDriveAuthUrl(marker.uri)
        if (!url) {
          outcome = { ok: false, message: 'Google returned an unusable Drive authorization link.' }
          abortHelper()
          return
        }
        const firstPrompt = authExpiry === 0
        if (firstPrompt) authExpiry = Date.now() + DRIVE_AUTH_WAIT_TIMEOUT_MS
        resetTimer(Math.max(0, authExpiry - Date.now()), true)
        job.authorization = { url, expiresAt: authExpiry }
        const authState = this.setState({
          sessionId,
          status: 'needs_auth',
          authUrl: url,
          expiresAt: authExpiry
        })
        if (firstPrompt) {
          job.settleStep({ ok: true, state: authState })
          void this.openMountAuth({ sessionId })
        } else {
          job.settleStep({
            ok: false,
            code: 'auth_incomplete',
            message: 'Google has not confirmed Drive access yet. Complete authorization in your browser and try again.',
            state: authState
          })
        }
      } else if (marker.kind === 'auth_ok') {
        delete job.authorization
        job.pendingPromise = job.finalPromise
        resetTimer(90_000, false)
        this.setState({ sessionId, status: 'mounting' })
      } else if (marker.kind === 'mounted' && marker.mounted && marker.mountPath) {
        delete job.authorization
        const mountedState = this.setState({
          sessionId,
          status: 'mounted',
          mountPath: marker.mountPath
        })
        outcome = { ok: true, state: mountedState }
      } else if (marker.kind === 'error') {
        const incomplete = marker.message.includes('authorization not completed')
        outcome = {
          ok: false,
          ...(incomplete ? { code: 'auth_incomplete' as const } : {}),
          message: incomplete
            ? 'Google has not authorized Drive access. Try again with the selected Google account.'
            : marker.message || 'Could not mount Google Drive.'
        }
      }
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = (remainder + decoder.write(chunk)).split(/\r?\n/)
      remainder = (lines.pop() ?? '').slice(0, 256_000)
      lines.forEach(acceptLine)
    })

    const finish = (): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abortHelper)
      const tail = remainder + decoder.end()
      if (tail) acceptLine(tail)
      if (this.jobs.get(sessionId) === job) {
        this.jobs.delete(sessionId)
      }
      void this.service.credentials
        .syncRuntimeTokenBack(prepared.data.connectionId)
        .catch(() => undefined)
        .finally(() => {
          let finalResult = outcome
          if (controller.signal.aborted) {
            const state = this.setState(
              job.expired
                ? {
                    sessionId,
                    status: 'error',
                    code: 'auth_expired',
                    message: 'Google Drive authorization expired. Try mounting again.'
                  }
                : { sessionId, status: 'unmounted' }
            )
            finalResult = job.expired
              ? {
                  ok: false,
                  code: 'auth_expired',
                  message: 'Google Drive authorization expired. Try mounting again.',
                  state
                }
              : { ok: false, code: 'canceled', message: 'Google Drive mount canceled.', state }
          } else if (!finalResult.ok) {
            const errState = this.setState({
              sessionId,
              status: 'error',
              message: finalResult.message,
              ...(finalResult.code ? { code: finalResult.code } : {})
            })
            finalResult = { ...finalResult, state: errState }
          }
          job.settleStep(finalResult)
          resolveFinal(finalResult)
        })
    }

    child.once('close', finish)
    child.once('error', finish)
    return initialPromise
  }

  async completeMountAuth({ sessionId }: { sessionId: string }): Promise<ColabDriveMountResult> {
    const job = this.jobs.get(sessionId)
    if (!job || job.controller.signal.aborted) {
      const current = this.states.get(sessionId)
      if (current?.status === 'mounted') return { ok: true, state: current }
      return {
        ok: false,
        code: 'auth_expired',
        message: 'No active Google Drive authorization is waiting for confirmation.'
      }
    }
    if (!job.authorization) {
      return job.finalPromise
    }
    if (Date.now() >= job.authorization.expiresAt) {
      job.expired = true
      job.controller.abort()
      return job.finalPromise
    }
    if (!job.child.stdin?.writable) {
      return { ok: false, message: 'The authorization session is no longer active.' }
    }
    delete job.authorization
    this.setState({ sessionId, status: 'mounting' })
    const stepPromise = new Promise<ColabDriveMountResult>((resolve) => {
      job.settleStep = resolve
      job.child.stdin!.write('CONTINUE\n')
    })
    job.pendingPromise = stepPromise
    return stepPromise
  }

  async openMountAuth({ sessionId }: { sessionId: string }): Promise<{ ok: boolean }> {
    const job = this.jobs.get(sessionId)
    const auth = job?.authorization
    if (!auth || job?.controller.signal.aborted || Date.now() >= auth.expiresAt) {
      return { ok: false }
    }
    return this.openExternal(auth.url)
      .then(() => ({ ok: true }))
      .catch(() => ({ ok: false }))
  }

  cancelMount({ sessionId }: { sessionId: string }): ColabDriveMountState {
    const job = this.jobs.get(sessionId)
    if (job) {
      job.controller.abort()
      this.jobs.delete(sessionId)
    }
    return this.setState({ sessionId, status: 'unmounted' })
  }

  /** Used by ColabNotebookKernel when a cell executes `drive.mount(...)`: waits through browser auth if required. */
  async ensureMountedForKernel(
    sessionId: string,
    options?: {
      forceRemount?: boolean
      mountPoint?: string
      signal?: AbortSignal
      onNeedsAuth?: (authUrl: string) => void
    }
  ): Promise<ColabDriveMountResult> {
    if (options?.signal?.aborted) {
      return { ok: false, code: 'canceled', message: 'Execution interrupted.' }
    }
    const targetMountPoint = sanitizeDriveMountPoint(options?.mountPoint)
    const wantForce = Boolean(options?.forceRemount)
    const onAbort = (): void => {
      this.cancelMount({ sessionId })
    }
    options?.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const preExistingJob = this.jobs.get(sessionId)
      const needsForceFollowUp = Boolean(
        preExistingJob && wantForce && !preExistingJob.forceRemount
      )
      const runOnce = async (): Promise<ColabDriveMountResult> => {
        const started = await this.mount({
          sessionId,
          forceRemount: wantForce,
          mountPoint: targetMountPoint
        })
        if (!started.ok || started.state.status === 'mounted') return started
        if (started.state.status === 'needs_auth') {
          options?.onNeedsAuth?.(started.state.authUrl)
        }
        const active = this.jobs.get(sessionId)
        return active ? await active.finalPromise : started
      }
      const first = await runOnce()
      const mountPointMismatch =
        first.ok &&
        first.state.status === 'mounted' &&
        posix.dirname(first.state.mountPath) !== targetMountPoint
      if (!first.ok || (!needsForceFollowUp && !mountPointMismatch) || options?.signal?.aborted) {
        return first
      }
      return await runOnce()
    } finally {
      options?.signal?.removeEventListener('abort', onAbort)
    }
  }

  async unmount({ sessionId }: { sessionId: string }): Promise<ColabDriveMountResult> {
    const existingJob = this.jobs.get(sessionId)
    if (existingJob) {
      existingJob.controller.abort()
      this.jobs.delete(sessionId)
    }
    const prepared = await this.prepareSession(sessionId)
    if (!prepared.ok) return { ok: false, message: prepared.message }

    this.setState({ sessionId, status: 'unmounting' })
    const script = buildDriveUnmountSessionPython(
      prepared.data.sessionsJsonPath,
      prepared.data.sessionName
    )
    const child = this.spawnProcess(this.service.cli.venvPythonPath, ['-c', script], {
      env: prepared.data.env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const output = await new Promise<string>((resolve) => {
      let stdout = ''
      const timer = setTimeout(() => terminateDriveHelper(child), 120_000)
      child.stderr?.resume()
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < 64_000) stdout += chunk.toString('utf8')
      })
      child.once('error', () => {
        clearTimeout(timer)
        resolve(stdout)
      })
      child.once('close', () => {
        clearTimeout(timer)
        resolve(stdout)
      })
    })
    await this.service.credentials.syncRuntimeTokenBack(prepared.data.connectionId).catch(() => undefined)

    for (const line of output.split(/\r?\n/)) {
      const marker = parseDriveMountMarkerLine(line)
      if (marker?.kind === 'error') {
        const message = marker.message || 'Could not unmount Google Drive.'
        const errState = this.setState({ sessionId, status: 'error', message })
        return { ok: false, message, state: errState }
      }
    }
    const state = this.setState({ sessionId, status: 'unmounted' })
    return { ok: true, state }
  }

  shutdown(): void {
    this.shuttingDown = true
    this.unsubscribeService()
    for (const job of this.jobs.values()) {
      job.controller.abort()
    }
    this.jobs.clear()
  }
}
