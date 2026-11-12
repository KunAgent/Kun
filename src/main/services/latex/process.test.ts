import { afterAll, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { runLatexProcess } from './process'
import { shutdownOwnedProcesses } from '../../../../kun/src/process/owned-process'

afterAll(async () => { await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 3000 }) })
describe('owned LaTeX child processes', () => {
  it('streams bounded output and exits', async () => {
    const chunks: string[] = []
    const result = await runLatexProcess(process.execPath, ['-e', 'process.stdout.write("build output");'], { cwd: tmpdir(), onLog: (text) => chunks.push(text) })
    expect(result).toEqual({ code: 0, log: 'build output', cancelled: false })
    expect(chunks.join('')).toBe('build output')
  }, 15_000)
  it('kills a cancelled process and its child', async () => {
    const controller = new AbortController()
    let childPid = 0
    const result = await runLatexProcess(process.execPath, ['-e', 'const {spawn}=require("node:child_process");const child=spawn(process.execPath,["-e","setInterval(()=>{},1000)"]); console.log(child.pid); setInterval(()=>{},1000);'], {
      cwd: tmpdir(), signal: controller.signal, onLog: (text) => { childPid = Number(text.trim()); controller.abort() }
    })
    expect(result.cancelled).toBe(true)
    expect(childPid).toBeGreaterThan(0)
    expect(() => process.kill(childPid, 0)).toThrow()
  }, 15_000)
  it('stops a stalled compiler within the idle deadline', async () => {
    const result = await runLatexProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: tmpdir(), idleMs: 300, timeoutMs: 5000 })
    expect(result.code).not.toBe(0)
    expect(result.log).toContain('timed out')
  }, 15_000)
})
