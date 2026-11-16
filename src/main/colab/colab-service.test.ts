import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultKunColabSettings } from '../../shared/app-settings-colab'
import {
  classifyColabErrorOutput,
  parseColabSessionsOutput,
  parseColabUsageOutput
} from './colab-cli-runtime'
import { ColabCredentialStore } from './colab-credential-store'
import { ColabPythonIsolation } from './colab-python-isolation'
import { ColabService } from './colab-service'
import {
  inspectWorkspaceSyncCandidates,
  parseTrainingStdoutLine
} from './colab-workspace-sync'

const tempDirs: string[] = []

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

const mockSafeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
  decryptString: (buf: Buffer) => buf.toString('utf8'),
  getSelectedStorageBackend: () => 'basic_text',
  setUsePlainTextEncryption: () => undefined
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('Colab engine & multi-account isolation', () => {
  it('waits for persisted workspace connections on concurrent first snapshots', async () => {
    const root = await createTempDir('kun-colab-snapshot-')
    const workspaceConnections = { '/work/project': 'conn-a' }
    await writeFile(join(root, 'state.v1.json'), JSON.stringify({ version: 1, workspaceConnections }))
    const service = new ColabService({
      colabRootDir: root, safeStorage: mockSafeStorage as any,
      openExternal: async () => undefined, getColabSettings: defaultKunColabSettings
    })
    try {
      const snapshots = await Promise.all([service.getSnapshot(), service.getSnapshot()])
      for (const snapshot of snapshots) expect(snapshot.workspaceConnections).toEqual(workspaceConnections)
    } finally {
      await service.shutdown()
    }
  })

  it('encrypts, materializes, and syncs per-connection OAuth tokens independently', async () => {
    const root = await createTempDir('kun-colab-cred-')
    const store = new ColabCredentialStore(root, mockSafeStorage as any)

    await store.writeToken('conn-a', {
      token: 'ya29.tokenA',
      refresh_token: '1//refreshA',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_id: 'cid',
      client_secret: 'csec',
      scopes: ['openid', 'email']
    })
    await store.writeToken('conn-b', {
      token: 'ya29.tokenB',
      refresh_token: '1//refreshB',
      token_uri: 'https://oauth2.googleapis.com/token',
      client_id: 'cid',
      client_secret: 'csec',
      scopes: ['openid', 'email']
    })

    const fileA = await store.materializeRuntimeToken('conn-a')
    const fileB = await store.materializeRuntimeToken('conn-b')
    expect(fileA).not.toBe(fileB)

    // Simulate google-colab-cli refreshing conn-a's access token in runtime file
    await writeFile(
      fileA,
      JSON.stringify({
        token: 'ya29.refreshedA',
        refresh_token: '1//refreshA',
        token_uri: 'https://oauth2.googleapis.com/token',
        client_id: 'cid',
        client_secret: 'csec',
        scopes: ['openid', 'email']
      }),
      'utf8'
    )
    await store.syncRuntimeTokenBack('conn-a')

    const readA = await store.readToken('conn-a')
    const readB = await store.readToken('conn-b')
    expect(readA?.token).toBe('ya29.refreshedA')
    expect(readB?.token).toBe('ya29.tokenB')
  })

  it('builds isolated keyring and HOME environment per connection without shared OS keyring state', async () => {
    const root = await createTempDir('kun-colab-iso-')
    const iso = new ColabPythonIsolation(root)
    const envA = await iso.prepareConnectionEnvironment('conn-1', '/tmp/cred-1.json')
    const envB = await iso.prepareConnectionEnvironment('conn-2', '/tmp/cred-2.json')

    expect(envA.env.PYTHON_KEYRING_BACKEND).toBe('kun_colab_keyring.ConnectionKeyring')
    expect(envA.env.KUN_COLAB_CRED_FILE).toBe('/tmp/cred-1.json')
    expect(envB.env.KUN_COLAB_CRED_FILE).toBe('/tmp/cred-2.json')
    expect(envA.env.HOME).not.toBe(envB.env.HOME)
    expect(envA.paths.sessionsJsonPath).not.toBe(envB.paths.sessionsJsonPath)
  })

  it('parses colab usage, sessions output, error categories, and training stdout metrics', () => {
    const usage = parseColabUsageOutput(
      'Current balance: 86.4 compute units\nUsage rate: 1.96/hr\nActive assignments: 1\n'
    )
    expect(usage).toEqual({
      balanceCu: 86.4,
      burnRateCuPerHour: 1.96,
      activeAssignments: 1
    })

    const sessions = parseColabSessionsOutput(
      '[lora-ft] m-s-abc123 | Hardware: T4 | Shape: STANDARD | Variant: GPU\n' +
        '[?] m-s-orphan99 | Hardware: A100 | Shape: HIGHMEM | Variant: GPU\n'
    )
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ name: 'lora-ft', accelerator: 'T4', untracked: false })
    expect(sessions[1]).toMatchObject({
      endpoint: 'm-s-orphan99',
      accelerator: 'A100',
      untracked: true
    })

    expect(classifyColabErrorOutput('Failed to assign runtime: resource exhausted')).toBe(
      'gpu_unavailable'
    )
    expect(classifyColabErrorOutput('Token has been expired or revoked')).toBe('auth_expired')

    const parsed = parseTrainingStdoutLine('Epoch 2/10 step=40 loss=0.312 acc=0.914', {})
    expect(parsed.progressSummary).toContain('epoch 2 / 10')
    expect(parsed.updatedMetrics?.loss?.[0]?.value).toBe(0.312)
    expect(parsed.updatedMetrics?.acc?.[0]?.value).toBe(0.914)
  })

  it('excludes .gitignore entries when scanning workspace sync candidates', async () => {
    const ws = await createTempDir('kun-colab-ws-')
    await writeFile(join(ws, '.gitignore'), 'ignored.bin\n', 'utf8')
    await writeFile(join(ws, 'train.py'), 'print("ok")\n', 'utf8')
    await writeFile(join(ws, 'requirements.txt'), 'torch\n', 'utf8')
    await writeFile(join(ws, 'ignored.bin'), 'secret', 'utf8')

    const { candidates } = await inspectWorkspaceSyncCandidates(ws)
    const paths = candidates.map((c) => c.relativePath)
    expect(paths).toContain('train.py')
    expect(paths).toContain('requirements.txt')
    expect(paths).not.toContain('ignored.bin')
  })

  it('isolates active connections per workspace and handles OAuth mismatch promotion', async () => {
    const root = await createTempDir('kun-colab-svc-')
    const fetchCalls: string[] = []
    let nextEmail = 'alice@gmail.com'

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input)
      fetchCalls.push(url)
      if (url.includes('/tokeninfo')) {
        return new Response(
          JSON.stringify({
            email: nextEmail,
            scope: 'openid email https://www.googleapis.com/auth/colaboratory'
          }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify({
          access_token: `tok-${nextEmail}`,
          refresh_token: `ref-${nextEmail}`,
          expires_in: 3600,
          scope: 'openid email https://www.googleapis.com/auth/colaboratory'
        }),
        { status: 200 }
      )
    }

    const service = new ColabService({
      colabRootDir: root,
      safeStorage: mockSafeStorage as any,
      openExternal: async () => undefined,
      getColabSettings: () => defaultKunColabSettings(),
      fetchImpl: fakeFetch
    })

    const loginA = await service.startOAuthLogin({
      name: '个人',
      setAsCurrent: true,
      workspaceRoot: '/projects/ws-a'
    })
    expect(loginA.ok).toBe(true)
    if (!loginA.ok) return
    const outA = await service.submitManualCode(loginA.flow.flowId, 'auth-code-a')
    expect(outA.ok && outA.kind === 'created').toBe(true)

    nextEmail = 'lab@univ.edu'
    const loginB = await service.startOAuthLogin({
      name: '实验室',
      setAsCurrent: true,
      workspaceRoot: '/projects/ws-b'
    })
    expect(loginB.ok).toBe(true)
    if (!loginB.ok) return
    const outB = await service.submitManualCode(loginB.flow.flowId, 'auth-code-b')
    expect(outB.ok && outB.kind === 'created').toBe(true)

    const snap = await service.getSnapshot()
    expect(snap.connections).toHaveLength(2)
    expect(snap.workspaceConnections['/projects/ws-a']).toBe(snap.connections[0]!.id)
    expect(snap.workspaceConnections['/projects/ws-b']).toBe(snap.connections[1]!.id)

    // Switching ws-a must not mutate ws-b
    await service.selectWorkspaceConnection('/projects/ws-a', snap.connections[1]!.id)
    const snap2 = await service.getSnapshot()
    expect(snap2.workspaceConnections['/projects/ws-a']).toBe(snap.connections[1]!.id)
    expect(snap2.workspaceConnections['/projects/ws-b']).toBe(snap.connections[1]!.id)

    // Reauth conn[0] with wrong email triggers email_mismatch, and promote adds 3rd connection
    nextEmail = 'third@gmail.com'
    const reauth = await service.startOAuthLogin({
      reauthConnectionId: snap.connections[0]!.id,
      workspaceRoot: '/projects/ws-a'
    })
    expect(reauth.ok).toBe(true)
    if (!reauth.ok) return
    const mismatch = await service.submitManualCode(reauth.flow.flowId, 'code-mismatch')
    expect(!mismatch.ok && mismatch.kind === 'email_mismatch').toBe(true)
    if (!mismatch.ok && mismatch.pendingTokenId) {
      const promoted = await service.promoteMismatchedToken({
        pendingTokenId: mismatch.pendingTokenId,
        name: '备用号',
        workspaceRoot: '/projects/ws-a'
      })
      expect(promoted.ok && promoted.kind === 'created').toBe(true)
    }

    const snap3 = await service.getSnapshot()
    expect(snap3.connections).toHaveLength(3)
    expect(fetchCalls.length).toBeGreaterThan(0)
    await service.shutdown()
  })
})
