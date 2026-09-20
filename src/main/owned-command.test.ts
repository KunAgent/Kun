import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runOwnedCommand } from './owned-command'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses } from '../../kun/src/process/owned-process'
import { checkWorkflowCode, executeCodeWorkflowNode } from './workflow-code-node-adapter'
import { normalizeWorkflowNode } from '../shared/app-settings-workflow-node'

const directories: string[] = []
afterEach(async () => {
  await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Main owned helper commands', () => {
  it.skipIf(process.platform === 'win32')('keeps Workflow input/output semantics for a script that never reads stdin', async () => {
    const node = normalizeWorkflowNode({ type: 'code', config: { language: 'bash', code: 'printf "%s" "$WORKFLOW_TEXT"' } }, 0)
    if (node?.type !== 'code') throw new Error('Expected a Code node fixture')
    const result = await executeCodeWorkflowNode({ node, payload: { json: { value: 3 }, text: 'payload text' } })
    expect(result).toMatchObject({ payload: { json: { text: 'payload text' }, text: 'payload text' }, message: 'ok' })
    expect(await checkWorkflowCode('bash', 'echo "unterminated')).toMatchObject({ status: 'error' })
  })

  it('captures bounded output and forwards stdin before returning', async () => {
    const result = await runOwnedCommand(process.execPath, ['-e',
      'process.stdin.on("data",chunk=>process.stdout.write(chunk));process.stderr.write("diagnostic")'], {
      input: 'hello\n', timeoutMs: 4000
    })
    expect(result).toEqual({ exitCode: 0, stdout: 'hello\n', stderr: 'diagnostic' })
  })

  it.skipIf(process.platform === 'win32')('reaps a background helper even after its direct runner exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-main-helper-'))
    directories.push(directory)
    const pidPath = join(directory, 'child.pid')
    await runOwnedCommand(process.execPath, ['-e', `
      const child=require('node:child_process').spawn(process.execPath,['-e',
        'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'inherit'});
      require('node:fs').writeFileSync(process.argv[1],String(child.pid));
      child.unref();
    `, pidPath], { timeoutMs: 4000 })
    const pid = Number(await readFile(pidPath, 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
  })

  it('honors cancellation that races the guarded spawn handshake', async () => {
    const controller = new AbortController()
    const command = runOwnedCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      signal: controller.signal, timeoutMs: 4000
    })
    controller.abort()
    await expect(command).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('bounds a helper which ignores normal exit by killing its group on output overflow', async () => {
    await expect(runOwnedCommand(process.execPath, ['-e',
      'process.on("SIGTERM",()=>{});setInterval(()=>process.stdout.write("x".repeat(5000)),10)'], {
      maxOutputBytes: 1000, timeoutMs: 4000
    })).rejects.toThrow('output exceeded')
  })
})
