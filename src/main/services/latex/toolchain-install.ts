import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import type { LatexToolchainState, LatexToolchainStatus } from '../../../shared/latex-toolchain'
import type { LatexEngine } from '../../../shared/latex-project'
import { atomicWrite } from './project'
import { detectLatexTools } from './detect'
import { runLatexProcess } from './process'
import { downloadTinyTex, resolveTinyTexAsset, tinyTexPlatform, type LatexToolchainFetch } from './toolchain-download'

const PACKAGES = ['latexmk', 'collection-latexrecommended', 'xetex', 'luatex', 'ctex', 'fandol', 'natbib']
const idleState = (): LatexToolchainState => ({ jobId: null, phase: 'idle', version: null, downloadedBytes: 0, totalBytes: 0, log: '', error: null })
type InstallJob = { id: string; controller: AbortController; promise: Promise<LatexToolchainState> }
type Options = {
  fetch: LatexToolchainFetch
  platform?: string
  arch?: string
  musl?: boolean
  onState?: (state: LatexToolchainState) => void
  run?: typeof runLatexProcess
}
function isMusl(): boolean {
  if (process.platform !== 'linux') return false
  const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header
  return !!header && !header.glibcVersionRuntime
}

/** Installs only a checksum-verified official bundle into Kun's own tool directory. */
export class LatexToolchainInstaller {
  private state = idleState()
  private job: InstallJob | null = null
  private closing = false
  private readonly platform: string
  private readonly bundle: string | null
  constructor(readonly root: string, private readonly options: Options) {
    this.platform = options.platform ?? process.platform
    this.bundle = tinyTexPlatform(this.platform, options.arch ?? process.arch, options.musl ?? isMusl())
  }

  async status(engine: LatexEngine, toolDirectory = ''): Promise<LatexToolchainStatus> {
    const tools = await detectLatexTools(engine, toolDirectory, this.root)
    return { state: this.state, tools, platform: this.platform, supported: !!this.bundle, installRoot: this.root }
  }

  private publish(patch: Partial<LatexToolchainState>): void {
    this.state = { ...this.state, ...patch }
    this.options.onState?.(this.state)
  }

  install(): Promise<LatexToolchainState> {
    if (this.job) return this.job.promise
    if (this.closing) return Promise.reject(new Error('Kun is shutting down.'))
    if (!this.bundle) return Promise.reject(new Error('Use the official TeX installer on this platform.'))
    const job: InstallJob = { id: randomUUID(), controller: new AbortController(), promise: Promise.resolve(this.state) }
    this.job = job
    this.state = idleState()
    this.publish({ jobId: job.id, phase: 'resolving' })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; job.controller.abort() }, 30 * 60 * 1000)
    timer.unref()
    job.promise = this.installFiles(job).then(() => {
      this.publish({ phase: 'ready' })
      return this.state
    }).catch((error) => {
      this.publish({ phase: job.controller.signal.aborted && !timedOut ? 'cancelled' : 'failed',
        error: timedOut ? 'Installation timed out. Please retry or use the official installer.' : job.controller.signal.aborted ? null : error instanceof Error ? error.message : String(error) })
      return this.state
    }).finally(() => { clearTimeout(timer); if (this.job === job) this.job = null })
    return job.promise
  }

  cancel(id: string): void { if (this.job?.id === id) this.job.controller.abort() }
  stop(): void { this.closing = true; this.job?.controller.abort() }

  private async installFiles(job: InstallJob): Promise<void> {
    const signal = job.controller.signal
    let work: string | undefined
    let installed: string | undefined
    let published = false
    const run = async (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> => {
      signal.throwIfAborted()
      const result = await (this.options.run ?? runLatexProcess)(command, args, { cwd, env, signal, timeoutMs: 20 * 60 * 1000, idleMs: 5 * 60 * 1000,
        onLog: (text) => this.publish({ log: (this.state.log + text).slice(-32 * 1024) }) })
      signal.throwIfAborted()
      if (result.code !== 0 || result.cancelled) throw new Error(result.log.trim().slice(-3000) || `Cannot run ${command}.`)
    }
    try {
      await mkdir(this.root, { recursive: true })
      work = await mkdtemp(join(this.root, 'work-'))
      if (this.platform !== 'win32') await run('perl', ['-mFile::Find', '-e', '1'], work)
      const asset = await resolveTinyTexAsset(this.options.fetch, this.bundle!, signal)
      this.publish({ phase: 'downloading', version: asset.version, totalBytes: asset.size })
      const archive = join(work, asset.name)
      await downloadTinyTex(this.options.fetch, asset, archive, signal, (downloadedBytes) => this.publish({ downloadedBytes }))
      this.publish({ phase: 'verifying' })
      signal.throwIfAborted()
      this.publish({ phase: 'extracting' })
      // The self-extractor and tar archive are accepted only after SHA-256 validation.
      if (this.platform === 'win32') await run(archive, ['-y'], work)
      else await run('tar', ['-xf', archive, '-C', work], work)
      const entries = await readdir(work, { withFileTypes: true })
      const extracted = entries.find((entry) => entry.isDirectory() && ['TinyTeX', '.TinyTeX'].includes(entry.name))
      if (!extracted) throw new Error('The TinyTeX bundle has no installation directory.')
      const directory = `TinyTeX-${asset.version}-${job.id}`
      installed = join(this.root, directory)
      await rename(join(work, extracted.name), installed)
      const bins = (await readdir(join(installed, 'bin'), { withFileTypes: true })).filter((entry) => entry.isDirectory())
      if (bins.length !== 1) throw new Error('The TinyTeX bundle has an unexpected binary directory.')
      const bin = join(installed, 'bin', bins[0].name)
      const env = { ...process.env, PATH: [bin, process.env.PATH ?? ''].join(delimiter) }
      this.publish({ phase: 'configuring' })
      // Calling bundled Perl directly also works on Windows without shell:true or a .bat launcher.
      const manager = this.platform === 'win32' ? join(installed, 'tlpkg', 'tlperl', 'bin', 'perl.exe') : join(bin, 'tlmgr')
      const prefix = this.platform === 'win32' ? [join(installed, 'texmf-dist', 'scripts', 'texlive', 'tlmgr.pl')] : []
      const tlmgr = (args: string[]): Promise<void> => run(manager, [...prefix, '--repository', 'https://tlnet.yihui.org', ...args], installed!, env)
      await tlmgr(['update', '--self'])
      await tlmgr(['install', ...PACKAGES])
      await tlmgr(['postaction', 'install', 'script', 'xetex'])
      const executable = (name: string): string => join(bin, this.platform === 'win32' ? `${name}.exe` : name)
      for (const name of ['latexmk', 'pdflatex', 'xelatex', 'lualatex']) await run(executable(name), ['--version'], installed, env)
      signal.throwIfAborted()
      // The previous installation remains active until every required executable works.
      await atomicWrite(join(this.root, 'active.json'), JSON.stringify({ directory, bin: `bin/${bins[0].name}` }))
      published = true
    } finally {
      if (work) await rm(work, { recursive: true, force: true })
      if (installed && !published) await rm(installed, { recursive: true, force: true })
    }
  }
}
