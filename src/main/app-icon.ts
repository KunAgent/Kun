import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeImage } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))

function usesWin32PathRules(baseDir: string): boolean {
  return (win32.isAbsolute(baseDir) && !baseDir.startsWith('/')) ||
    baseDir.startsWith('\\\\')
}

function isInsideDirectory(candidate: string, baseDir: string, useWin32: boolean): boolean {
  const relativePath = useWin32 ? win32.relative(baseDir, candidate) : relative(baseDir, candidate)
  const separator = useWin32 ? '\\' : sep
  const absoluteRelativePath = useWin32 ? win32.isAbsolute(relativePath) : isAbsolute(relativePath)
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${separator}`) &&
    !absoluteRelativePath
  )
}

/**
 * 解析 Vite/Rollup 给出的资产 URL,得到一个真实可读的文件系统路径。
 *
 * electron-vite 的 main config 用 Rollup 处理资源 —— 跟 renderer 不同,
 * main 的 `?url` import 在 dev 和打包后都返回 *相对于 main bundle* 的路径
 * (形如 `'chunks/deepseek-XXXX.png'`)。main bundle 输出在 `out/main/`,所以
 * 运行时 `__dirname = out/main/`,asset 在 `out/main/chunks/deepseek-XXXX.png`。
 *
 * 打包后 `__dirname` 在 `app.asar` 内,但 Node 的 `fs.readFileSync` 能透明地
 * 读 asar,所以不需要 `asarUnpack`。这条路径在 dev 和 prod 都成立,不需要
 * 根据 `app.isPackaged` 分支。
 *
 * `baseDir` 单独作为参数导出,方便测试时传入可控的根目录(避开对运行时
 * `__dirname` 的依赖)。生产里调用 `createAppIcon` 时走默认值即可。
 */
export function resolveAppIconPath(source: string, baseDir: string = __dirname): string {
  if (source.startsWith('data:')) return source
  // Vite ?url import 在 dev 模式下会返回带前导斜杠的路径(例如 '/chunks/...')。
  // 在 Windows 上 path.isAbsolute('/foo') === true(Node 把 /foo 解释成"当前盘根下的 foo"),
  // 但实际文件并不在 d:\chunks\...,而是在 main bundle 输出目录里。必须先把
  // 前导斜杠剥掉,再判断 absoluteness。Windows 风格的真绝对路径(带盘符或 UNC)
  // 不以斜杠开头,原样透传。
  const normalized = source.replace(/^\/+/, '')
  if (isAbsolute(normalized) || win32.isAbsolute(normalized)) return normalized

  const useWin32 = usesWin32PathRules(baseDir)
  const resolvedBaseDir = useWin32 ? win32.resolve(baseDir) : resolve(baseDir)
  const resolved = useWin32 ? win32.resolve(resolvedBaseDir, normalized) : resolve(resolvedBaseDir, normalized)
  if (!isInsideDirectory(resolved, resolvedBaseDir, useWin32)) {
    throw new Error('App icon path escapes the bundle directory.')
  }
  return resolved
}

/**
 * 加载应用图标。优先用 `readFileSync` 读出 buffer,再交给
 * `nativeImage.createFromBuffer()`。
 *
 * 旧实现用的是 `nativeImage.createFromPath(source)` —— 这条路径走的是
 * Chromium 的 native image loader,既读不了 Vite dev server 返回的 URL,
 * 也读不了 `app.asar` 内的文件(虽然 Node 的 `fs` 能读)。结果是 `appIcon`
 * 永远为空,Windows 上 `Tray` 注册出来的 NotifyIconData.hIcon 是 NULL,系统
 * 既不绘制图标,也不会把它列在 overflow 区域(但消息泵是注册的,左键/
 * 右键点击仍然有效)。修复后用 buffer 走 Electron 自己的 API,绕开 native
 * image loader 的 asar 限制。
 */
export function createAppIcon(source: string): Electron.NativeImage {
  if (source.startsWith('data:')) {
    return nativeImage.createFromDataURL(source)
  }

  let absolute = ''
  try {
    absolute = resolveAppIconPath(source)
    return nativeImage.createFromBuffer(readFileSync(absolute))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(
      '[kun-gui] failed to load app icon from',
      absolute || source,
      '-',
      message
    )
    return nativeImage.createEmpty()
  }
}

/**
 * 给 Tray 选图。优先用专为托盘优化的 primary 图(通常是更小、更简化的
 * 剪影,在 16x16 / 24x24 任务栏尺寸下也清晰);primary 加载失败时回退到
 * 主应用图标,这样即使托盘专用图丢了也不至于看到 electron 默认占位。
 *
 * 单独抽出来是因为:
 *   - 行为是"两输入一输出"的纯函数,可以在测试里直接喂假 NativeImage
 *     验证,不用真的把 Tray 拉起来
 *   - 名字 `pickTrayIcon` 比 `trayIcon.isEmpty() ? appIcon : trayIcon` 这种
 *     内联三元更能表达"我优先用托盘专用图"的意图
 */
export function pickTrayIcon(
  primary: Electron.NativeImage,
  fallback: Electron.NativeImage
): Electron.NativeImage {
  return primary.isEmpty() ? fallback : primary
}

export function trayIconSize(platform: NodeJS.Platform = process.platform): number {
  return platform === 'darwin' ? 22 : 16
}

export function prepareTrayIcon(
  image: Electron.NativeImage,
  platform: NodeJS.Platform = process.platform
): Electron.NativeImage {
  if (image.isEmpty()) return image

  const size = trayIconSize(platform)
  const resized = image.resize({
    width: size,
    height: size,
    quality: 'best'
  })
  const result = resized.isEmpty() ? image : resized

  if (platform === 'darwin') {
    result.setTemplateImage(false)
  }

  return result
}
