import type { ChildProcess } from 'node:child_process'
import {
  COLAB_NOTEBOOK_MARKER,
  type ColabKernelVariable,
  type ColabNotebookExecEvent,
  type ColabNotebookExecuteResult,
  type ColabNotebookOutput,
  type ColabNotebookVariablesResult,
  type ColabRemoteEntry,
  type ColabRemoteListResult
} from '../../shared/colab/colab-notebook-types'
import type { ColabService } from './colab-service'

const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

/**
 * Wraps a cell so it runs in the session's persistent kernel namespace, renders
 * the trailing expression like Jupyter, reports exceptions as a structured
 * marker, and ships matplotlib figures back as PNG markers.
 */
export function buildNotebookCellPython(source: string): string {
  const m = COLAB_NOTEBOOK_MARKER
  return [
    'def _kun_nb_run(_kun_src):',
    '    import ast as _a, base64 as _b, io as _io, json as _j, sys as _s, traceback as _t',
    '    _g = globals()',
    '    _src = _b.b64decode(_kun_src).decode("utf-8")',
    '    try:',
    '        from IPython.core.inputtransformer2 import TransformerManager as _TM',
    '        _src = _TM().transform_cell(_src)',
    '    except Exception:',
    '        pass',
    '    if "matplotlib" in _s.modules or "plt" in _src or "matplotlib" in _src or "seaborn" in _src:',
    '        try:',
    '            import matplotlib as _mpl',
    '            _mpl.use("Agg", force=True)',
    '            import matplotlib.pyplot as _plt0',
    '            _plt0.show = lambda *a, **k: None',
    '        except Exception:',
    '            pass',
    '    try:',
    '        _tree = _a.parse(_src, "<cell>", "exec")',
    '        _last = None',
    '        if _tree.body and isinstance(_tree.body[-1], _a.Expr):',
    '            _last = _a.Expression(_tree.body.pop().value)',
    '        exec(compile(_tree, "<cell>", "exec"), _g)',
    '        if _last is not None:',
    '            _v = eval(compile(_last, "<cell>", "eval"), _g)',
    '            if _v is not None:',
    '                print(repr(_v))',
    '    except BaseException as _e:',
    `        print(${JSON.stringify(m + 'ERR:')} + _j.dumps({"ename": type(_e).__name__, "evalue": str(_e), "traceback": _t.format_exc()}), flush=True)`,
    '    finally:',
    '        try:',
    '            _plt = _s.modules.get("matplotlib.pyplot")',
    '            if _plt is not None:',
    '                for _n in _plt.get_fignums():',
    '                    _buf = _io.BytesIO()',
    '                    _plt.figure(_n).savefig(_buf, format="png", bbox_inches="tight")',
    `                    print(${JSON.stringify(m + 'IMG:')} + _b.b64encode(_buf.getvalue()).decode(), flush=True)`,
    '                _plt.close("all")',
    '        except Exception:',
    '            pass',
    `_kun_nb_run(${JSON.stringify(b64(source))})`,
    'del _kun_nb_run',
    ''
  ].join('\n')
}

export function buildRemoteListPython(path: string): string {
  const m = COLAB_NOTEBOOK_MARKER
  return [
    'def _kun_nb_ls(_p):',
    '    import base64 as _b, json as _j, os as _o',
    '    _p = _b.b64decode(_p).decode("utf-8")',
    '    _out = []',
    '    try:',
    '        with _o.scandir(_p) as _it:',
    '            for _e in _it:',
    '                try:',
    '                    _d = _e.is_dir()',
    '                    _sz = 0 if _d else _e.stat().st_size',
    '                except OSError:',
    '                    _d, _sz = False, 0',
    '                _out.append({"name": _e.name, "path": _o.path.join(_p, _e.name), "isDir": _d, "size": _sz})',
    '    except Exception as _ex:',
    `        print(${JSON.stringify(m + 'LSERR:')} + _j.dumps(str(_ex)), flush=True)`,
    '        return',
    '    _out.sort(key=lambda x: (not x["isDir"], x["name"].lower()))',
    `    print(${JSON.stringify(m + 'LS:')} + _j.dumps(_out[:500]), flush=True)`,
    `_kun_nb_ls(${JSON.stringify(b64(path))})`,
    'del _kun_nb_ls',
    ''
  ].join('\n')
}

/** Splits CLI stdout into plain stream text and protocol markers. */
export function createNotebookOutputParser(emit: (output: ColabNotebookOutput) => void): {
  push: (chunk: string, name: 'stdout' | 'stderr') => void
  flush: () => void
} {
  const buffers = { stdout: '', stderr: '' }
  const emitLine = (line: string, name: 'stdout' | 'stderr'): string => {
    if (!line.startsWith(COLAB_NOTEBOOK_MARKER)) return line + '\n'
    const body = line.slice(COLAB_NOTEBOOK_MARKER.length)
    if (body.startsWith('IMG:')) {
      emit({ type: 'image', mime: 'image/png', data: body.slice(4).trim() })
      return ''
    }
    if (body.startsWith('ERR:')) {
      try {
        const parsed = JSON.parse(body.slice(4)) as { ename?: string; evalue?: string; traceback?: string }
        emit({
          type: 'error',
          ename: String(parsed.ename ?? 'Error'),
          evalue: String(parsed.evalue ?? ''),
          traceback: String(parsed.traceback ?? '')
        })
        return ''
      } catch {
        return line + '\n'
      }
    }
    void name
    return line + '\n'
  }
  const push = (chunk: string, name: 'stdout' | 'stderr'): void => {
    buffers[name] += chunk
    const parts = buffers[name].split('\n')
    let rest = parts.pop() ?? ''
    let text = ''
    for (const line of parts) text += emitLine(line, name)
    // Progress bars rewrite one line with \r; show partial text immediately
    // unless it could still become a protocol marker.
    const maybeMarker =
      rest.startsWith(COLAB_NOTEBOOK_MARKER) || COLAB_NOTEBOOK_MARKER.startsWith(rest)
    if (rest && !maybeMarker) {
      text += rest
      rest = ''
    }
    buffers[name] = rest
    if (text) emit({ type: 'stream', name, text })
  }
  const flush = (): void => {
    for (const name of ['stdout', 'stderr'] as const) {
      const rest = buffers[name]
      buffers[name] = ''
      if (!rest) continue
      const text = emitLine(rest, name).replace(/\n$/, '')
      if (text) emit({ type: 'stream', name, text })
    }
  }
  return { push, flush }
}

export function parseRemoteListOutput(stdout: string): ColabRemoteEntry[] | { error: string } | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(COLAB_NOTEBOOK_MARKER + 'LS:')) {
      try {
        return JSON.parse(line.slice(COLAB_NOTEBOOK_MARKER.length + 3)) as ColabRemoteEntry[]
      } catch {
        return null
      }
    }
    if (line.startsWith(COLAB_NOTEBOOK_MARKER + 'LSERR:')) {
      try {
        return { error: String(JSON.parse(line.slice(COLAB_NOTEBOOK_MARKER.length + 6))) }
      } catch {
        return { error: line }
      }
    }
  }
  return null
}

export function buildKernelVariablesPython(): string {
  const m = COLAB_NOTEBOOK_MARKER
  return [
    'def _kun_nb_vars():',
    '    import json as _j, types as _t',
    '    _skip = {"In", "Out", "get_ipython", "exit", "quit", "open"}',
    '    _skip_t = (_t.ModuleType, _t.FunctionType, _t.BuiltinFunctionType, _t.MethodType, type)',
    '    _out = []',
    '    for _k, _v in list(globals().items()):',
    '        if _k.startswith("_") or _k in _skip or isinstance(_v, _skip_t):',
    '            continue',
    '        _tn = type(_v).__name__',
    '        _sm = ""',
    '        try:',
    '            if hasattr(_v, "shape") and hasattr(_v, "dtype"):',
    '                _sm = f"{tuple(_v.shape)} · {_v.dtype}"',
    '            elif _tn == "DataFrame" and hasattr(_v, "shape"):',
    '                _sm = f"{_v.shape[0]}x{_v.shape[1]}"',
    '            elif isinstance(_v, (int, float, bool)):',
    '                _sm = repr(_v)[:36]',
    '            elif isinstance(_v, str):',
    '                _sm = (repr(_v[:28]) + ("…" if len(_v) > 28 else ""))',
    '            elif hasattr(_v, "__len__"):',
    '                _sm = f"{len(_v)}"',
    '        except Exception:',
    '            _sm = ""',
    '        _out.append({"name": str(_k), "typeName": _tn, "summary": _sm})',
    '    _out.sort(key=lambda x: x["name"].lower())',
    `    print(${JSON.stringify(m + 'VARS:')} + _j.dumps(_out[:60]), flush=True)`,
    '_kun_nb_vars()',
    'del _kun_nb_vars',
    ''
  ].join('\n')
}

export function parseKernelVariablesOutput(stdout: string): ColabKernelVariable[] | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(COLAB_NOTEBOOK_MARKER + 'VARS:')) {
      try {
        return JSON.parse(line.slice(COLAB_NOTEBOOK_MARKER.length + 5)) as ColabKernelVariable[]
      } catch {
        return null
      }
    }
  }
  return null
}

type RunningExec = { child: ChildProcess; interrupted: boolean }

/** Runs notebook cells against a provisioned Colab session's persistent kernel. */
export class ColabNotebookKernel {
  private readonly running = new Map<string, RunningExec>()

  constructor(
    private readonly service: ColabService,
    private readonly emit: (event: ColabNotebookExecEvent) => void
  ) {}

  private async prepare(sessionId: string): Promise<
    | { ok: true; sessionName: string; connectionId: string; sessionsJsonPath: string; env: Record<string, string> }
    | { ok: false; message: string }
  > {
    const status = await this.service.cli.ensureInstalled()
    if (status.state !== 'ready') return { ok: false, message: status.message || 'Colab CLI is not ready.' }
    const snapshot = await this.service.getSnapshot()
    const session = snapshot.sessions.find((s) => s.id === sessionId)
    if (!session) return { ok: false, message: 'Colab runtime not found.' }
    if (session.phase !== 'running') return { ok: false, message: 'Colab runtime is not connected.' }
    const credFile = await this.service.credentials.materializeRuntimeToken(session.connectionId)
    const { paths, env } = await this.service.isolation.prepareConnectionEnvironment(
      session.connectionId,
      credFile
    )
    return {
      ok: true,
      sessionName: session.sessionName,
      connectionId: session.connectionId,
      sessionsJsonPath: paths.sessionsJsonPath,
      env
    }
  }

  async execute(input: { sessionId: string; execId: string; code: string }): Promise<ColabNotebookExecuteResult> {
    if (this.running.has(input.execId)) return { ok: false, message: 'Execution already running.' }
    const prepared = await this.prepare(input.sessionId)
    if (!prepared.ok) {
      this.emit({ execId: input.execId, kind: 'done', ok: false, interrupted: false, message: prepared.message })
      return prepared
    }
    const child = this.service.cli.spawnStreamingCommand({
      sessionsJsonPath: prepared.sessionsJsonPath,
      args: ['exec', '-s', prepared.sessionName, '--timeout', '0'],
      env: prepared.env,
      stdinText: buildNotebookCellPython(input.code)
    })
    const handle: RunningExec = { child, interrupted: false }
    this.running.set(input.execId, handle)
    let sawError = false
    const parser = createNotebookOutputParser((output) => {
      if (output.type === 'error') sawError = true
      this.emit({ execId: input.execId, kind: 'output', output })
    })
    child.stdout?.on('data', (chunk: Buffer) => parser.push(chunk.toString('utf8'), 'stdout'))
    child.stderr?.on('data', (chunk: Buffer) => parser.push(chunk.toString('utf8'), 'stderr'))
    const exitCode = await new Promise<number>((resolve) => {
      child.once('close', (code) => resolve(code ?? 1))
      child.once('error', () => resolve(1))
    })
    parser.flush()
    this.running.delete(input.execId)
    await this.service.credentials.syncRuntimeTokenBack(prepared.connectionId).catch(() => undefined)
    const ok = exitCode === 0 && !sawError && !handle.interrupted
    this.emit({
      execId: input.execId,
      kind: 'done',
      ok,
      interrupted: handle.interrupted,
      message: exitCode !== 0 && !handle.interrupted ? `colab exec exited with code ${exitCode}` : undefined
    })
    return { ok: true }
  }

  interrupt(execId: string): { ok: boolean } {
    const handle = this.running.get(execId)
    if (!handle) return { ok: false }
    handle.interrupted = true
    handle.child.kill()
    return { ok: true }
  }

  async listFiles(input: { sessionId: string; path: string }): Promise<ColabRemoteListResult> {
    const prepared = await this.prepare(input.sessionId)
    if (!prepared.ok) return prepared
    const res = await this.service.cli.runCommand({
      sessionsJsonPath: prepared.sessionsJsonPath,
      args: ['exec', '-s', prepared.sessionName, '--timeout', '20'],
      env: prepared.env,
      stdinText: buildRemoteListPython(input.path),
      timeoutMs: 30_000
    })
    await this.service.credentials.syncRuntimeTokenBack(prepared.connectionId).catch(() => undefined)
    const parsed = parseRemoteListOutput(res.stdout)
    if (parsed === null) {
      return { ok: false, message: `${res.stderr || res.stdout}`.trim().slice(0, 300) || 'List failed.' }
    }
    if ('error' in parsed) return { ok: false, message: parsed.error }
    return { ok: true, path: input.path, entries: parsed }
  }

  async listVariables(input: { sessionId: string }): Promise<ColabNotebookVariablesResult> {
    const prepared = await this.prepare(input.sessionId)
    if (!prepared.ok) return prepared
    const res = await this.service.cli.runCommand({
      sessionsJsonPath: prepared.sessionsJsonPath,
      args: ['exec', '-s', prepared.sessionName, '--timeout', '15'],
      env: prepared.env,
      stdinText: buildKernelVariablesPython(),
      timeoutMs: 20_000
    })
    await this.service.credentials.syncRuntimeTokenBack(prepared.connectionId).catch(() => undefined)
    const parsed = parseKernelVariablesOutput(res.stdout)
    if (!parsed) {
      return { ok: false, message: `${res.stderr || res.stdout}`.trim().slice(0, 300) || 'Failed to inspect variables.' }
    }
    return { ok: true, variables: parsed }
  }

  shutdown(): void {
    for (const handle of this.running.values()) handle.child.kill()
    this.running.clear()
  }
}
