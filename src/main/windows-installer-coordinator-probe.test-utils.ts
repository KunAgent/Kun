import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encodePowershellCommand } from './one-shot-helper-script'

/** CI-only instrumentation; the production command and readiness gate stay intact. */
export function createRollbackCoordinatorProbe(diagnostic: string, guiParent?: ChildProcess) {
  let child: ChildProcess | undefined
  let output = ''
  let closed = false
  let completion: Promise<number | null> | undefined
  const launch: typeof spawn = ((...args: Parameters<typeof spawn>) => {
    const [executable, commandArgs, options] = args
    const bootstrapIndex = commandArgs.indexOf('-Command') + 1
    if (bootstrapIndex === 0) throw new Error('Expected a coordinator bootstrap command.')
    const bootstrap = commandArgs[bootstrapIndex]!
    const encoded = bootstrap.match(/'-EncodedCommand','([^']+)'/u)?.[1]
    if (!encoded) throw new Error('Encoded coordinator command is missing from the bootstrap.')
    const command = Buffer.from(encoded, 'base64').toString('utf16le')
    const validation = '& $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script -Action ValidateUpdateRollback -Bounded'
    if (!command.includes(validation)) throw new Error('Coordinator validation probe location is missing.')
    const marker = (phase: string) => `Write-CoordinatorProbe '${phase}'`
    const trace = [
      'function Write-CoordinatorProbe([string]$stage) {',
      `  [IO.File]::AppendAllText('${diagnostic.replace(/'/gu, "''")}',`,
      '    ("COORDINATOR {0} pid={1} host={2} lastExit={3}`r`n" -f $stage, $PID, [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName, $LASTEXITCODE),',
      '    [Text.Encoding]::UTF8)',
      '}',
      marker('entry')
    ].join('\n')
    const instrumented = trace + '\n' + command
      .replace('Add-Type -TypeDefinition', marker('before-add-type') + '\nAdd-Type -TypeDefinition')
      .replace(/(\[KunOneShotDeadline\]::Start\(\d+, \$false\))/u,
        marker('before-deadline-start') + '\n$1\n' + marker('after-deadline-start'))
      .replace(validation, marker('before-validation') + '; ' + validation + '; ' + marker('after-validation'))
      .replace('$pipe=[IO.Pipes.NamedPipeClientStream]', marker('before-pipe') + '; $pipe=[IO.Pipes.NamedPipeClientStream]')
      .replace('Start-Process -FilePath $exe -ErrorAction Stop; exit 0', 'Start-Process -FilePath $exe -ErrorAction Stop; ' + marker('completed') + '; exit 0')
    const instrumentedArgs = [...commandArgs]
    instrumentedArgs[bootstrapIndex] = trace.replace(marker('entry'), marker('bootstrap-entry')) + '\n' + bootstrap
      .replace(encoded, encodePowershellCommand(instrumented))
      .replace('$coordinator.WaitForExit()', marker('bootstrap-waiting') + '\n$coordinator.WaitForExit()')
    const recovery = dirname(diagnostic)
    writeFileSync(join(recovery, 'result-bootstrap-command.txt'), bootstrap)
    writeFileSync(join(recovery, 'result-coordinator-command.txt'), command)
    writeFileSync(join(recovery, 'result-coordinator-instrumented.txt'), instrumented)
    const where = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'),
      [executable], { encoding: 'utf8' })
    const summaryPath = join(dirname(recovery), 'fixture-summary.json')
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>
    writeFileSync(summaryPath, JSON.stringify({ ...summary, coordinator: {
      executable, resolvedCandidates: where.stdout, whereStatus: where.status,
      args: commandArgs.map((arg, index) => index === bootstrapIndex ? `<${arg.length} bootstrap characters>` : arg),
      commandCharacters: command.length,
      originalArgumentCharacters: commandArgs.join(' ').length,
      instrumentedArgumentCharacters: instrumentedArgs.join(' ').length,
      cwd: process.cwd()
    } }, null, 2))
    const launchOptions = { ...options, stdio: ['ignore', 'pipe', 'pipe'] as const }
    if (guiParent) {
      child = guiParent
      guiParent.send!({ executable, args: instrumentedArgs, options: launchOptions })
    } else {
      child = spawn(executable, instrumentedArgs, { ...launchOptions, stdio: ['ignore', 'pipe', 'pipe'] })
    }
    const capture = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-32_768) }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    completion = new Promise<number | null>((resolve, reject) => {
      child!.once('close', (code) => { closed = true; resolve(code) })
      child!.once('error', reject)
    })
    void completion.catch(() => undefined)
    return child
  }) as typeof spawn
  return {
    launch,
    completion: () => completion,
    output: () => output,
    kill: () => child?.kill(),
    async drain() {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([completion?.catch(() => undefined), new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 2_000)
        })])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
      return `Helper closed=${closed} exit=${child?.exitCode} signal=${child?.signalCode}\n${output}`
    }
  }
}

/** A real Node GUI stand-in: exiting it also closes its libuv child job. */
export function createRollbackGuiParent(): ChildProcess {
  return spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    process.once('message', ({ executable, args, options }) => {
      const helper = spawn(executable, args, options);
      helper.stdout.pipe(process.stdout);
      helper.stderr.pipe(process.stderr);
      helper.once('error', (error) => { console.error(error); process.exit(1); });
      helper.once('close', (code) => process.exit(code ?? 1));
    });
  `], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
}
