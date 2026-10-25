'use strict'

const {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  writeFileSync
} = require('node:fs')
const { join } = require('node:path')

const LINUX_SANDBOX_LAUNCHER_FLAG = '--disable-setuid-sandbox'
const LINUX_REAL_EXECUTABLE_SUFFIX = '.electron-bin'
const MINIMUM_TUI_NODE_VERSION = '22.19.0'

function normalizePlatform(platform) {
  return platform === 'win' ? 'win32' : platform
}

function appBundlePath(context) {
  return join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
}

function packedResourcesDir(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(appBundlePath(context), 'Contents', 'Resources')
  }
  return join(context.appOutDir, 'resources')
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[after-pack] Unsupported packaged resource arch: ${arch}`)
}

function linuxRealExecutableName(executableName) {
  return `${executableName}${LINUX_REAL_EXECUTABLE_SUFFIX}`
}

function linuxElectronLauncherContent(executableName) {
  if (typeof executableName !== 'string' || !/^[0-9A-Za-z._-]+$/u.test(executableName)) {
    throw new Error(`[after-pack] Unsafe Linux executable name: ${String(executableName)}`)
  }
  const realExecutableName = linuxRealExecutableName(executableName)
  return `#!/bin/sh
set -eu

case "$0" in
  /*) launcher_path=$0 ;;
  *)
    # AppImage may invoke AppRun through PATH, which leaves the product
    # launcher's argv[0] as a bare filename. Its APPDIR is the only stable
    # location for the renamed Electron payload in that case.
    if [ -n "\${APPDIR:-}" ] && [ -x "\${APPDIR}/${executableName}" ]; then
      launcher_path="\${APPDIR}/${executableName}"
    else
      launcher_path=$PWD/$0
    fi
    ;;
esac
# deb exposes /usr/bin/${executableName} as an update-alternatives symlink chain to
# /opt/<product>/${executableName}; the payload sits beside the real launcher.
link_hops=0
while [ -L "$launcher_path" ]; do
  link_hops=$((link_hops + 1))
  if [ "$link_hops" -gt 40 ]; then
    echo "${executableName}: too many symbolic links while resolving launcher" >&2
    exit 1
  fi
  link_target=$(readlink "$launcher_path")
  case "$link_target" in
    /*) launcher_path=$link_target ;;
    *) launcher_path=\${launcher_path%/*}/$link_target ;;
  esac
done
launcher_dir=\${launcher_path%/*}
launcher_dir=$(CDPATH= cd -P "$launcher_dir" && pwd -P)
real_executable="$launcher_dir/${realExecutableName}"

if [ "\${KUN_CLI_ENTRY:-}" = "1" ]; then
  cli_entry="$launcher_dir/resources/app.asar.unpacked/kun/dist/cli/serve-entry.js"
  ELECTRON_RUN_AS_NODE=1 exec "$real_executable" "$cli_entry" "$@"
fi

if [ "\${ELECTRON_RUN_AS_NODE:-}" = "1" ]; then
  exec "$real_executable" "$@"
fi

exec "$real_executable" ${LINUX_SANDBOX_LAUNCHER_FLAG} "$@"
`
}

function windowsCliLauncherContent(productFilename, development = false) {
  const entry = 'app.asar.unpacked\\kun\\dist\\cli\\serve-entry.js'
  return `@echo off\r
setlocal\r
${development ? 'set "KUN_APP_FLAVOR=development"\r\nset "KUN_RUNTIME_FLAVOR=development"\r\n' : ''}
set "KUN_CLI_ENTRY=%~dp0..\\resources\\${entry}"\r
set "KUN_FIRST_ARG=%~1"\r
if "%KUN_FIRST_ARG%"=="" goto :tui\r
if /I "%KUN_FIRST_ARG%"=="tui" goto :tui\r
if "%KUN_FIRST_ARG%"=="--help" goto :electron\r
if "%KUN_FIRST_ARG%"=="-h" goto :electron\r
if "%KUN_FIRST_ARG%"=="--version" goto :electron\r
if "%KUN_FIRST_ARG%"=="-V" goto :electron\r
if "%KUN_FIRST_ARG:~0,1%"=="-" goto :tui\r
goto :electron\r
\r
:tui\r
where.exe node >nul 2>nul\r
if errorlevel 1 (\r
  >&2 echo kun tui: Node.js ^>=${MINIMUM_TUI_NODE_VERSION} is required, but node was not found on PATH.\r
  >&2 echo Install Node.js, then open a new terminal. Download: https://nodejs.org/\r
  >&2 echo Windows: winget install --id OpenJS.NodeJS.22 --exact\r
  exit /b 69\r
)\r
for /f "delims=" %%N in ('where.exe node 2^>nul') do if not defined KUN_NODE set "KUN_NODE=%%N"\r
set "KUN_PACKAGED_RUNTIME_EXECUTABLE=%~dp0..\\${productFilename}.exe"\r
if /I "%KUN_NODE:~-4%"==".cmd" goto :tui-node-shim\r
if /I "%KUN_NODE:~-4%"==".bat" goto :tui-node-shim\r
"%KUN_NODE%" "%KUN_CLI_ENTRY%" %*\r
exit /b %errorlevel%\r
\r
:tui-node-shim\r
call "%KUN_NODE%" "%KUN_CLI_ENTRY%" %*\r
exit /b %errorlevel%\r
\r
:electron\r
set "ELECTRON_RUN_AS_NODE=1"\r
"%~dp0..\\${productFilename}.exe" "%KUN_CLI_ENTRY%" %*\r
exit /b %errorlevel%\r
`
}

function installCliLaunchers(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const entryRelative = 'app.asar.unpacked/kun/dist/cli/serve-entry.js'
  const development = context.packager.appInfo.productFilename === 'kun-dv' ||
    context.packager.config?.extraMetadata?.kunAppFlavor === 'development'
  const launcherName = development ? 'kun-dv' : 'kun'
  const flavorShellEnv = development
    ? 'KUN_APP_FLAVOR=development KUN_RUNTIME_FLAVOR=development '
    : ''
  if (platform === 'darwin') {
    const resources = packedResourcesDir(context)
    const binDir = join(resources, 'bin')
    const launcher = join(binDir, launcherName)
    mkdirSync(binDir, { recursive: true, mode: 0o755 })
    writeFileSync(launcher, `#!/bin/sh
set -eu
case "$0" in
  /*) launcher_path=$0 ;;
  */*) launcher_path=$PWD/$0 ;;
  *) launcher_path=$(command -v "$0") ;;
esac
link_hops=0
while [ -L "$launcher_path" ]; do
  link_hops=$((link_hops + 1))
  if [ "$link_hops" -gt 40 ]; then
    echo "${launcherName}: too many symbolic links while resolving launcher" >&2
    exit 1
  fi
  launcher_dir=$(CDPATH= cd -P "$(dirname "$launcher_path")" && pwd -P)
  link_target=$(readlink "$launcher_path")
  case "$link_target" in
    /*) launcher_path=$link_target ;;
    *) launcher_path=$launcher_dir/$link_target ;;
  esac
done
self_dir=$(CDPATH= cd -P "$(dirname "$launcher_path")" && pwd -P)
resources_dir=$(CDPATH= cd -P "$self_dir/.." && pwd -P)
app_exec="$resources_dir/../MacOS/${context.packager.appInfo.productFilename}"
cli_entry="$resources_dir/${entryRelative}"
${flavorShellEnv}ELECTRON_RUN_AS_NODE=1 exec "$app_exec" "$cli_entry" "$@"
`, { encoding: 'utf8', mode: 0o755 })
    chmodSync(launcher, 0o755)
    return
  }
  if (platform === 'win32') {
    const binDir = join(context.appOutDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      join(binDir, `${launcherName}.cmd`),
      windowsCliLauncherContent(context.packager.appInfo.productFilename, development),
      'utf8'
    )
  }
}

function assertElfExecutable(path) {
  const header = Buffer.alloc(4)
  const descriptor = openSync(path, 'r')
  let bytesRead
  try {
    bytesRead = readSync(descriptor, header, 0, header.length, 0)
  } finally {
    closeSync(descriptor)
  }
  if (bytesRead !== 4 || !header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    throw new Error(`[after-pack] Linux Electron executable is not an ELF payload: ${path}`)
  }
}

function installLinuxElectronLauncher(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'linux') return
  if (context.packager?.config?.electronFuses != null) {
    throw new Error(
      '[after-pack] electronFuses cannot be applied after installing the Linux shell launcher'
    )
  }
  const executableName = context.packager?.executableName
  const launcherContent = linuxElectronLauncherContent(executableName)
  const executable = join(context.appOutDir, executableName)
  const realExecutable = join(context.appOutDir, linuxRealExecutableName(executableName))
  const details = lstatSync(executable)
  if (details.isSymbolicLink() || !details.isFile() || (details.mode & 0o111) === 0) {
    throw new Error(`[after-pack] Linux Electron executable must be a non-symlink executable file: ${executable}`)
  }
  assertElfExecutable(executable)
  if (existsSync(realExecutable)) {
    throw new Error(`[after-pack] Refusing to overwrite Linux Electron payload: ${realExecutable}`)
  }

  renameSync(executable, realExecutable)
  chmodSync(realExecutable, 0o755)
  // The running Electron process reports the renamed payload as process.execPath.
  // AppImage and deb both enter through this launcher today; any future
  // app.relaunch()/rpm/other Linux target must re-enter it or explicitly
  // preserve LINUX_SANDBOX_LAUNCHER_FLAG.
  writeFileSync(executable, launcherContent, { encoding: 'utf8', flag: 'wx', mode: 0o755 })
  chmodSync(executable, 0o755)
}


module.exports = {
  normalizeArch,
  normalizePlatform,
  LINUX_SANDBOX_LAUNCHER_FLAG,
  assertElfExecutable,
  installCliLaunchers,
  installLinuxElectronLauncher,
  linuxElectronLauncherContent,
  linuxRealExecutableName,
  windowsCliLauncherContent
}
