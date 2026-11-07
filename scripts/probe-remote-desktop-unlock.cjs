// Manual feasibility probe for remote auto-unlock. Usage: node scripts/probe-remote-desktop-unlock.cjs [preflight|capture|run]
const { execFileSync, spawn } = require('node:child_process')
const { existsSync, mkdirSync, readFileSync } = require('node:fs')
const { resolve, join } = require('node:path')

const root = resolve(__dirname, '..')
const cache = resolve(root, '.cache/remote-desktop-unlock-probe')
const command = process.argv[2] ?? 'preflight'
if (process.platform !== 'darwin' || !['preflight', 'capture', 'run'].includes(command)) {
  console.error('usage (macOS only): node scripts/probe-remote-desktop-unlock.cjs [preflight|capture|run]')
  process.exit(2)
}

function buildProbe() {
  mkdirSync(cache, { recursive: true, mode: 0o700 })
  const binary = join(cache, 'macos-unlock-probe')
  execFileSync('xcrun', ['swiftc', '-module-cache-path', join(cache, 'module-cache'), '-O', resolve(root, 'native/remote-desktop/macos-unlock-probe.swift'), '-o', binary], { stdio: 'inherit' })
  return binary
}

function startCapture(directory) {
  const electron = require(resolve(root, 'node_modules/electron'))
  // Snapshots are only allowed while locked, so this must be the system's flag rather than a guess.
  const lockedAtStart = /"IOConsoleLocked" = Yes/.test(execFileSync('ioreg', ['-n', 'Root', '-d1'], { encoding: 'utf8' }))
  const child = spawn(electron, [resolve(__dirname, 'probe-remote-desktop-unlock-capture.cjs'), directory], {
    stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, KUN_UNLOCK_PROBE_LOCKED_AT_START: lockedAtStart ? '1' : '0' } })
  const ready = new Promise(done => {
    const timer = setTimeout(() => done('capture-timeout'), 15000)
    child.stdout.on('data', chunk => { clearTimeout(timer); done(String(chunk).trim()) })
    child.on('exit', () => { clearTimeout(timer); done('capture-exited') })
  })
  return { child, ready }
}

const secureInputAllowed = sample => sample.secureInputHolder === 'loginwindow'
function summarize(directory) {
  const report = JSON.parse(readFileSync(join(directory, 'report.json'), 'utf8'))
  const capturePath = join(directory, 'capture.jsonl')
  const capture = existsSync(capturePath) ? readFileSync(capturePath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  const find = kind => report.events.find(event => event.kind === kind)
  const samples = report.events.filter(event => event.kind === 'sample')
  const locked = samples.filter(sample => sample.phase.startsWith('locked-'))
  const lockedCapture = capture.filter(event => event.kind === 'capture' && event.locked)
  const framesDuringLock = lockedCapture.length > 1 ? lockedCapture.at(-1).frames - lockedCapture[0].frames : 0
  const readable = key => locked.length > 0 && locked.every(sample => sample.keychainRead[key] === 0)
  const lockStatusWorks = locked.length > 0 && locked.every(sample => sample.lockedFlag === true && sample.onConsole === true && secureInputAllowed(sample))
  const unlock = find('unlock'), typing = find('typing'), guard = find('guardAfterAttempt')
  console.log(`
报告目录：${directory}
macOS：${report.environment.os}

1. 键盘注入解锁：${unlock?.unlockedAfterSubmitSeconds != null ? `通过，提交后 ${unlock.unlockedAfterSubmitSeconds}s 解锁` : `未通过（${typing?.refused ?? '提交后未解锁'}）`}
2. 锁屏时采集：${capture.some(event => event.kind === 'capture-failed') ? '采集未启动' : lockedCapture.length === 0 ? '没有锁屏期间的采集样本' : `锁屏期间 ${framesDuringLock} 帧，轨道 ${lockedCapture.at(-1).trackState}，静音事件 ${lockedCapture.at(-1).muteEvents} 次；画面要看截图判断`}
3. 锁屏时读钥匙串：文件型 ${readable('fileBased') ? '可读' : '不可读'}；数据保护型 ${readable('dataProtection') ? '可读' : `不可读（${locked[0]?.keychainRead.dataProtection}）`}
4. 锁屏状态判断：${lockStatusWorks ? '全程一致' : '有不一致，见 report.json'}；安全输入持有者 ${[...new Set(locked.map(sample => sample.secureInputHolder))].join(', ') || '无样本'}
   Electron 事件：${capture.filter(event => event.kind.startsWith('electron-')).map(event => event.kind).join(', ') || '无'}
   重新锁屏快捷键：${find('lockShortcut')?.lockedAfterSeconds != null ? `通过，${find('lockShortcut').lockedAfterSeconds}s` : '未通过'}
   解锁后防护：${guard?.decision === 'NOT_LOCKED' ? '正确拒绝输入' : `判定为 ${guard?.decision}`}
`)
}

async function main() {
  const binary = buildProbe()
  if (command === 'preflight') { execFileSync(binary, ['preflight'], { stdio: 'inherit' }); return }
  const directory = join(cache, new Date().toISOString().replace(/[:.]/g, '-'))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const { child, ready } = startCapture(directory)
  const status = await ready
  console.log(`采集探针：${status}`)
  if (command === 'capture') {
    await new Promise(done => setTimeout(done, 14000))
    child.kill()
    console.log(`报告目录：${directory}\n${readFileSync(join(directory, 'capture.jsonl'), 'utf8')}`)
    return
  }
  try {
    execFileSync(binary, ['run', join(directory, 'report.json')], { stdio: 'inherit' })
  } catch (error) {
    if (!existsSync(join(directory, 'report.json'))) { child.kill(); process.exit(error.status ?? 1) }
  }
  child.kill()
  summarize(directory)
}

main().catch(error => { console.error(error); process.exit(1) })
