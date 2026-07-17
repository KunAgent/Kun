import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const port = Number(process.env.KUN_CDP_PORT || 9237)
const createMeeting = process.env.KUN_ACCEPTANCE_CREATE_MEETING === '1'
const exerciseLocalServer = process.env.KUN_ACCEPTANCE_LOCAL_SERVER === '1'
const targets = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
const target = targets.find((item) => item.type === 'page' && item.title === 'Kun')
if (!target?.webSocketDebuggerUrl) throw new Error('Kun renderer CDP target was not found')

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
const runtimeErrors = []
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id) {
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
    return
  }
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params)
})

function call(method, params = {}) {
  const id = ++nextId
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Renderer evaluation failed')
  }
  return result.result.value
}

async function waitFor(expression, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for: ${expression}`)
}

await call('Runtime.enable')
await call('Page.enable')
await call('Page.bringToFront')
await waitFor(`document.readyState === 'complete' && document.body.innerText.length > 0`)
await evaluate(`(() => {
  const tabs = [...document.querySelectorAll('[role="tablist"] button[role="tab"]')]
  const button = tabs.at(-1)
  if (!button) throw new Error('Collaboration tab was not found')
  button.click()
  return true
})()`)
await waitFor(`document.body.innerText.includes('联网协作') && document.body.innerText.includes('接待数字员工')`)

if (createMeeting) {
  await evaluate(`(() => {
    const input = document.querySelector('input[placeholder="会议名称"]')
    if (!input) throw new Error('Meeting name input was not found')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '验收会议')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const button = document.querySelector('button[aria-label="创建会议"]')
    if (!button) throw new Error('Create meeting button was not found')
    button.click()
    return true
  })()`)
  await waitFor(`document.body.innerText.includes('验收会议')`)
}

await evaluate(`(() => {
  if (!document.querySelector('input[placeholder="操作员注册令牌"]')) {
    document.querySelector('button[aria-label="配置服务器"]')?.click()
  }
  return true
})()`)
await waitFor(`Boolean(document.querySelector('input[placeholder="操作员注册令牌"]'))`)

if (exerciseLocalServer) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('启动内置服务'))
    if (!button) throw new Error('Built-in server start button was not found')
    button.click()
    return true
  })()`)
  await waitFor(`(() => {
    const url = document.querySelector('input[placeholder="https://server:19443"]')?.value
    const token = document.querySelector('input[placeholder="操作员注册令牌"]')?.value
    const stopped = [...document.querySelectorAll('button')].some((item) => item.textContent.includes('停止内置服务'))
    return url === 'https://127.0.0.1:19443' && Boolean(token) && stopped
  })()`, 20_000)
}

const layout = await evaluate(`(() => {
  const stage = document.querySelector('[data-collaboration-stage="true"]')
  const rect = stage?.getBoundingClientRect()
  return {
    title: document.title,
    bodyText: document.body.innerText,
    viewport: { width: innerWidth, height: innerHeight },
    bodyOverflowX: document.documentElement.scrollWidth > innerWidth,
    stage: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null,
    stageOverflowX: stage ? stage.scrollWidth > stage.clientWidth : null
  }
})()`)

if (layout.bodyOverflowX || layout.stageOverflowX) throw new Error(`Collaboration layout overflows horizontally: ${JSON.stringify(layout)}`)
if (!layout.bodyText.includes('TLS 1.3 + SPKI') || !layout.bodyText.includes('OpenMLS RFC 9420')) {
  throw new Error('Collaboration security state is not visible')
}
if (runtimeErrors.length > 0) throw new Error(`Renderer exceptions: ${JSON.stringify(runtimeErrors)}`)

const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
const screenshotPath = join(tmpdir(), 'kun-collaboration-acceptance.png')
await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
if (exerciseLocalServer) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('停止内置服务'))
    if (!button) throw new Error('Built-in server stop button was not found')
    button.click()
    return true
  })()`)
  await waitFor(`[...document.querySelectorAll('button')].some((item) => item.textContent.includes('启动内置服务'))`)
}
socket.close()
process.stdout.write(`${JSON.stringify({ ok: true, screenshotPath, layout }, null, 2)}\n`)
