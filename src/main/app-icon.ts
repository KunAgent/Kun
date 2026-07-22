import { readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeImage } from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * @brief ICO 文件目录条目结构。
 */
interface IcoDirEntry {
  width: number       ///< 图像宽度（0 表示 256）
  height: number      ///< 图像高度（0 表示 256）
  bpp: number         ///< 每像素位数（32 = PNG）
  dataSize: number    ///< 图像数据大小（字节）
  dataOffset: number  ///< 图像数据在文件中的偏移
}

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
 * @brief 解析 ICO 文件目录，返回所有尺寸条目。
 *
 * ICO 文件格式：
 *   字节 0-1: reserved（0）
 *   字节 2-3: type（1 = ICO）
 *   字节 4-5: image count
 *   字节 6+:  16 字节 × count 的目录条目
 *   之后：   count 段图像数据
 *
 * 当 bpp=32 时，每段图像数据是完整的 PNG 文件。
 *
 * @param buffer  ICO 文件完整内容
 * @returns 按尺寸降序排列的目录条目数组
 */
export function parseIco(buffer: Buffer): IcoDirEntry[] {
  if (buffer.length < 6) return []

  const count = buffer.readUInt16LE(4)
  const entries: IcoDirEntry[] = []

  for (let i = 0; i < count; i++) {
    const offset = 6 + i * 16
    if (offset + 16 > buffer.length) break

    const w = buffer[offset]        // width (0 = 256)
    const h = buffer[offset + 1]    // height (0 = 256)
    const bpp = buffer.readUInt16LE(offset + 6)
    const dataSize = buffer.readUInt32LE(offset + 8)
    const dataOffset = buffer.readUInt32LE(offset + 12)

    entries.push({
      width: w === 0 ? 256 : w,
      height: h === 0 ? 256 : h,
      bpp,
      dataSize,
      dataOffset
    })
  }

  // 按尺寸降序排列（最大图排最前）
  entries.sort((a, b) => (b.width * b.height) - (a.width * a.height))
  return entries
}

/**
 * @brief 从 ICO buffer 中提取指定尺寸（或最大尺寸）的 PNG 数据。
 *
 * @param buffer    ICO 文件完整内容
 * @param maxSize   可选的目标最大尺寸过滤器
 * @returns 找到的 PNG buffer，无匹配时返回 null
 */
export function extractPngFromIco(buffer: Buffer, maxSize?: number): Buffer | null {
  const entries = parseIco(buffer)
  if (entries.length === 0) return null

  // 按尺寸降序已排列，查找第一个不超过 maxSize 的条目
  let target: IcoDirEntry | null = null
  if (maxSize) {
    // 找最接近但不大于 maxSize 的
    for (const entry of entries) {
      if (entry.width <= maxSize && entry.bpp >= 32) {
        target = entry
        break
      }
    }
  }

  // 回退到最大尺寸
  if (!target) {
    for (const entry of entries) {
      if (entry.bpp >= 32) {
        target = entry
        break
      }
    }
  }

  if (!target) return null

  // 提取图像数据
  const rawData = buffer.subarray(target.dataOffset, target.dataOffset + target.dataSize)
  if (rawData.length < 8) return null

  // 检查是否为 PNG 格式
  const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  if (rawData.subarray(0, 8).equals(pngMagic)) {
    return rawData  // 直接返回 PNG 数据
  }

  // 非 PNG 格式时检查是否为 BMP（BITMAPINFOHEADER 以 0x28000000 开头）
  const bmpMagic = Buffer.from([0x28, 0x00, 0x00, 0x00])
  if (rawData.subarray(0, 4).equals(bmpMagic)) {
    // BMP 在 ICO 中的存储格式与标准 BMP 不同：
    // - 没有 BITMAPFILEHEADER（14 字节的 'BM' 头）
    // - 直接从 BITMAPINFOHEADER 开始
    // - 颜色数据是 BGRA 格式（已包含 alpha 通道）
    // 需要补全 BMP 文件头，使其成为可读的 BMP buffer
    const bmpFileHeader = Buffer.alloc(14)
    bmpFileHeader.write('BM', 0, 'ascii')                          // 'BM' magic
    bmpFileHeader.writeUInt32LE(14 + rawData.length, 2)            // file size
    bmpFileHeader.writeUInt32LE(14 + target.width * 4, 10)         // pixel data offset
    return Buffer.concat([bmpFileHeader, rawData])
  }

  return null
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
 * @brief 从 ICO 文件中提取特定尺寸的 PNG 数据并创建 NativeImage。
 *
 * 用于需要精确控制图标尺寸的场景（如 64px macOS 菜单栏图标）。
 *
 * @param source  `?url` import 返回的资源路径
 * @param size    目标尺寸（像素），提取不超过此尺寸的最大条目
 * @returns Electron NativeImage 实例
 */
export function createAppIconFromIco(source: string, size: number): Electron.NativeImage {
  try {
    const absolute = resolveAppIconPath(source)
    const ext = extname(absolute).toLowerCase()
    if (ext !== '.ico') {
      return createAppIcon(source)
    }

    const fileBuffer = readFileSync(absolute)
    const pngBuffer = extractPngFromIco(fileBuffer, size)
    if (pngBuffer) return nativeImage.createFromBuffer(pngBuffer)

    return createAppIcon(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[kun-gui] failed to load ICO icon:', message)
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

/**
 * @brief 根据系统 DPI 缩放比例，为指定场景选择最佳的 ICO 条目尺寸。
 *
 * Microsoft 建议：提供足够大的图标确保 Windows 只需向下缩放。
 * 此函数根据逻辑基准尺寸和实际缩放倍率，从 ICO 中选 >= 物理像素
 * 的最小可用尺寸，避免向上缩放。
 *
 * ICO 可用尺寸: 16,20,24,30,32,36,40,48,60,64,72,80,96,128,256
 *
 * @param baseSize    逻辑基准尺寸（如托盘 16px、标题栏 18px）
 * @param scaleFactor 系统 DPI 缩放倍率（1.0=100%, 1.5=150%, 2.0=200%）
 * @returns 应使用的 ICO 条目尺寸
 */
export function selectIcoSizeForScale(baseSize: number, scaleFactor: number): number {
  const physicalSize = Math.ceil(baseSize * scaleFactor)
  const availableSizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
  for (const size of availableSizes) {
    if (size >= physicalSize) return size
  }
  return 256
}

export function trayIconSize(platform: NodeJS.Platform = process.platform): number {
  return platform === 'darwin' ? 22 : 16
}

/**
 * @brief 将图标缩放到 DPI 感知的物理尺寸，用于系统托盘。
 *
 * 逻辑尺寸由 `trayIconSize()` 决定（Win=16, macOS=22），
 * 实际写入 Tray 的物理尺寸为 `logicalSize × scaleFactor`。
 * 例如 200% 缩放下 16×1.5=24px，确保高 DPI 不模糊。
 *
 * @param image      源图标
 * @param platform   运行平台
 * @param scaleFactor 系统 DPI 缩放倍率（默认 1.0=100%）
 * @returns 调整后的托盘图标
 */
export function prepareTrayIcon(
  image: Electron.NativeImage,
  platform: NodeJS.Platform = process.platform,
  scaleFactor: number = 1
): Electron.NativeImage {
  if (image.isEmpty()) return image

  const logicalSize = trayIconSize(platform)
  const physicalSize = Math.round(logicalSize * scaleFactor)
  const resized = image.resize({
    width: physicalSize,
    height: physicalSize,
    quality: 'best'
  })
  const result = resized.isEmpty() ? image : resized

  if (platform === 'darwin') {
    result.setTemplateImage(false)
  }

  return result
}
