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

export const execFileAsync = promisify(execFile)

export type EditorLineStyle = 'vscode' | 'xcode' | 'sublime' | 'zed'

export type EditorCandidate = {
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

export type ResolvedEditor = EditorInfo & {
  command?: string
  macAppName?: string
  appPath?: string
  iconPaths?: string[]
  lineStyle?: EditorLineStyle
  openDirectory?: boolean
}

export const DEFAULT_EDITOR_ID = 'system'

export const PRESENTATION_FILE_SUFFIXES = ['.ppt', '.pptx', '.kun-ppt.html'] as const

export const GENERATED_DOCUMENT_FILE_SUFFIXES = [
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.pdf',
  '.kun-ppt.html'
] as const

export const MAX_KUN_PRESENTATION_HTML_BYTES = 900_000

export const EDITOR_ICON_SOURCE_PX = 64

export const LINUX_ICON_SIZES = ['512x512', '256x256', '128x128', '64x64', '48x48', '32x32', '24x24', '16x16']

export const ICON_IMAGE_EXTENSIONS = ['.png', '.ico', '.jpg', '.jpeg', '.webp', '.svg']

export const EDITOR_CANDIDATES: EditorCandidate[] = [
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

export function candidateSupportsPlatform(candidate: EditorCandidate): boolean {
  return !candidate.platforms || candidate.platforms.includes(process.platform)
}

export function compactPaths(paths: Array<string | undefined>): string[] {
  return paths.filter((path): path is string => Boolean(path?.trim()))
}

export function commandPathGuesses(command: string): string[] {
  if (!command || command.includes('/') || command.includes('\\')) return [command]
  if (process.platform === 'win32') {
    return [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', command, `${command}.exe`),
      join(process.env.PROGRAMFILES ?? '', command, `${command}.exe`)
    ]
  }
  return [`/usr/local/bin/${command}`, `/opt/homebrew/bin/${command}`, `/usr/bin/${command}`]
}

export async function findExecutable(commands: string[] = [], commonPaths: string[] = []): Promise<string | undefined> {
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

export async function findFirstExistingPath(paths: string[] = []): Promise<string | undefined> {
  for (const candidate of compactPaths(paths)) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

export async function resolveXcodeAppPath(): Promise<string | undefined> {
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

export function iconResourceFileNames(iconNames: string[], platform: NodeJS.Platform): string[] {
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

export function commandResourceIconPaths(command: string | undefined, iconNames: string[] = []): string[] {
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

export function linuxIconNamePaths(iconName: string): string[] {
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

export function linuxDesktopFilePaths(desktopIds: string[]): string[] {
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

export async function linuxDesktopIconNames(desktopIds: string[] = []): Promise<string[]> {
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

export async function findFirstExistingIconPath(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    if (await pathExists(candidate)) return candidate
  }
  return undefined
}

export async function buildIconCandidatePaths(candidate: EditorCandidate, command: string | undefined): Promise<string[]> {
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

export async function resolveEditor(candidate: EditorCandidate): Promise<ResolvedEditor | null> {
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

export async function getAvailableEditors(): Promise<ResolvedEditor[]> {
  const editors = await Promise.all(EDITOR_CANDIDATES.map(resolveEditor))
  return editors.filter((editor): editor is ResolvedEditor => editor !== null)
}

export function defaultEditorId(editors: ResolvedEditor[]): string {
  return (
    editors.find((editor) => editor.kind === 'editor' && editor.supportsLine)?.id ??
    editors.find((editor) => editor.kind === 'editor')?.id ??
    DEFAULT_EDITOR_ID
  )
}

export function isValidIconDataUrl(dataUrl: string | undefined): dataUrl is string {
  if (!dataUrl) return false
  const marker = ';base64,'
  const index = dataUrl.indexOf(marker)
  if (index === -1) return false
  return dataUrl.length - index - marker.length > 48
}

export function nativeImageToDataUrl(image: Electron.NativeImage): string | undefined {
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

export async function macIcnsPathToDataUrl(iconPath: string): Promise<string | undefined> {
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

export async function getFileIconDataUrl(targetPath: string): Promise<string | undefined> {
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'large' })
    return nativeImageToDataUrl(icon)
  } catch {
    return undefined
  }
}

export async function explicitIconFileDataUrl(iconPath: string): Promise<string | undefined> {
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

export async function macAppBundleIconDataUrl(appPath: string): Promise<string | undefined> {
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

export async function editorIconDataUrl(editor: ResolvedEditor): Promise<string | undefined> {
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
