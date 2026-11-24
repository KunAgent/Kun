import assert from 'node:assert/strict'
import { app, type BrowserWindow } from 'electron'

export async function exerciseViewerSession(window: BrowserWindow, fullscreen: boolean, interrupt?: () => Promise<void>) {
  const js = (source: string) => window.webContents.executeJavaScript(source)
  const click = async (id: string) => {
    window.show()
    if (process.platform === 'darwin') app.focus({ steal: true })
    window.focus()
    const point = await js(`(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
  }
  const wait = async (condition: string, step = condition) => {
    const deadline = Date.now() + 15000
    while (!await js(condition)) {
      if (Date.now() >= deadline) {
        const state = { fullscreen: window.isFullScreen(), visible: window.isVisible(), focused: window.isFocused(), bounds: window.getBounds(),
          label: await js("document.querySelector('#mode').textContent"), detail: await js("document.querySelector('#overlay-detail').textContent") }
        throw Error(step + ' timed out: ' + JSON.stringify(state))
      }
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  }
  await wait("!document.querySelector('#retry').hidden")
  assert.match(await js("document.querySelector('#overlay-detail').textContent"), /连接/)
  await js("document.querySelector('#retry').click()")
  await wait("!document.querySelector('#control').disabled && document.querySelector('#video').videoWidth > 0")
  await js("window.fixtureStream = document.querySelector('#video').srcObject")
  if (interrupt) {
    await interrupt()
    await wait("!document.querySelector('#relay-retry').hidden")
    await js("document.querySelector('#relay-retry').click()")
    await wait("document.querySelector('#mode').textContent === '仅查看' && document.querySelector('#stream-stats').textContent.includes('TURN 中继')")
    assert.equal(await js("document.querySelector('#video').srcObject !== window.fixtureStream && document.querySelector('#video').videoWidth > 0"), true)
    await js("window.fixtureStream = document.querySelector('#video').srcObject")
    await wait("!document.querySelector('#control').disabled")
  }
  if (!fullscreen) return
  await click('control')
  await wait("document.querySelector('#control').getAttribute('aria-pressed') === 'true'")
  await click('control')
  await wait("document.querySelector('#control').getAttribute('aria-pressed') === 'false'")
  await click('fullscreen')
  await wait("document.body.classList.contains('fullscreen') && !document.querySelector('#fullscreen').disabled", 'toolbar fullscreen')
  assert.equal(window.isFullScreen(), true)
  const fillsWindow = await js("(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return r.x===0 && r.y===0 && r.width===innerWidth && r.height===innerHeight})()")
  assert.equal(fillsWindow, true)
  await wait("document.querySelector('#tools').inert && !document.querySelector('#reveal').hidden")
  await js("document.querySelector('#reveal').click();document.querySelector('#settings-toggle').click()")
  await wait("!document.querySelector('#settings-panel').hidden")
  await js("const scale=document.querySelector('#scale');scale.value='actual';scale.dispatchEvent(new Event('change'))")
  assert.equal(await js("Math.abs(document.querySelector('#video').clientWidth * devicePixelRatio - document.querySelector('#video').videoWidth) <= devicePixelRatio"), true)
  await js("scale.value='fit';scale.dispatchEvent(new Event('change'));document.querySelector('#collapse').click()")
  window.setFullScreen(false) // Simulate exit via the OS window controls.
  await wait("!document.body.classList.contains('fullscreen') && !document.querySelector('#tools').inert")
  assert.equal(await js("document.querySelector('#fullscreen').getAttribute('aria-pressed')"), 'false')
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{code:'F11',bubbles:true}))")
  await wait("document.body.classList.contains('fullscreen') && !document.querySelector('#fullscreen').disabled", 'F11 after native exit')
  await js("document.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape',bubbles:true}))")
  await wait("!document.body.classList.contains('fullscreen') && !document.querySelector('#fullscreen').disabled")
  assert.equal(window.isFullScreen(), false)
  assert.equal(await js("document.querySelector('#video').srcObject === window.fixtureStream && document.querySelector('#mode').textContent === '仅查看'"), true)
}
