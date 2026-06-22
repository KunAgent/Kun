import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const imageBytes = Buffer.alloc(80, 0xab)

const electronMock = vi.hoisted(() => {
  function fakeImage(): Electron.NativeImage {
    const image = {
      isEmpty: vi.fn(() => false),
      resize: vi.fn(() => image),
      toPNG: vi.fn(() => Buffer.alloc(80, 0xab))
    }
    return image as unknown as Electron.NativeImage
  }

  return {
    getFileIcon: vi.fn(async () => fakeImage()),
    createFromBuffer: vi.fn(() => fakeImage()),
    createFromPath: vi.fn(() => fakeImage()),
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn()
  }
})

const workspacePathsMock = vi.hoisted(() => ({
  pathExists: vi.fn(async () => false),
  resolveOpenTargetPath: vi.fn(async (targetPath: string) => targetPath)
}))

const fsPromisesMock = vi.hoisted(() => ({
  readFile: vi.fn(async (): Promise<string | Buffer> => imageBytes),
  stat: vi.fn(),
  unlink: vi.fn(async () => undefined)
}))

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn((_: string, __: string[], ___: unknown, callback?: (error: Error | null) => void) => {
    callback?.(new Error('not found'))
  })
}))

vi.mock('electron', () => ({
  app: {
    getFileIcon: electronMock.getFileIcon
  },
  nativeImage: {
    createFromBuffer: electronMock.createFromBuffer,
    createFromPath: electronMock.createFromPath
  },
  shell: {
    openPath: electronMock.openPath,
    showItemInFolder: electronMock.showItemInFolder
  }
}))

vi.mock('node:child_process', () => childProcessMock)
vi.mock('node:fs/promises', () => fsPromisesMock)
vi.mock('./workspace-paths', () => workspacePathsMock)

const originalPlatform = process.platform
const originalLocalAppData = process.env.LOCALAPPDATA
const originalProgramFiles = process.env.PROGRAMFILES

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true
  })
}

function normalized(path: unknown): string {
  return String(path).replace(/\\/g, '/')
}

describe('workspace editor icons', () => {
  beforeEach(() => {
    vi.resetModules()
    electronMock.getFileIcon.mockClear()
    electronMock.createFromBuffer.mockClear()
    electronMock.createFromPath.mockClear()
    electronMock.openPath.mockClear()
    electronMock.showItemInFolder.mockClear()
    workspacePathsMock.pathExists.mockReset()
    workspacePathsMock.resolveOpenTargetPath.mockReset()
    workspacePathsMock.resolveOpenTargetPath.mockImplementation(async (targetPath: string) => targetPath)
    fsPromisesMock.readFile.mockReset()
    fsPromisesMock.readFile.mockResolvedValue(imageBytes)
    fsPromisesMock.unlink.mockClear()
    fsPromisesMock.stat.mockReset()
    childProcessMock.execFile.mockClear()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData
    }
    if (originalProgramFiles === undefined) {
      delete process.env.PROGRAMFILES
    } else {
      process.env.PROGRAMFILES = originalProgramFiles
    }
  })

  it('uses bundled Windows editor icon assets before falling back to executable icons', async () => {
    setPlatform('win32')
    process.env.LOCALAPPDATA = 'C:\\Users\\me\\AppData\\Local'
    process.env.PROGRAMFILES = 'C:\\Program Files'
    workspacePathsMock.pathExists.mockImplementation(async (...args: unknown[]) => {
      const path = args[0]
      const value = normalized(path)
      return value.endsWith('/Programs/Microsoft VS Code/Code.exe') ||
        value.endsWith('/Programs/Microsoft VS Code/resources/app/resources/win32/code_150x150.png')
    })

    const { listEditorsResult } = await import('./workspace-editors')
    const result = await listEditorsResult()
    const vscode = result.editors.find((editor) => editor.id === 'vscode')

    expect(vscode?.iconDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(fsPromisesMock.readFile).toHaveBeenCalledWith(
      expect.stringContaining('code_150x150.png')
    )
    expect(electronMock.createFromBuffer).toHaveBeenCalledTimes(1)
    expect(electronMock.getFileIcon).not.toHaveBeenCalled()
  })

  it('uses Linux desktop icon names before falling back to executable icons', async () => {
    setPlatform('linux')
    workspacePathsMock.pathExists.mockImplementation(async (...args: unknown[]) => {
      const path = args[0]
      const value = normalized(path)
      return value === '/usr/bin/code' ||
        value === '/usr/share/applications/code.desktop' ||
        value === '/usr/share/icons/hicolor/256x256/apps/code.png'
    })
    fsPromisesMock.readFile.mockImplementation(async (...args: unknown[]) => {
      const path = args[0]
      const encoding = args[1]
      const value = normalized(path)
      if (encoding === 'utf8' && value === '/usr/share/applications/code.desktop') {
        return '[Desktop Entry]\nName=Visual Studio Code\nIcon=code\n'
      }
      return imageBytes
    })

    const { listEditorsResult } = await import('./workspace-editors')
    const result = await listEditorsResult()
    const vscode = result.editors.find((editor) => editor.id === 'vscode')

    expect(vscode?.iconDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(fsPromisesMock.readFile).toHaveBeenCalledWith(
      '/usr/share/icons/hicolor/256x256/apps/code.png'
    )
    expect(electronMock.createFromBuffer).toHaveBeenCalledTimes(1)
    expect(electronMock.getFileIcon).not.toHaveBeenCalled()
  })
})
