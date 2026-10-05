import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encodePowershellCommand } from './one-shot-helper-script'

/** CI-only instrumentation; the production command and readiness gate stay intact. */
export function createRollbackCoordinatorProbe(diagnostic: string) {
  let child: ChildProcess | undefined
  let output = ''
  let closed = false
  let completion: Promise<number | null> | undefined
  const launch: typeof spawn = ((...args: Parameters<typeof spawn>) => {
    const [executable, commandArgs, options] = args
    const encodedIndex = commandArgs.indexOf('-EncodedCommand') + 1
    if (encodedIndex === 0) throw new Error('Expected an encoded current-user coordinator command.')
    const command = Buffer.from(commandArgs[encodedIndex]!, 'base64').toString('utf16le')
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
    const instrumentedArgs = [...commandArgs]
    instrumentedArgs[encodedIndex] = encodePowershellCommand(instrumented)
    const recovery = dirname(diagnostic)
    writeFileSync(join(recovery, 'result-coordinator-command.txt'), command)
    writeFileSync(join(recovery, 'result-coordinator-instrumented.txt'), instrumented)
    const where = spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'),
      [executable], { encoding: 'utf8' })
    const summaryPath = join(dirname(recovery), 'fixture-summary.json')
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>
    writeFileSync(summaryPath, JSON.stringify({ ...summary, coordinator: {
      executable, resolvedCandidates: where.stdout, whereStatus: where.status,
      args: commandArgs.map((arg, index) => index === encodedIndex ? `<${arg.length} encoded characters>` : arg),
      commandCharacters: command.length,
      originalArgumentCharacters: commandArgs.join(' ').length,
      instrumentedArgumentCharacters: instrumentedArgs.join(' ').length,
      cwd: process.cwd()
    } }, null, 2))
    child = spawn(executable, instrumentedArgs, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
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
