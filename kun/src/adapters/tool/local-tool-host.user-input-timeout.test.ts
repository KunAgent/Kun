import { describe, expect, it } from 'vitest'
import { requestUserInputTool, userInputTool } from './local-tool-host.js'

type CapturedRequest = {
  id: string
  itemId: string
  prompt: string
  questions: unknown[]
  timeoutSeconds?: number
}

function executeWithAwaitUserInput(
  args: Record<string, unknown>,
  awaitUserInput: (request: CapturedRequest) => Promise<unknown>
): Promise<{ output: unknown; isError?: boolean }> {
  const tool = requestUserInputTool
  if (!tool.execute) throw new Error('tool has no execute')
  return Promise.resolve(
    tool.execute(args, { awaitUserInput } as never) as Promise<{ output: unknown; isError?: boolean }>
  )
}

describe('user_input tool aliases', () => {
  it('shares one constrained description and schema across canonical and legacy names', () => {
    expect(requestUserInputTool.description).toBe(userInputTool.description)
    expect(requestUserInputTool.inputSchema).toEqual(userInputTool.inputSchema)
    expect(userInputTool.description).toContain('material choice blocks safe or correct progress')
    expect(userInputTool.description).toContain('active workflow explicitly requires structured confirmation')
    expect(userInputTool.description).toContain('optional follow-ups')
    expect(userInputTool.description).toContain('unnecessary repetitions or rephrasings')
    expect(userInputTool.description).toContain('material workflow state change')
  })
})

describe('user_input timeoutSeconds', () => {
  it('passes a normalized timeoutSeconds through awaitUserInput', async () => {
    const captured: CapturedRequest[] = []
    const result = await executeWithAwaitUserInput(
      { prompt: 'Continue?', timeoutSeconds: 30.7 },
      async (request) => {
        captured.push(request)
        return { status: 'submitted', answers: [] }
      }
    )
    expect(captured).toHaveLength(1)
    expect(captured[0]!.timeoutSeconds).toBe(30)
    expect(result.isError).toBeFalsy()
  })

  it('drops out-of-range or non-numeric timeoutSeconds values', async () => {
    for (const raw of [1, 9999, '30', Number.NaN, null]) {
      const captured: CapturedRequest[] = []
      await executeWithAwaitUserInput(
        { prompt: 'Continue?', timeoutSeconds: raw },
        async (request) => {
          captured.push(request)
          return { status: 'submitted', answers: [] }
        }
      )
      expect(captured[0]!.timeoutSeconds).toBeUndefined()
    }
  })

  it('returns a non-error self-decision payload on timeout resolution', async () => {
    const result = await executeWithAwaitUserInput(
      { prompt: 'Continue?', timeoutSeconds: 20 },
      async () => ({ status: 'timeout' })
    )
    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({
      status: 'timeout',
      message: expect.stringContaining('proceed with your own best judgment')
    })
  })
})
