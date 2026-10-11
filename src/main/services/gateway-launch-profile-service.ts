import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { buildGatewayClientSetup, shellQuote, type GatewayClientId } from '../../shared/gateway-client-setup'
import type { GatewayLaunchProfilePreview } from '../../shared/gateway-launch-profile'

type Selection = { clientId: GatewayClientId; baseUrl: string; modelId: string }
type Manifest = { version: 1; current: Selection; previous: Selection | null }
type Snapshot = { content: string | null; manifest: string | null; backup: string | null }
type Plan = { root: string; file: string; selection: Selection; snapshot: Snapshot; expires: number; applied?: boolean }
const hash = (value: string | null): string => createHash('sha256').update(value === null ? '\0missing' : value).digest('hex')
const fingerprint = (value: Snapshot): string => hash(JSON.stringify(value))
const MAX_BYTES = 64 * 1024

/** Only Kun-generated, secret-free isolated launch profiles are writable. Native client homes are never opened. */
export class GatewayLaunchProfileService {
  private readonly plans = new Map<string, Plan>()

  preview(root: string, selection: Selection): GatewayLaunchProfilePreview {
    this.prune()
    const canonical = realpathSync(root)
    const setup = buildGatewayClientSetup(selection.clientId, selection.baseUrl, selection.modelId)
    if (!setup.fileName || !setup.content) throw new Error('This client uses a session-only launch environment; no profile file is needed')
    const file = join(canonical, setup.fileName)
    this.assertPath(canonical, file)
    const snapshot = this.snapshot(file)
    this.owned(snapshot, selection.clientId)
    const planId = randomUUID()
    const plan = { root: canonical, file, selection, snapshot, expires: Date.now() + 10 * 60_000 }
    this.plans.set(planId, plan)
    return this.view(planId, plan)
  }

  apply(planId: string): GatewayLaunchProfilePreview {
    const plan = this.plan(planId)
    if (plan.applied) throw new Error('This reviewed profile was already applied; preview again to change it')
    this.assertUnchanged(plan)
    const old = this.owned(plan.snapshot, plan.selection.clientId)
    const content = this.content(plan.selection)
    if (plan.snapshot.content === content) {
      plan.applied = true
      return { ...this.view(planId, plan), applied: true }
    }
    this.createDirectories(plan.root, dirname(plan.file))
    // Backup precedes replacement. A partial write fails closed on the next operation.
    if (plan.snapshot.content !== null) this.atomicWrite(`${plan.file}.kun-backup`, plan.snapshot.content)
    const manifest: Manifest = { version: 1, current: plan.selection, previous: old?.current ?? null }
    this.atomicWrite(plan.file, content)
    this.atomicWrite(this.manifestPath(plan.file), JSON.stringify(manifest, null, 2) + '\n')
    plan.snapshot = this.snapshot(plan.file)
    plan.applied = true
    plan.expires = Date.now() + 10 * 60_000
    return { ...this.view(planId, plan), applied: true }
  }

  restore(planId: string): void {
    const plan = this.plan(planId)
    this.assertUnchanged(plan)
    const manifest = this.owned(plan.snapshot, plan.selection.clientId)
    if (!manifest) throw new Error('No Kun-owned profile to restore')
    if (manifest.previous) {
      const content = this.content(manifest.previous)
      if (plan.snapshot.backup !== content) throw new Error('Profile backup changed; refusing to restore')
      this.atomicWrite(plan.file, content)
      this.atomicWrite(this.manifestPath(plan.file), JSON.stringify({ version: 1, current: manifest.previous, previous: null }, null, 2) + '\n')
      unlinkSync(`${plan.file}.kun-backup`)
    } else {
      unlinkSync(plan.file)
      unlinkSync(this.manifestPath(plan.file))
      if (plan.snapshot.backup !== null) unlinkSync(`${plan.file}.kun-backup`)
    }
    this.plans.delete(planId)
  }

  private view(planId: string, plan: Plan): GatewayLaunchProfilePreview {
    const setup = buildGatewayClientSetup(plan.selection.clientId, plan.selection.baseUrl, plan.selection.modelId)
    return { planId, path: plan.file, before: plan.snapshot.content ?? '', after: setup.content!,
      launch: `cd ${shellQuote(plan.root)} && ${setup.launch}`, canRestore: plan.snapshot.manifest !== null }
  }
  private content(selection: Selection): string {
    const content = buildGatewayClientSetup(selection.clientId, selection.baseUrl, selection.modelId).content
    if (!content) throw new Error('Invalid launch profile')
    return content
  }
  private plan(id: string): Plan {
    this.prune()
    const plan = this.plans.get(id)
    if (!plan) throw new Error('Preview expired. Choose the folder and review the changes again.')
    return plan
  }
  private prune(): void {
    for (const [id, plan] of this.plans) if (plan.expires <= Date.now()) this.plans.delete(id)
    if (this.plans.size >= 32) this.plans.delete(this.plans.keys().next().value!)
  }
  private manifestPath(file: string): string { return `${file}.kun-profile.json` }
  private read(file: string): string | null {
    let stat
    try { stat = lstatSync(file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error('Profile path must be a small regular file without links')
    return readFileSync(file, 'utf8')
  }
  private snapshot(file: string): Snapshot {
    return { content: this.read(file), manifest: this.read(this.manifestPath(file)), backup: this.read(`${file}.kun-backup`) }
  }
  private owned(snapshot: Snapshot, clientId: GatewayClientId): Manifest | null {
    if (snapshot.content === null && snapshot.manifest === null && snapshot.backup === null) return null
    if (!snapshot.content || !snapshot.manifest) throw new Error('Existing file is not a Kun-owned launch profile; choose another folder')
    let manifest: Manifest
    try {
      manifest = JSON.parse(snapshot.manifest) as Manifest
      if (manifest.version !== 1 || manifest.current.clientId !== clientId ||
        this.content(manifest.current) !== snapshot.content ||
        (manifest.previous && (manifest.previous.clientId !== clientId || this.content(manifest.previous) !== snapshot.backup))) throw new Error('mismatch')
      if (!manifest.previous && snapshot.backup !== null) throw new Error('unexpected backup')
    } catch { throw new Error('Profile or backup was edited outside Kun; refusing to overwrite it') }
    return manifest
  }
  private assertUnchanged(plan: Plan): void {
    this.assertPath(plan.root, plan.file)
    if (fingerprint(this.snapshot(plan.file)) !== fingerprint(plan.snapshot)) throw new Error('Profile changed since preview. Review it again before applying or restoring.')
  }
  private assertPath(root: string, file: string): void {
    const rel = relative(root, file)
    if (!rel || rel.startsWith(`..${sep}`) || rel === '..' || resolve(root, rel) !== file) throw new Error('Invalid profile destination')
    if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('Selected folder changed')
    let cursor = root
    for (const component of rel.split(sep)) {
      cursor = join(cursor, component)
      try {
        const stat = lstatSync(cursor)
        if (stat.isSymbolicLink() || (cursor !== file && !stat.isDirectory())) throw new Error('Profile path contains a link or non-directory')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
  }
  private createDirectories(root: string, directory: string): void {
    let cursor = root
    for (const component of relative(root, directory).split(sep)) {
      cursor = join(cursor, component)
      try { mkdirSync(cursor, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      const stat = lstatSync(cursor)
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Profile directory changed')
    }
  }
  private atomicWrite(file: string, content: string): void {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, file)
    } catch (error) {
      try { unlinkSync(temporary) } catch { /* Preserve the primary write error; never delete another path. */ }
      throw error
    }
  }
}
