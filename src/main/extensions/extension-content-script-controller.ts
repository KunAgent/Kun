import {
  HostContentScriptDiagnosticSchema,
  type HostContentScriptContext
} from '@kun/extension-api'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WebContents } from 'electron'
import type {
  ExtensionHostContentScriptBootstrap,
  ExtensionHostContentScriptBootstrapBinding,
  ExtensionHostContentScriptBridgeRequest,
  ExtensionHostContentScriptDiagnosticRecord,
  ExtensionSyncHostContentScriptsRequest,
  ExtensionSyncHostContentScriptsResult
} from '../../shared/extension-ipc'
import { EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE } from '../../shared/extension-content-script-sources'
import type {
  ExtensionDescriptorResolver,
  ResolvedHostContentScript
} from './extension-descriptor-resolver'
import { resolveKunExtensionResource } from './extension-resource-protocol'

const MAX_CONTENT_SCRIPT_FILE_BYTES = 2 * 1024 * 1024
const MAX_CONTENT_SCRIPT_TOTAL_BYTES = 8 * 1024 * 1024
const MAX_RETAINED_DIAGNOSTICS = 200
const MAX_DIAGNOSTICS_PER_WINDOW = 20
const DIAGNOSTIC_WINDOW_MS = 10_000
const CONTENT_SCRIPT_RELOAD_DELAY_MS = 25
const CONTENT_SCRIPT_REVALIDATE_INTERVAL_MS = 2_000

type PreparedContentScript = {
  key: string
  signature: string
  bindingId: string
  nonce: string
  worldId: number
  context: HostContentScriptContext
  scripts: Array<{ code: string; url: string }>
  styles: Array<{ css: string; url: string }>
  diagnosticWindowStartedAt: number
  diagnosticCount: number
  workspaceRoot?: string
}

type FrameState = {
  frame: WebContents
  generation: string
  desired: Map<string, PreparedContentScript>
  reloadScheduled: boolean
  reloadTimer?: NodeJS.Timeout
  revalidationTimer?: NodeJS.Timeout
  revalidating: boolean
}

export type ExtensionContentScriptControllerOptions = {
  onDiagnostic?: (diagnostic: ExtensionHostContentScriptDiagnosticRecord) => void
  now?: () => number
  scheduleReload?: (callback: () => void) => NodeJS.Timeout
}

/**
 * Owns Direct DOM identity, resource loading, isolated-world assignment and
 * teardown. Renderer descriptors are hints only: every package, permission,
 * workspace and contribution claim is resolved again through Kun.
 *
 * `documentStart` is never approximated with a late Main-process eval. When a
 * newly eligible start script is discovered after the page started, the plan is
 * cached and the workbench is reloaded. The sandboxed preload synchronously
 * obtains that cached plan and schedules the start world before page scripts.
 */
export class ExtensionContentScriptController {
  private readonly frames = new Map<string, FrameState>()
  private readonly worldIds = new Map<string, number>()
  private readonly diagnostics: ExtensionHostContentScriptDiagnosticRecord[] = []
  private readonly now: () => number
  private readonly scheduleReloadCallback: (callback: () => void) => NodeJS.Timeout

  constructor(
    private readonly descriptors: ExtensionDescriptorResolver,
    private readonly options: ExtensionContentScriptControllerOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.scheduleReloadCallback = options.scheduleReload ?? ((callback) => {
      const timer = setTimeout(callback, CONTENT_SCRIPT_RELOAD_DELAY_MS)
      timer.unref?.()
      return timer
    })
  }

  async sync(
    frame: WebContents,
    request: ExtensionSyncHostContentScriptsRequest
  ): Promise<ExtensionSyncHostContentScriptsResult> {
    const surface = request.surface
    if (request.protectedSurface || !surface) {
      this.emit({
        code: request.protectedSurface
          ? 'HOST_DOM_PROTECTED_SURFACE_EXCLUDED'
          : 'HOST_DOM_ROUTE_NOT_SUPPORTED',
        message: request.protectedSurface
          ? 'Host content scripts were excluded from a protected surface.'
          : 'Host content scripts require a supported workbench surface.'
      })
      await this.clearFrame(frame, true, 'protected-or-unsupported-surface')
      return request.protectedSurface
        ? {
            ok: false,
            code: 'EXTENSION_PROTECTED_SURFACE_DENIED',
            message: 'Host content scripts cannot run in a protected surface.',
            reloadScheduled: this.isReloadScheduled(frame)
          }
        : { ok: true, active: [], reloadScheduled: this.isReloadScheduled(frame) }
    }

    const unique = new Map(
      request.descriptors.map((descriptor) => [
        `${descriptor.extensionId}/${descriptor.contributionId}`,
        descriptor
      ])
    )
    try {
      const resolved = await Promise.all(
        [...unique.values()].map((descriptor) => this.descriptors.resolveHostContentScript(
          descriptor.extensionId,
          descriptor.contributionId,
          surface,
          request.workspaceRoot
        ))
      )
      const prepared: PreparedContentScript[] = []
      for (const contribution of resolved) {
        prepared.push(await this.prepareContribution(
          contribution,
          surface,
          request.workspaceRoot
        ))
      }
      const reloadScheduled = await this.applyPrepared(frame, prepared)
      return {
        ok: true,
        active: prepared.map(({ context }) => ({
          extensionId: context.extensionId,
          contributionId: context.contributionId
        })),
        ...(reloadScheduled ? { reloadScheduled: true } : {}),
        diagnostics: this.recentDiagnostics(20)
      }
    } catch (error) {
      const message = boundedErrorMessage(error, 'Content script denied.')
      this.emit({
        code: 'HOST_DOM_RESOLUTION_FAILED',
        message
      })
      // A failed revalidation may be a revoked grant or changed package. Never
      // leave the formerly injected principal active in that ambiguous state.
      await this.clearFrame(frame, true, 'resolution-failed')
      return {
        ok: false,
        code: 'EXTENSION_CONTENT_SCRIPT_DENIED',
        message,
        reloadScheduled: this.isReloadScheduled(frame)
      }
    }
  }

  /** Synchronous, bounded plan consumed only by the trusted workbench preload. */
  bootstrap(frame: WebContents): ExtensionHostContentScriptBootstrap {
    const state = this.frames.get(keyForFrame(frame))
    if (!state || isDestroyed(frame)) {
      return { version: 1, generation: `empty:${frame.id}`, bindings: [] }
    }
    return {
      version: 1,
      generation: state.generation,
      bindings: [...state.desired.values()]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(toBootstrapBinding)
    }
  }

  /**
   * Authenticate the page-local bridge with a Main-held binding/nonce. The
   * request contains no caller-controlled extension or workspace identity.
   */
  handleBridgeRequest(
    frame: WebContents,
    request: ExtensionHostContentScriptBridgeRequest
  ): void {
    const state = this.frames.get(keyForFrame(frame))
    const binding = state
      ? [...state.desired.values()].find((candidate) => candidate.bindingId === request.bindingId)
      : undefined
    if (!binding || !timingSafeStringEqual(binding.nonce, request.nonce)) {
      this.emit({
        code: 'HOST_DOM_BRIDGE_DENIED',
        message: 'A stale or invalid content-script bridge request was denied.'
      })
      throw new Error('Content-script bridge binding is invalid.')
    }

    const now = this.now()
    if (now - binding.diagnosticWindowStartedAt >= DIAGNOSTIC_WINDOW_MS) {
      binding.diagnosticWindowStartedAt = now
      binding.diagnosticCount = 0
    }
    if (binding.diagnosticCount >= MAX_DIAGNOSTICS_PER_WINDOW) {
      this.emit({
        ...identityOf(binding),
        code: 'HOST_DOM_DIAGNOSTIC_RATE_LIMITED',
        message: 'Content-script diagnostics exceeded the bounded rate limit.'
      })
      throw new Error('Content-script diagnostic rate limit exceeded.')
    }
    binding.diagnosticCount += 1
    const diagnostic = HostContentScriptDiagnosticSchema.parse(request.diagnostic)
    this.emit({
      ...identityOf(binding),
      code: 'HOST_DOM_EXTENSION_DIAGNOSTIC',
      message: `[${diagnostic.level}:${diagnostic.code}] ${diagnostic.message}`
    })
  }

  /** Revoke one extension before/after disable, uninstall or grant changes. */
  async revokeExtension(
    frame: WebContents,
    extensionId: string,
    reason: string,
    workspaceRoot?: string
  ): Promise<boolean> {
    const state = this.frames.get(keyForFrame(frame))
    if (!state) return false
    const canonicalWorkspace = workspaceRoot === undefined ? undefined : resolve(workspaceRoot)
    const removed = [...state.desired.values()].filter(
      (binding) =>
        binding.context.extensionId === extensionId &&
        (canonicalWorkspace === undefined || binding.workspaceRoot === canonicalWorkspace)
    )
    if (removed.length === 0) return false
    const desired = new Map(state.desired)
    for (const binding of removed) desired.delete(binding.key)
    state.desired = desired
    state.generation = randomUUID()
    this.updateRevalidation(state)
    await this.deactivateBindings(frame, removed)
    this.emit({
      extensionId,
      code: 'HOST_DOM_PRINCIPAL_REVOKED',
      message: `Content-script access was revoked (${boundedLabel(reason)}); a clean workbench reload is required.`
    })
    this.scheduleReload(state)
    return true
  }

  /** Clear active scripts and reload when this is a live surface. */
  async clearFrame(frame: WebContents, reload: boolean, reason = 'clear'): Promise<void> {
    const state = this.frames.get(keyForFrame(frame))
    if (!state) return
    const active = [...state.desired.values()]
    state.desired = new Map()
    state.generation = randomUUID()
    this.updateRevalidation(state)
    await this.deactivateBindings(frame, active)
    if (reload && active.length > 0 && !isDestroyed(frame)) {
      this.emit({
        code: 'HOST_DOM_CLEANUP_RELOAD',
        message: `Reloading the workbench to remove non-host-managed DOM effects (${boundedLabel(reason)}).`
      })
      this.scheduleReload(state)
    }
  }

  /** Dispose bookkeeping for a destroyed/closing frame; no reload is attempted. */
  async disposeFrame(frame: WebContents): Promise<void> {
    const key = keyForFrame(frame)
    const state = this.frames.get(key)
    if (!state) return
    if (state.reloadTimer) clearTimeout(state.reloadTimer)
    if (state.revalidationTimer) clearInterval(state.revalidationTimer)
    if (!isDestroyed(frame)) {
      await this.deactivateBindings(frame, [...state.desired.values()])
    }
    this.frames.delete(key)
  }

  recentDiagnostics(limit = 50): ExtensionHostContentScriptDiagnosticRecord[] {
    return this.diagnostics.slice(-Math.max(0, Math.min(limit, MAX_RETAINED_DIAGNOSTICS)))
  }

  private async prepareContribution(
    contribution: ResolvedHostContentScript,
    surface: NonNullable<ExtensionSyncHostContentScriptsRequest['surface']>,
    workspaceRoot?: string
  ): Promise<PreparedContentScript> {
    let totalBytes = 0
    const scripts: Array<{ code: string; url: string }> = []
    const styles: Array<{ css: string; url: string }> = []
    for (const stylePath of contribution.styles) {
      const css = await readConfinedResource(contribution, stylePath)
      totalBytes += Buffer.byteLength(css)
      if (totalBytes > MAX_CONTENT_SCRIPT_TOTAL_BYTES) {
        throw new Error('Content script resources are too large.')
      }
      styles.push({ css, url: `kun-extension://${contribution.extensionId}/${stylePath}` })
    }
    for (const scriptPath of contribution.scripts) {
      const code = await readConfinedResource(contribution, scriptPath)
      totalBytes += Buffer.byteLength(code)
      if (totalBytes > MAX_CONTENT_SCRIPT_TOTAL_BYTES) {
        throw new Error('Content script resources are too large.')
      }
      scripts.push({ code, url: `kun-extension://${contribution.extensionId}/${scriptPath}` })
    }

    const workspaceScope = workspaceRoot
      ? `workspace:${createHash('sha256').update(resolve(workspaceRoot)).digest('hex')}`
      : 'global'
    const key = `${contribution.extensionId}/${contribution.contributionId}`
    const context: HostContentScriptContext = {
      apiVersion: 1,
      extensionId: contribution.extensionId,
      extensionVersion: contribution.extensionVersion,
      contributionId: contribution.contributionId,
      surface,
      runAt: contribution.runAt,
      workspaceScope,
      marker: key,
      rawDomCompatibility: 'unsupported'
    }
    const signature = createHash('sha256')
      .update(JSON.stringify({
        context,
        scripts: scripts.map((script) => [script.url, createHash('sha256').update(script.code).digest('hex')]),
        styles: styles.map((style) => [style.url, createHash('sha256').update(style.css).digest('hex')])
      }))
      .digest('hex')
    return {
      key,
      signature,
      bindingId: `content_script_${randomUUID()}`,
      nonce: randomBytes(32).toString('base64url'),
      worldId: this.worldId(key),
      context,
      scripts,
      styles,
      diagnosticWindowStartedAt: this.now(),
      diagnosticCount: 0,
      ...(workspaceRoot ? { workspaceRoot: resolve(workspaceRoot) } : {})
    }
  }

  private async applyPrepared(
    frame: WebContents,
    prepared: PreparedContentScript[]
  ): Promise<boolean> {
    const state = this.frameState(frame)
    const next = new Map<string, PreparedContentScript>()
    const added: PreparedContentScript[] = []
    const removed: PreparedContentScript[] = []

    for (const candidate of prepared) {
      const previous = state.desired.get(candidate.key)
      if (previous?.signature === candidate.signature) {
        next.set(candidate.key, previous)
      } else {
        if (previous) removed.push(previous)
        next.set(candidate.key, candidate)
        added.push(candidate)
      }
    }
    for (const previous of state.desired.values()) {
      if (!next.has(previous.key)) removed.push(previous)
    }

    if (added.length === 0 && removed.length === 0) return state.reloadScheduled
    state.desired = next
    state.generation = randomUUID()
    this.updateRevalidation(state)
    for (const binding of added) {
      this.emit({
        ...identityOf(binding),
        code: 'HOST_DOM_UNSUPPORTED_CONTRACT',
        message: 'Raw host DOM selectors and layout are unsupported compatibility dependencies.'
      })
    }

    if (removed.length > 0) {
      await this.deactivateBindings(frame, removed)
      this.emit({
        code: 'HOST_DOM_CLEANUP_RELOAD',
        message: 'A content-script principal changed; reloading to remove arbitrary DOM/listener/timer effects.'
      })
      this.scheduleReload(state)
      return true
    }

    if (added.some((binding) => binding.context.runAt === 'documentStart')) {
      this.emit({
        code: 'HOST_DOM_DOCUMENT_START_RELOAD',
        message: 'A documentStart contribution was armed for the next workbench document.'
      })
      this.scheduleReload(state)
      return true
    }

    // documentEnd means "not before DOMContentLoaded". It may be activated
    // later in a live document; the preload performs the isolated-world eval.
    try {
      frame.send('extension:content-script:install', {
        version: 1,
        generation: state.generation,
        bindings: added.map(toBootstrapBinding)
      } satisfies ExtensionHostContentScriptBootstrap)
      this.emit({
        code: 'HOST_DOM_DOCUMENT_END_DISPATCHED',
        message: `Dispatched ${added.length} documentEnd content-script contribution(s).`
      })
    } catch (error) {
      this.emit({
        code: 'HOST_DOM_INSTALL_DISPATCH_FAILED',
        message: boundedErrorMessage(error, 'Failed to dispatch content scripts to the preload.')
      })
      this.scheduleReload(state)
      return true
    }
    return false
  }

  private frameState(frame: WebContents): FrameState {
    const key = keyForFrame(frame)
    const existing = this.frames.get(key)
    if (existing) return existing
    const state: FrameState = {
      frame,
      generation: randomUUID(),
      desired: new Map(),
      reloadScheduled: false,
      revalidating: false
    }
    this.frames.set(key, state)
    frame.once('destroyed', () => {
      const current = this.frames.get(key)
      if (current?.reloadTimer) clearTimeout(current.reloadTimer)
      if (current?.revalidationTimer) clearInterval(current.revalidationTimer)
      this.frames.delete(key)
    })
    return state
  }

  private async deactivateBindings(
    frame: WebContents,
    bindings: PreparedContentScript[]
  ): Promise<void> {
    if (bindings.length === 0 || isDestroyed(frame)) return
    await Promise.allSettled(bindings.map(async (binding) => {
      try {
        await deactivate(frame, binding)
      } catch (error) {
        this.emit({
          ...identityOf(binding),
          code: 'HOST_DOM_DEACTIVATION_FAILED',
          message: boundedErrorMessage(error, 'Content-script deactivation failed.')
        })
      }
    }))
  }

  private scheduleReload(state: FrameState): void {
    if (state.reloadScheduled || isDestroyed(state.frame)) return
    state.reloadScheduled = true
    state.reloadTimer = this.scheduleReloadCallback(() => {
      state.reloadTimer = undefined
      state.reloadScheduled = false
      if (isDestroyed(state.frame)) return
      try {
        state.frame.reload()
      } catch (error) {
        this.emit({
          code: 'HOST_DOM_SURFACE_RELOAD_FAILED',
          message: boundedErrorMessage(error, 'Failed to reload the affected workbench surface.')
        })
      }
    })
  }

  private updateRevalidation(state: FrameState): void {
    if (state.desired.size === 0) {
      if (state.revalidationTimer) clearInterval(state.revalidationTimer)
      state.revalidationTimer = undefined
      return
    }
    if (state.revalidationTimer) return
    state.revalidationTimer = setInterval(() => {
      void this.revalidateFrame(state)
    }, CONTENT_SCRIPT_REVALIDATE_INTERVAL_MS)
    state.revalidationTimer.unref?.()
  }

  private async revalidateFrame(state: FrameState): Promise<void> {
    if (state.revalidating || state.desired.size === 0 || isDestroyed(state.frame)) return
    state.revalidating = true
    try {
      for (const binding of state.desired.values()) {
        const resolved = await this.descriptors.resolveHostContentScript(
          binding.context.extensionId,
          binding.context.contributionId,
          binding.context.surface,
          binding.workspaceRoot
        )
        if (
          resolved.extensionVersion !== binding.context.extensionVersion ||
          resolved.runAt !== binding.context.runAt ||
          !sameStrings(resolved.scripts, binding.scripts.map((source) => pathFromResourceUrl(source.url))) ||
          !sameStrings(resolved.styles, binding.styles.map((source) => pathFromResourceUrl(source.url)))
        ) {
          throw new Error('The active content-script declaration changed.')
        }
      }
    } catch (error) {
      this.emit({
        code: 'HOST_DOM_EXTERNAL_STATE_REVOKED',
        message: boundedErrorMessage(
          error,
          'External extension state changed; active content scripts were revoked.'
        )
      })
      await this.clearFrame(state.frame, true, 'external-state-revalidation')
    } finally {
      state.revalidating = false
    }
  }

  private isReloadScheduled(frame: WebContents): boolean {
    return this.frames.get(keyForFrame(frame))?.reloadScheduled ?? false
  }

  private worldId(key: string): number {
    const existing = this.worldIds.get(key)
    if (existing !== undefined) return existing
    const occupied = new Set(this.worldIds.values())
    // Electron reserves low isolated-world IDs. Each contribution gets a
    // distinct world so a shared extension cannot accidentally attribute one
    // contribution's diagnostics/context to another.
    let candidate = 10_000 + (
      createHash('sha256').update(key).digest().readUInt32BE(0) % 2_000_000_000
    )
    while (occupied.has(candidate)) candidate += 1
    this.worldIds.set(key, candidate)
    return candidate
  }

  private emit(
    input: Omit<ExtensionHostContentScriptDiagnosticRecord, 'at'>
  ): void {
    const diagnostic: ExtensionHostContentScriptDiagnosticRecord = {
      ...input,
      message: input.message.slice(0, 2_000),
      at: new Date(this.now()).toISOString()
    }
    this.diagnostics.push(diagnostic)
    if (this.diagnostics.length > MAX_RETAINED_DIAGNOSTICS) {
      this.diagnostics.splice(0, this.diagnostics.length - MAX_RETAINED_DIAGNOSTICS)
    }
    this.options.onDiagnostic?.(diagnostic)
  }
}

function toBootstrapBinding(
  binding: PreparedContentScript
): ExtensionHostContentScriptBootstrapBinding {
  return {
    bindingId: binding.bindingId,
    nonce: binding.nonce,
    worldId: binding.worldId,
    context: { ...binding.context },
    scripts: binding.scripts.map((script) => ({ ...script })),
    styles: binding.styles.map((style) => ({ ...style }))
  }
}

async function readConfinedResource(
  contribution: ResolvedHostContentScript,
  relativePath: string
): Promise<string> {
  const url = `kun-extension://${contribution.extensionId}/${relativePath}`
  const resolved = await resolveKunExtensionResource(url, async () => ({
    extensionId: contribution.extensionId,
    extensionVersion: contribution.extensionVersion,
    packageRoot: contribution.packageRoot,
    exactFiles: [relativePath],
    localResourceRoots: []
  }))
  const metadata = await readFile(resolved.path)
  if (metadata.byteLength > MAX_CONTENT_SCRIPT_FILE_BYTES) {
    throw new Error('Content script resource is too large.')
  }
  return metadata.toString('utf8')
}

async function deactivate(
  frame: WebContents,
  binding: PreparedContentScript
): Promise<void> {
  await frame.executeJavaScriptInIsolatedWorld(binding.worldId, [{
    code: EXTENSION_CONTENT_SCRIPT_DEACTIVATION_SOURCE,
    url: `kun-extension://${binding.context.extensionId}/__kun_deactivate__.js`
  }])
}

function identityOf(
  binding: PreparedContentScript
): Pick<ExtensionHostContentScriptDiagnosticRecord,
  'extensionId' | 'extensionVersion' | 'contributionId' | 'workspaceScope'> {
  return {
    extensionId: binding.context.extensionId,
    extensionVersion: binding.context.extensionVersion,
    contributionId: binding.context.contributionId,
    workspaceScope: binding.context.workspaceScope
  }
}

function keyForFrame(frame: WebContents): string {
  return String(frame.id)
}

function isDestroyed(frame: WebContents): boolean {
  try {
    return frame.isDestroyed()
  } catch {
    return true
  }
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest()
  const rightDigest = createHash('sha256').update(right).digest()
  return leftDigest.equals(rightDigest)
}

function boundedErrorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 2_000)
}

function boundedLabel(value: string): string {
  return value.replace(/[^a-z0-9:._-]/gi, '-').slice(0, 128) || 'unspecified'
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function pathFromResourceUrl(value: string): string {
  const url = new URL(value)
  return decodeURIComponent(url.pathname.replace(/^\//, ''))
}
