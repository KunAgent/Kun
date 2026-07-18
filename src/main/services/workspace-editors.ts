import { app, nativeImage, shell } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, stat, unlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, posix } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  EditorInfo,
  EditorListResult,
  EditorOpenResult,
  OpenEditorPathOptions
} from '../../shared/editor'
import { pathExists, resolveOpenTargetPath } from './workspace-paths'

const execFileAsync = promisify(execFile)

type EditorLineStyle = 'vscode' | 'xcode' | 'sublime' | 'zed'

type EditorCandidate = {
  id: string
  label: string
  kind: EditorInfo['kind']
  commands?: string[]
  commonCommandPaths?: string[]
  macAppName?: string
  macAppPaths?: string[]
  macAppPathResolver?: () => Promise<string | undefined>
  winAppPaths?: string[]
  iconNames?: string[]
  linuxDesktopIds?: string[]
  lineStyle?: EditorLineStyle
  alwaysAvailable?: boolean
  openDirectory?: boolean
  platforms?: NodeJS.Platform[]
}

type ResolvedEditor = EditorInfo & {
  command?: string
  macAppName?: string
  appPath?: string
  iconPaths?: string[]
  lineStyle?: EditorLineStyle
  openDirectory?: boolean
}

const DEFAULT_EDITOR_ID = 'system'
const PRESENTATION_FILE_SUFFIXES = ['.ppt', '.pptx', '.kun-ppt.html'] as const
const MAX_KUN_PRESENTATION_HTML_BYTES = 900_000
const EDITOR_ICON_SOURCE_PX = 64
const LINUX_ICON_SIZES = ['512x512', '256x256', '128x128', '64x64', '48x48', '32x32', '24x24', '16x16']
const ICON_IMAGE_EXTENSIONS = ['.png', '.ico', '.jpg', '.jpeg', '.webp', '.svg']

const EDITOR_CANDIDATES: EditorCandidate[] = [
  {
    id: 'vscode',
    label: 'VS Code',
    kind: 'editor',
    commands: ['code'],
    commonCommandPaths: [
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    ],
    macAppName: 'Visual Studio Code',
    macAppPaths: [
      '/Applications/Visual Studio Code.app',
      join(homedir(), 'Applications/Visual Studio Code.app')
    ],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Microsoft VS Code', 'Code.exe')
    ],
    iconNames: ['code'],
    linuxDesktopIds: ['code', 'com.visualstudio.code'],
    lineStyle: 'vscode'
  },
  {
    id: 'cursor',
    label: 'Cursor',
    kind: 'editor',
    commands: ['cursor'],
    commonCommandPaths: [
      '/usr/local/bin/cursor',
      '/opt/homebrew/bin/cursor',
      '/Applications/Cursor.app/Contents/Resources/app/bin/cursor'
    ],
    macAppName: 'Cursor',
    macAppPaths: ['/Applications/Cursor.app', join(homedir(), 'Applications/Cursor.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Cursor', 'Cursor.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Cursor', 'Cursor.exe')
    ],
    iconNames: ['cursor'],
    linuxDesktopIds: ['cursor', 'Cursor'],
    lineStyle: 'vscode'
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    kind: 'editor',
    commands: ['windsurf'],
    commonCommandPaths: [
      '/usr/local/bin/windsurf',
      '/opt/homebrew/bin/windsurf',
      '/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf'
    ],
    macAppName: 'Windsurf',
    macAppPaths: ['/Applications/Windsurf.app', join(homedir(), 'Applications/Windsurf.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Windsurf', 'Windsurf.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Windsurf', 'Windsurf.exe')
    ],
    iconNames: ['windsurf'],
    linuxDesktopIds: ['windsurf', 'Windsurf'],
    lineStyle: 'vscode'
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    kind: 'editor',
    commands: ['antigravity'],
    commonCommandPaths: [
      '/usr/local/bin/antigravity',
      '/opt/homebrew/bin/antigravity',
      '/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity'
    ],
    macAppName: 'Antigravity',
    macAppPaths: ['/Applications/Antigravity.app', join(homedir(), 'Applications/Antigravity.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Antigravity', 'Antigravity.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Antigravity', 'Antigravity.exe')
    ],
    iconNames: ['antigravity'],
    linuxDesktopIds: ['antigravity', 'Antigravity'],
    lineStyle: 'vscode'
  },
  {
    id: 'zed',
    label: 'Zed',
    kind: 'editor',
    commands: ['zed'],
    commonCommandPaths: ['/usr/local/bin/zed', '/opt/homebrew/bin/zed'],
    macAppName: 'Zed',
    macAppPaths: ['/Applications/Zed.app', join(homedir(), 'Applications/Zed.app')],
    winAppPaths: [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Zed', 'Zed.exe'),
      join(process.env.PROGRAMFILES ?? '', 'Zed', 'Zed.exe')
    ],
    iconNames: ['zed', 'dev.zed.Zed'],
    linuxDesktopIds: ['zed', 'dev.zed.Zed'],
    lineStyle: 'zed'
  },
  {
    id: 'sublime',
    label: 'Sublime Text',
    kind: 'editor',
    commands: ['subl', 'sublime_text'],
    commonCommandPaths: ['/usr/local/bin/subl', '/opt/homebrew/bin/subl'],
    macAppName: 'Sublime Text',
    macAppPaths: [
      '/Applications/Sublime Text.app',
      join(homedir(), 'Applications/Sublime Text.app')
    ],
    winAppPaths: [
      join(process.env.PROGRAMFILES ?? '', 'Sublime Text', 'sublime_text.exe'),
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Sublime Text', 'sublime_text.exe')
    ],
    iconNames: ['sublime_text', 'sublime-text'],
    linuxDesktopIds: ['sublime_text', 'sublime-text'],
    lineStyle: 'sublime'
  },
  {
    id: 'xcode',
    label: 'Xcode',
    kind: 'editor',
    commands: ['xed'],
    commonCommandPaths: ['/usr/bin/xed'],
    macAppName: 'Xcode',
    macAppPaths: ['/Applications/Xcode.app', join(homedir(), 'Applications/Xcode.app')],
    macAppPathResolver: resolveXcodeAppPath,
    lineStyle: 'xcode',
    platforms: ['darwin']
  },
  {
    id: 'finder',
    label: 'Finder',
    kind: 'viewer',
    alwaysAvailable: true,
    macAppName: 'Finder',
    macAppPaths: ['/System/Library/CoreServices/Finder.app'],
    platforms: ['darwin']
  },
  {
    id: 'file-manager',
    label: 'File Manager',
    kind: 'viewer',
    alwaysAvailable: true
  },
  {
    id: 'terminal',
    label: 'Terminal',
    kind: 'terminal',
    alwaysAvailable: true,
    macAppName: 'Terminal',
    macAppPaths: ['/System/Applications/Utilities/Terminal.app'],
    openDirectory: true,
    platforms: ['darwin']
  },
  {
    id: 'ghostty',
    label: 'Ghostty',
    kind: 'terminal',
    commands: ['ghostty'],
    commonCommandPaths: ['/usr/local/bin/ghostty', '/opt/homebrew/bin/ghostty'],
    macAppName: 'Ghostty',
    macAppPaths: ['/Applications/Ghostty.app', join(homedir(), 'Applications/Ghostty.app')],
    openDirectory: true
  },
  {
    id: 'system',
    label: 'System default',
    kind: 'viewer',
    alwaysAvailable: true
  }
]

export async function openPathWithShell(targetPath: string): Promise<{ ok: boolean; message?: string }> {
  const result = await shell.openPath(targetPath)
  return result ? { ok: false, message: result } : { ok: true }
}

function candidateSupportsPlatform(candidate: EditorCandidate): boolean {
  return !candidate.platforms || candidate.platforms.includes(process.platform)
}

function compactPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path?.trim()))
}

function commandPathGuesses(command: string): string[] {
  if (!command || command.includes('/') || command.includes('\\')) return [command]
  if (process.platform === 'win32') {
    return [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', command, `${command}.exe`),
      join(process.env.PROGRAMFILES ?? '', command, `${command}.exe`)
    ]
  }
  return [`/usr/local/bin/${command}`, `/opt/homebrew/bin/${command}`, `/usr/bin/${command}`]
}

async function findExecutable(commands: string[] = [], commonPaths: string[] = []): Promise<string | undefined> {
  const candidates = compactPaths([
    ...commonPaths,
    ...commands.flatMap((command) => commandPathGuesses(command))
  ])
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate
  }

  const lookup = process.platform === 'win32' ? 'where' : 'which'
  for (const command of commands) {
    try {
      const { stdout } = await execFileAsync(lookup, [command], {
        timeout: 1500,
        windowsHide: true
      })
      const first = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean)
      if (first) return first
    } catch {
      /* command is not on PATH */
    }
  }

  return undefined
}

async function findFirstExistingPath(paths: string[] = []): Promise<string | undefined> {
  for (const candidate of compactPaths(paths)) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

async function resolveXcodeAppPath(): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined

  try {
    const { stdout } = await execFileAsync('/usr/bin/xcode-select', ['-p'], {
      timeout: 1_500,
      windowsHide: true
    })
    const developerDir = stdout.trim()
    if (!developerDir.endsWith('/Contents/Developer')) return undefined
    const appPath = dirname(dirname(developerDir))
    return appPath.endsWith('.app') && (await pathExists(appPath)) ? appPath : undefined
  } catch {
    return undefined
  }
}

function iconResourceFileNames(iconNames: string[], platform: NodeJS.Platform): string[] {
  const names = iconNames.flatMap((iconName) => {
    if (platform === 'win32') {
      return [
        `${iconName}_256x256.png`,
        `${iconName}_150x150.png`,
        `${iconName}_70x70.png`,
        `${iconName}.png`,
        `${iconName}.ico`
      ]
    }
    return [`${iconName}.png`, `${iconName}.svg`, `${iconName}.ico`]
  })

  return [...new Set([...names, 'icon.png', 'icon.ico', 'app.png', 'app.ico'])]
}

function commandResourceIconPaths(command: string | undefined, iconNames: string[] = []): string[] {
  if (!command || iconNames.length === 0) return []

  const commandDir = dirname(command)
  const resourceDirs =
    process.platform === 'win32'
      ? [
          join(commandDir, 'resources', 'app', 'resources', 'win32'),
          join(commandDir, 'resources', 'app', 'build'),
          join(commandDir, 'resources'),
          commandDir
        ]
      : [
          join(commandDir, 'resources', 'app', 'resources', 'linux'),
          join(commandDir, 'resources', 'app', 'build'),
          join(commandDir, 'resources')
        ]

  return resourceDirs.flatMap((dir) =>
    iconResourceFileNames(iconNames, process.platform).map((fileName) => join(dir, fileName))
  )
}

function linuxIconNamePaths(iconName: string): string[] {
  if (isAbsolute(iconName)) {
    const ext = extname(iconName)
    return ext ? [iconName] : ICON_IMAGE_EXTENSIONS.map((extension) => `${iconName}${extension}`)
  }

  const home = homedir()
  const roots = [
    '/usr/share/icons/hicolor',
    '/usr/local/share/icons/hicolor',
    join(home, '.local', 'share', 'icons', 'hicolor'),
    '/var/lib/flatpak/exports/share/icons/hicolor',
    join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'icons', 'hicolor')
  ]
  const themed = roots.flatMap((root) =>
    LINUX_ICON_SIZES.flatMap((size) =>
      ICON_IMAGE_EXTENSIONS.map((extension) => posix.join(root, size, 'apps', `${iconName}${extension}`))
    )
  )
  const pixmaps = ['/usr/share/pixmaps', '/usr/local/share/pixmaps'].flatMap((root) =>
    ICON_IMAGE_EXTENSIONS.map((extension) => posix.join(root, `${iconName}${extension}`))
  )

  return [...themed, ...pixmaps]
}

function linuxDesktopFilePaths(desktopIds: string[]): string[] {
  const home = homedir()
  const roots = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    join(home, '.local', 'share', 'applications'),
    '/var/lib/flatpak/exports/share/applications',
    join(home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications')
  ]

  return roots.flatMap((root) => desktopIds.map((desktopId) => posix.join(root, `${desktopId}.desktop`)))
}

async function linuxDesktopIconNames(desktopIds: string[] = []): Promise<string[]> {
  if (process.platform !== 'linux' || desktopIds.length === 0) return []

  const iconNames: string[] = []
  for (const desktopPath of linuxDesktopFilePaths(desktopIds)) {
    if (!(await pathExists(desktopPath))) continue
    try {
      const source = await readFile(desktopPath, 'utf8')
      const iconLine = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith('Icon='))
      const iconName = iconLine?.slice('Icon='.length).trim()
      if (iconName) iconNames.push(iconName)
    } catch {
      /* 忽略不可读的 desktop entry */
    }
  }

  return iconNames
}

async function findFirstExistingIconPath(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

async function buildIconCandidatePaths(candidate: EditorCandidate, command: string | undefined): Promise<string[]> {
  const iconNames = candidate.iconNames ?? []
  const paths = commandResourceIconPaths(command, iconNames)

  if (process.platform !== 'linux') return paths

  const desktopIconNames = await linuxDesktopIconNames(candidate.linuxDesktopIds)
  const linuxNames = [...new Set([...desktopIconNames, ...iconNames])]
  return [
    ...paths,
    ...linuxNames.flatMap((iconName) => linuxIconNamePaths(iconName))
  ]
}

async function resolveEditor(candidate: EditorCandidate): Promise<ResolvedEditor | null> {
  if (!candidateSupportsPlatform(candidate)) return null

  const command = await findExecutable(candidate.commands, [
    ...(candidate.commonCommandPaths ?? []),
    ...(process.platform === 'win32' ? candidate.winAppPaths ?? [] : [])
  ])
  const macAppPath =
    process.platform === 'darwin'
      ? (await findFirstExistingPath(candidate.macAppPaths)) ?? (await candidate.macAppPathResolver?.())
      : undefined
  const available = Boolean(candidate.alwaysAvailable || command || macAppPath)
  if (!available) return null
  const iconPaths = await buildIconCandidatePaths(candidate, command)

  return {
    id: candidate.id,
    label: candidate.label,
    kind: candidate.kind,
    available: true,
    supportsLine: Boolean(command && candidate.lineStyle),
    detail: command ? basename(command) : macAppPath ? 'Installed app' : undefined,
    command,
    macAppName: candidate.macAppName,
    appPath: macAppPath ?? (process.platform === 'win32' ? command : undefined),
    iconPaths,
    lineStyle: candidate.lineStyle,
    openDirectory: candidate.openDirectory
  }
}

async function getAvailableEditors(): Promise<ResolvedEditor[]> {
  const editors = await Promise.all(EDITOR_CANDIDATES.map(resolveEditor))
  return editors.filter((editor): editor is ResolvedEditor => editor !== null)
}

function defaultEditorId(editors: ResolvedEditor[]): string {
  return (
    editors.find((editor) => editor.kind === 'editor' && editor.supportsLine)?.id ??
    editors.find((editor) => editor.kind === 'editor')?.id ??
    DEFAULT_EDITOR_ID
  )
}

function isValidIconDataUrl(dataUrl: string | undefined): dataUrl is string {
  if (!dataUrl) return false
  const marker = ';base64,'
  const index = dataUrl.indexOf(marker)
  if (index === -1) return false
  return dataUrl.length - index - marker.length > 48
}

function nativeImageToDataUrl(image: Electron.NativeImage): string | undefined {
  if (image.isEmpty()) return undefined
  const resized = image.resize({
    width: EDITOR_ICON_SOURCE_PX,
    height: EDITOR_ICON_SOURCE_PX,
    quality: 'best'
  })
  const source = resized.isEmpty() ? image : resized
  const buffer = source.toPNG()
  if (!buffer?.length) return undefined
  const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
  return isValidIconDataUrl(dataUrl) ? dataUrl : undefined
}

async function macIcnsPathToDataUrl(iconPath: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined
  const tmpPng = join(tmpdir(), `ds-gui-icon-${randomUUID()}.png`)
  try {
    await execFileAsync(
      '/usr/bin/sips',
      [
        '-s',
        'format',
        'png',
        '-z',
        String(EDITOR_ICON_SOURCE_PX),
        String(EDITOR_ICON_SOURCE_PX),
        iconPath,
        '--out',
        tmpPng
      ],
      { timeout: 5_000, windowsHide: true }
    )
    const buffer = await readFile(tmpPng)
    if (!buffer.length) return undefined
    const dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
    return isValidIconDataUrl(dataUrl) ? dataUrl : undefined
  } catch {
    return undefined
  } finally {
    await unlink(tmpPng).catch(() => {})
  }
}

async function getFileIconDataUrl(targetPath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'large' })
    return nativeImageToDataUrl(icon)
  } catch {
    return undefined
  }
}

async function explicitIconFileDataUrl(iconPath: string): Promise<string | undefined> {
  const extension = extname(iconPath).toLowerCase()

  try {
    if (extension === '.svg') {
      const buffer = await readFile(iconPath)
      if (!buffer.length) return undefined
      return `data:image/svg+xml;base64,${buffer.toString('base64')}`
    }

    if (extension === '.ico') {
      const icon = nativeImage.createFromPath(iconPath)
      return nativeImageToDataUrl(icon)
    }

    const buffer = await readFile(iconPath)
    if (!buffer.length) return undefined
    return nativeImageToDataUrl(nativeImage.createFromBuffer(buffer))
  } catch {
    return undefined
  }
}

async function macAppBundleIconDataUrl(appPath: string): Promise<string | undefined> {
  const infoPlistPath = join(appPath, 'Contents', 'Info')

  try {
    const { stdout } = await execFileAsync('/usr/bin/defaults', ['read', infoPlistPath, 'CFBundleIconFile'], {
      timeout: 2_000,
      windowsHide: true
    })
    const rawIconName = stdout.trim()
    if (rawIconName) {
      const fileName = rawIconName.endsWith('.icns') ? rawIconName : `${rawIconName}.icns`
      const iconPath = join(appPath, 'Contents', 'Resources', fileName)
      if (await pathExists(iconPath)) {
        const fromSips = await macIcnsPathToDataUrl(iconPath)
        if (fromSips) return fromSips
      }
    }
  } catch {
    /* try getFileIcon fallback below */
  }

  return getFileIconDataUrl(appPath)
}

async function editorIconDataUrl(editor: ResolvedEditor): Promise<string | undefined> {
  if (process.platform === 'darwin' && editor.appPath?.endsWith('.app')) {
    const bundleIcon = await macAppBundleIconDataUrl(editor.appPath)
    if (bundleIcon) return bundleIcon
  }

  const explicitIconPath = await findFirstExistingIconPath(editor.iconPaths ?? [])
  if (explicitIconPath) {
    const icon = await explicitIconFileDataUrl(explicitIconPath)
    if (icon) return icon
  }

  const commandIconPath =
    editor.command && process.platform !== 'darwin' && (isAbsolute(editor.command) || process.platform === 'win32')
      ? editor.command
      : undefined
  const targetPath = editor.appPath ?? commandIconPath

  if (!targetPath) return undefined
  return getFileIconDataUrl(targetPath)
}

export async function listEditorsResult(): Promise<EditorListResult> {
  const editors = await getAvailableEditors()
  const icons = await Promise.all(editors.map((editor) => editorIconDataUrl(editor)))
  return {
    editors: editors.map(
      (
        {
          command: _command,
          macAppName: _macAppName,
          appPath: _appPath,
          iconPaths: _iconPaths,
          lineStyle: _lineStyle,
          openDirectory: _openDirectory,
          ...editor
        },
        index
      ) => ({
        ...editor,
        ...(isValidIconDataUrl(icons[index]) ? { iconDataUrl: icons[index] } : {})
      })
    ),
    defaultEditorId: defaultEditorId(editors)
  }
}

function formatPathForEditor(targetPath: string, line?: number, column?: number): string {
  const safeLine = typeof line === 'number' && line > 0 ? Math.floor(line) : undefined
  const safeColumn = typeof column === 'number' && column > 0 ? Math.floor(column) : undefined
  if (!safeLine) return targetPath
  return `${targetPath}:${safeLine}${safeColumn ? `:${safeColumn}` : ''}`
}

function buildEditorArgs(editor: ResolvedEditor, targetPath: string, line?: number, column?: number): string[] {
  if (editor.openDirectory) return [targetPath]
  if (!editor.lineStyle || !line) return [targetPath]

  if (editor.lineStyle === 'xcode') return ['-l', String(Math.floor(line)), targetPath]
  if (editor.lineStyle === 'vscode') return ['-g', formatPathForEditor(targetPath, line, column)]
  if (editor.lineStyle === 'sublime' || editor.lineStyle === 'zed') {
    return [formatPathForEditor(targetPath, line, column)]
  }
  return [targetPath]
}

async function directoryForOpenTarget(targetPath: string): Promise<string> {
  try {
    const info = await stat(targetPath)
    return info.isDirectory() ? targetPath : dirname(targetPath)
  } catch {
    return dirname(targetPath)
  }
}

async function openWithResolvedEditor(
  editor: ResolvedEditor,
  targetPath: string,
  line?: number,
  column?: number
): Promise<void> {
  if (editor.id === 'finder' || editor.id === 'file-manager') {
    shell.showItemInFolder(targetPath)
    return
  }

  if (editor.id === 'system') {
    const result = await openPathWithShell(targetPath)
    if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
    return
  }

  const openTarget = editor.openDirectory ? await directoryForOpenTarget(targetPath) : targetPath

  if (editor.command) {
    try {
      await execFileAsync(editor.command, buildEditorArgs(editor, openTarget, line, column), {
        timeout: 10_000,
        windowsHide: true
      })
      return
    } catch (error) {
      if (process.platform !== 'darwin' || !editor.macAppName) throw error
    }
  }

  if (process.platform === 'darwin' && editor.macAppName) {
    await execFileAsync('open', ['-a', editor.macAppName, openTarget], {
      timeout: 10_000,
      windowsHide: true
    })
    return
  }

  const result = await openPathWithShell(openTarget)
  if (!result.ok) throw new Error(result.message ?? 'Could not open path.')
}

export async function openEditorPath(payload: OpenEditorPathOptions): Promise<EditorOpenResult> {
  try {
    const editors = await getAvailableEditors()
    const fallbackId = defaultEditorId(editors)
    const requestedId = payload.editorId?.trim()
    const editor =
      editors.find((item) => item.id === requestedId) ??
      editors.find((item) => item.id === fallbackId) ??
      editors.find((item) => item.id === DEFAULT_EDITOR_ID)
    if (!editor) throw new Error('No editor or system opener is available.')

    const targetPath = payload.openPolicy
      ? await resolveOpenTargetPath(payload.path, payload.workspaceRoot, { allowBasenameFallback: false })
      : await resolveOpenTargetPath(payload.path, payload.workspaceRoot)
    if (payload.openPolicy === 'presentation-artifact') {
      const info = await stat(targetPath)
      if (!info.isFile()) throw new Error('Path must point to a regular file.')
      const normalizedTarget = targetPath.toLowerCase()
      if (!PRESENTATION_FILE_SUFFIXES.some((suffix) => normalizedTarget.endsWith(suffix))) {
        throw new Error('Resolved file type is not allowed for this action.')
      }
      if (editor.id === 'system' && normalizedTarget.endsWith('.kun-ppt.html')) {
        const expectedSha256 = payload.expectedSha256?.toLowerCase()
        if (!expectedSha256) throw new Error('Verified presentation digest is required.')
        if (info.size > MAX_KUN_PRESENTATION_HTML_BYTES) {
          throw new Error('Presentation HTML exceeds the verified open limit.')
        }
        const content = await readFile(targetPath)
        const actualSha256 = createHash('sha256').update(content).digest('hex')
        if (actualSha256 !== expectedSha256) {
          throw new Error('Presentation changed after it was generated. Save it again in Kun PPT before opening.')
        }
      }
    }
    await openWithResolvedEditor(editor, targetPath, payload.line, payload.column)
    return { ok: true, path: targetPath, editorId: editor.id }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
