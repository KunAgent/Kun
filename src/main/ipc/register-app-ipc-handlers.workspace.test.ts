import {
  cleanupAppIpcHandlerTestState,
  getAppIpcElectronMock,
  handlers,
  registerOptions,
  resetAppIpcHandlerTestState,
  settings
} from './register-app-ipc-handlers.test-support'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  EventEmitter
} from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import {
  tmpdir
} from 'node:os'
import {
  join
} from 'node:path'
import {
  mergeScheduleSettings,
  type AppSettingsPatch
} from '../../shared/app-settings'
import {
  registerAppIpcHandlers
} from './register-app-ipc-handlers'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

const officeDocumentServiceMocks = vi.hoisted(() => ({
  readWorkspaceOfficePreview: vi.fn(),
  readWorkspaceOfficeSemantic: vi.fn()
}))
const officeCliResourceMocks = vi.hoisted(() => ({
  resolveOfficeCliBinary: vi.fn()
}))
const spreadsheetServiceMocks = vi.hoisted(() => ({
  saveWorkspaceSpreadsheet: vi.fn(),
  convertWorkspaceSpreadsheet: vi.fn()
}))

vi.mock('../services/office-document-service', () => ({
  readLocalOfficeDocument: vi.fn()
}))

vi.mock('../services/office-workspace-preview-service', () => ({
  readWorkspaceOfficePreview: officeDocumentServiceMocks.readWorkspaceOfficePreview
}))

vi.mock('../services/office-workspace-semantic-service', () => ({
  readWorkspaceOfficeSemantic: officeDocumentServiceMocks.readWorkspaceOfficeSemantic
}))

vi.mock('../services/workspace-spreadsheet-service', () => spreadsheetServiceMocks)

vi.mock('../officecli-resources', () => ({
  resolveOfficeCliBinary: officeCliResourceMocks.resolveOfficeCliBinary
}))

const electronMock = getAppIpcElectronMock()

describe('registerAppIpcHandlers workspace and MCP', () => {
  beforeEach(() => {
    resetAppIpcHandlerTestState()
    officeDocumentServiceMocks.readWorkspaceOfficePreview.mockReset()
    officeDocumentServiceMocks.readWorkspaceOfficeSemantic.mockReset()
    officeCliResourceMocks.resolveOfficeCliBinary.mockReset()
    spreadsheetServiceMocks.saveWorkspaceSpreadsheet.mockReset()
    spreadsheetServiceMocks.convertWorkspaceSpreadsheet.mockReset()
  })
  afterEach(cleanupAppIpcHandlerTestState)

  it('saves generated files to a user-selected path', async () => {
    const { dialog } = await import('electron')
    const temp = mkdtempSync(join(tmpdir(), 'kun-save-as-'))
    const source = join(temp, 'source.png')
    const target = join(temp, 'downloaded.png')
    writeFileSync(source, 'generated-image')
    ;(dialog as unknown as { showSaveDialog: ReturnType<typeof vi.fn> }).showSaveDialog = vi.fn(async () => ({
      canceled: false,
      filePath: target
    }))

    try {
      registerAppIpcHandlers(registerOptions())

      const handler = handlers.get('file:save-as')
      await expect(handler?.({}, {
        sourcePath: source,
        suggestedName: 'source.png',
        mimeType: 'image/png'
      })).resolves.toEqual({ ok: true, path: target })
      expect(readFileSync(target, 'utf8')).toBe('generated-image')
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('opens and reveals only runtime-validated generated artifacts', async () => {
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const mainContents = { id: 1, mainFrame }
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        artifactId: 'artifact_1234567890',
        absolutePath: '/tmp/workspace/exports/final.mp4',
        displayName: 'final.mp4',
        mimeType: 'video/mp4'
      })
    }))
    registerAppIpcHandlers(registerOptions({
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: mainContents
      }) as never,
      runtimeRequest
    }))
    const handler = handlers.get('extension:artifact:open')!
    const payload = {
      artifactId: 'artifact_1234567890',
      ownerExtensionId: 'kun.video-editor',
      ownerExtensionVersion: '1.1.0',
      workspaceId: 'a'.repeat(64),
      workspaceRoot: '/tmp/workspace',
      action: 'open'
    }
    await expect(handler({ sender: mainContents, senderFrame: mainFrame }, payload))
      .resolves.toEqual({ ok: true })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/extensions/media/artifacts/resolve',
      'POST',
      JSON.stringify({
        artifactId: payload.artifactId,
        ownerExtensionId: payload.ownerExtensionId,
        ownerExtensionVersion: payload.ownerExtensionVersion,
        workspaceId: payload.workspaceId,
        workspaceRoot: payload.workspaceRoot
      })
    )
    expect(electronMock.openPath).toHaveBeenCalledWith('/tmp/workspace/exports/final.mp4')

    await expect(handler(
      { sender: mainContents, senderFrame: mainFrame },
      { ...payload, action: 'reveal' }
    )).resolves.toEqual({ ok: true })
    expect(electronMock.showItemInFolder).toHaveBeenCalledWith('/tmp/workspace/exports/final.mp4')
    await expect(handler(
      { sender: { id: 99 }, senderFrame: { processId: 99, routingId: 99, url: 'http://127.0.0.1:5173/index.html' } },
      payload
    )).rejects.toThrow(/trusted workbench frame/)
  })

  it('keeps workspace watches alive across atomic replacements and releases the sender listener', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-watch-atomic-'))
    const target = join(temp, 'motion.svg')
    writeFileSync(target, '<svg id="one"/>')
    const sender = Object.assign(new EventEmitter(), {
      id: 73,
      send: vi.fn(),
      isDestroyed: () => false
    })

    try {
      registerAppIpcHandlers(registerOptions())
      const watchHandler = handlers.get('file:watch-workspace')
      const unwatchHandler = handlers.get('file:unwatch-workspace')
      const result = await watchHandler?.({ sender }, { path: 'motion.svg', workspaceRoot: temp }) as {
        ok: boolean
        watchId?: string
      }
      expect(result.ok).toBe(true)
      expect(result.watchId).toBeTruthy()
      expect(sender.listenerCount('destroyed')).toBe(1)
      writeFileSync(join(temp, 'other.svg'), '<svg/>')
      const secondResult = await watchHandler?.({ sender }, { path: 'other.svg', workspaceRoot: temp }) as {
        ok: boolean
        watchId?: string
      }
      expect(secondResult.ok).toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(1)

      const replace = (source: string, content: string): void => {
        const staged = join(temp, source)
        writeFileSync(staged, content)
        renameSync(staged, target)
      }
      replace('.motion-first.tmp', '<svg id="two"/>')
      await vi.waitFor(() => {
        expect(sender.send).toHaveBeenCalledWith(
          'file:workspace-changed',
          expect.objectContaining({ ok: true, content: '<svg id="two"/>' })
        )
      }, { timeout: 5_000 })

      replace('.motion-second.tmp', '<svg id="three"/>')
      await vi.waitFor(() => {
        expect(sender.send).toHaveBeenCalledWith(
          'file:workspace-changed',
          expect.objectContaining({ ok: true, content: '<svg id="three"/>' })
        )
      }, { timeout: 5_000 })

      await expect(unwatchHandler?.({}, result.watchId)).resolves.toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(1)
      await expect(unwatchHandler?.({}, secondResult.watchId)).resolves.toBe(true)
      expect(sender.listenerCount('destroyed')).toBe(0)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('watches binary files in signal mode without sending their contents', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-watch-signal-'))
    const target = join(temp, 'report.docx')
    writeFileSync(target, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]))
    const resolvedTarget = realpathSync.native(target)
    const sender = Object.assign(new EventEmitter(), {
      id: 74,
      send: vi.fn(),
      isDestroyed: () => false
    })

    try {
      registerAppIpcHandlers(registerOptions())
      const watchHandler = handlers.get('file:watch-workspace')
      const unwatchHandler = handlers.get('file:unwatch-workspace')
      const result = await watchHandler?.({ sender }, {
        path: 'report.docx',
        workspaceRoot: temp,
        mode: 'signal'
      }) as {
        ok: boolean
        watchId?: string
        mode?: string
        path?: string
        size?: number
        mtimeMs?: number
        content?: string
      }

      expect(result).toMatchObject({
        ok: true,
        mode: 'signal',
        path: resolvedTarget,
        size: 6,
        content: ''
      })
      expect(result.mtimeMs).toEqual(expect.any(Number))
      expect(result.watchId).toBeTruthy()

      const staged = join(temp, '.report.tmp')
      writeFileSync(staged, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0xff, 0x7f]))
      renameSync(staged, target)
      await vi.waitFor(() => {
        expect(sender.send).toHaveBeenCalledWith(
          'file:workspace-changed',
          expect.objectContaining({
            ok: true,
            mode: 'signal',
            path: resolvedTarget,
            size: 7,
            content: '',
            truncated: false
          })
        )
      }, { timeout: 5_000 })
      const event = (sender.send as ReturnType<typeof vi.fn>).mock.calls.find((call) =>
        call[0] === 'file:workspace-changed' && (call[1] as { mode?: string }).mode === 'signal'
      )?.[1] as { mtimeMs?: number } | undefined
      expect(event?.mtimeMs).toEqual(expect.any(Number))

      await expect(unwatchHandler?.({}, result.watchId)).resolves.toBe(true)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('reads Office previews through the trusted, workspace-bounded IPC route', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-office-preview-'))
    const target = join(temp, 'report.docx')
    writeFileSync(target, 'office-preview-source')
    const resolvedTarget = realpathSync.native(target)
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const sender = Object.assign(new EventEmitter(), {
      id: 76,
      mainFrame,
      isDestroyed: () => false
    })
    const preview = {
      ok: true as const,
      path: resolvedTarget,
      name: 'report.docx',
      sourceFormat: 'docx' as const,
      renderFormat: 'docx' as const,
      viewer: 'word' as const,
      size: 21,
      mtimeMs: 1,
      sourceSha256: 'b'.repeat(64),
      data: new Uint8Array([1, 2, 3])
    }

    try {
      officeDocumentServiceMocks.readWorkspaceOfficePreview.mockResolvedValue(preview)
      registerAppIpcHandlers(registerOptions({
        getMainWindow: () => ({
          isDestroyed: () => false,
          webContents: sender
        }) as never
      }))
      const handler = handlers.get('file:read-workspace-office-preview')!
      const payload = {
        path: 'report.docx',
        workspaceRoot: temp,
        expectedSha256: 'a'.repeat(64)
      }

      await expect(handler({ sender, senderFrame: mainFrame }, payload)).resolves.toEqual(preview)
      expect(officeDocumentServiceMocks.readWorkspaceOfficePreview).toHaveBeenCalledWith(
        {
          path: resolvedTarget,
          expectedSha256: payload.expectedSha256
        },
        expect.not.objectContaining({ binaryPath: expect.anything() })
      )
      expect(officeCliResourceMocks.resolveOfficeCliBinary).not.toHaveBeenCalled()
      const dependencies = officeDocumentServiceMocks.readWorkspaceOfficePreview.mock.calls[0]?.[1] as {
        signal?: AbortSignal
      }
      expect(typeof dependencies.signal?.addEventListener).toBe('function')

      await expect(handler({ sender, senderFrame: mainFrame }, {
        ...payload,
        path: '../outside.docx'
      })).resolves.toMatchObject({ ok: false })
      await expect(handler({ sender, senderFrame: mainFrame }, {
        ...payload,
        expectedSha256: 'not-a-sha'
      })).rejects.toThrow(/expectedSha256/)
      expect(officeDocumentServiceMocks.readWorkspaceOfficePreview).toHaveBeenCalledTimes(1)

      await expect(handler({
        sender: { id: 99 },
        senderFrame: { processId: 99, routingId: 99, url: 'http://127.0.0.1:5173/index.html' }
      }, payload)).rejects.toThrow(/trusted workbench frame/)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('reads bounded Office semantics through the same workspace and SHA gate', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-office-semantic-'))
    const target = join(temp, 'report.docx')
    writeFileSync(target, 'office-semantic-source')
    const resolvedTarget = realpathSync.native(target)
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const sender = Object.assign(new EventEmitter(), {
      id: 77,
      mainFrame,
      isDestroyed: () => false
    })
    const semantic = {
      ok: true as const,
      path: resolvedTarget,
      name: 'report.docx',
      sourceFormat: 'docx' as const,
      sourceSha256: 'c'.repeat(64),
      text: 'semantic text',
      truncated: false
    }

    try {
      officeCliResourceMocks.resolveOfficeCliBinary.mockReturnValue('/tmp/officecli')
      officeDocumentServiceMocks.readWorkspaceOfficeSemantic.mockResolvedValue(semantic)
      registerAppIpcHandlers(registerOptions({
        getMainWindow: () => ({
          isDestroyed: () => false,
          webContents: sender
        }) as never
      }))
      const handler = handlers.get('file:read-workspace-office-semantic')!
      const payload = {
        path: 'report.docx',
        workspaceRoot: temp,
        expectedSha256: 'a'.repeat(64)
      }

      await expect(handler({ sender, senderFrame: mainFrame }, payload)).resolves.toEqual(semantic)
      expect(officeDocumentServiceMocks.readWorkspaceOfficeSemantic).toHaveBeenCalledWith(
        { path: resolvedTarget, expectedSha256: payload.expectedSha256 },
        expect.objectContaining({ binaryPath: '/tmp/officecli', signal: expect.any(AbortSignal) })
      )
      await expect(handler({ sender, senderFrame: mainFrame }, {
        ...payload,
        path: '../outside.docx'
      })).resolves.toMatchObject({ ok: false })
      expect(officeDocumentServiceMocks.readWorkspaceOfficeSemantic).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('saves and converts spreadsheets through trusted workspace-scoped IPC', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'kun-spreadsheet-ipc-'))
    const xlsxPath = join(temp, 'book.xlsx')
    const xlsPath = join(temp, 'legacy.xls')
    writeFileSync(xlsxPath, 'xlsx-source')
    writeFileSync(xlsPath, 'xls-source')
    const mainFrame = { processId: 10, routingId: 20, url: 'http://127.0.0.1:5173/index.html' }
    const sender = Object.assign(new EventEmitter(), {
      id: 78,
      mainFrame,
      isDestroyed: () => false
    })
    const expectedSha256 = 'a'.repeat(64)

    try {
      officeCliResourceMocks.resolveOfficeCliBinary.mockReturnValue('/tmp/officecli')
      spreadsheetServiceMocks.saveWorkspaceSpreadsheet.mockResolvedValue({
        ok: true,
        path: realpathSync.native(xlsxPath),
        sourceSha256: 'b'.repeat(64),
        size: 12,
        mtimeMs: 2,
        appliedMutations: 1
      })
      spreadsheetServiceMocks.convertWorkspaceSpreadsheet.mockResolvedValue({
        ok: true,
        path: join(temp, 'legacy.xlsx'),
        name: 'legacy.xlsx',
        sourceSha256: 'c'.repeat(64),
        size: 14,
        mtimeMs: 3
      })
      registerAppIpcHandlers(registerOptions({
        getMainWindow: () => ({
          isDestroyed: () => false,
          webContents: sender
        }) as never
      }))

      const saveHandler = handlers.get('file:save-workspace-spreadsheet')!
      const savePayload = {
        path: 'book.xlsx',
        workspaceRoot: temp,
        expectedSha256,
        mutations: [{ kind: 'cell', sheetName: 'Data', address: 'A1', value: 42 }]
      }
      await expect(saveHandler({ sender, senderFrame: mainFrame }, savePayload)).resolves.toMatchObject({ ok: true })
      expect(spreadsheetServiceMocks.saveWorkspaceSpreadsheet).toHaveBeenCalledWith({
        path: realpathSync.native(xlsxPath),
        expectedSha256,
        mutations: savePayload.mutations
      }, expect.objectContaining({ binaryPath: '/tmp/officecli', signal: expect.any(AbortSignal) }))

      const convertHandler = handlers.get('file:convert-workspace-spreadsheet')!
      await expect(convertHandler({ sender, senderFrame: mainFrame }, {
        path: 'legacy.xls', workspaceRoot: temp, expectedSha256
      })).resolves.toMatchObject({ ok: true, name: 'legacy.xlsx' })
      expect(spreadsheetServiceMocks.convertWorkspaceSpreadsheet).toHaveBeenCalledWith({
        path: realpathSync.native(xlsPath), expectedSha256
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }))

      await expect(saveHandler({ sender, senderFrame: mainFrame }, {
        ...savePayload, path: '../outside.xlsx'
      })).resolves.toMatchObject({ ok: false, code: 'invalid_request' })
      await expect(saveHandler({
        sender: { id: 99 },
        senderFrame: { processId: 99, routingId: 99, url: 'http://127.0.0.1:5173/index.html' }
      }, savePayload)).rejects.toThrow(/trusted workbench frame/)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('accepts the full settings snapshot emitted by SettingsView auto-apply', async () => {
    const applySettingsPatch = vi.fn(async () => settings())

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = { ...settings(), locale: 'zh' as const }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toEqual(settings())
    const { projectConfig: _projectConfig, ...safeKun } = payload.agents.kun
    void _projectConfig
    expect(applySettingsPatch).toHaveBeenCalledWith({
      ...payload,
      agents: { kun: safeKun }
    })
  })

  it('passes schedule settings patches through to applySettingsPatch', async () => {
    const applySettingsPatch = vi.fn(async (partial: AppSettingsPatch) => ({
      ...settings(),
      schedule: mergeScheduleSettings(settings().schedule, partial.schedule)
    }))

    registerAppIpcHandlers(registerOptions({ applySettingsPatch }))

    const payload = {
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{
          id: 'task-1',
          title: 'Daily',
          enabled: true,
          prompt: 'Run',
          schedule: { kind: 'manual' as const }
        }]
      }
    }
    const handler = handlers.get('settings:set')
    await expect(handler?.({}, payload)).resolves.toMatchObject({
      schedule: {
        enabled: true,
        keepAwake: true,
        tasks: [{ id: 'task-1', prompt: 'Run' }]
      }
    })
    expect(applySettingsPatch).toHaveBeenCalledWith(payload)
  })

  it('writes MCP config JSON and notifies the runtime apply hook', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)
    const content = `${JSON.stringify({
      servers: {
        filesystem: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp/project']
        }
      }
    }, null, 2)}\n`

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, content)).resolves.toEqual({
        ok: true,
        path: configPath
      })
      expect(readFileSync(configPath, 'utf8')).toBe(content)
      expect(onKunMcpConfigWritten).toHaveBeenCalledWith(configPath, content)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid MCP config JSON before writing or applying it', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'deepseek-gui-ipc-'))
    const configPath = join(tempRoot, 'mcp.json')
    const onKunMcpConfigWritten = vi.fn(async () => undefined)

    try {
      registerAppIpcHandlers(registerOptions({
        resolveKunConfigPath: () => configPath,
        onKunMcpConfigWritten
      }))

      await expect(handlers.get('kun:config:write')?.({}, '{')).rejects.toThrow(
        /MCP config must be JSON/
      )
      await expect(handlers.get('kun:config:write')?.({}, '[]')).rejects.toThrow(
        /MCP config must be a JSON object/
      )
      expect(existsSync(configPath)).toBe(false)
      expect(onKunMcpConfigWritten).not.toHaveBeenCalled()
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

})
