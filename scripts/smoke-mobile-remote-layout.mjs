import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Run the real mobile Rooms screen, rich editor and permission picker. Only the
// host bridge is faked; no running Kun instance or user conversation is touched.
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-mobile-layout-'))
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import '/src/styles/base-shell.css';
import '/src/styles/markdown-code.css';
import '/src/mobile/mobile-app-shell.css';
const now = '2026-09-22T00:00:00.000Z';
const room = { id:'mobile-test', schemaVersion:1, name:'小 Kun', conversationKind:'user_agent',
  collaborationMode:'directed', defaultMemberId:'kun', members:[{ id:'kun', displayName:'小 Kun',
  role:'developer', enabled:true, presetId:'kun', roleNotes:'', allowedRepositoryIds:[], revision:1 }],
  repositories:[], revision:1, createdAt:now, updatedAt:now };
const body = ['### 手机布局测试', '这是一段用于验证手机长消息、底部输入区和浏览器缩放的内容。'.repeat(12),
  '\\n~~~text\\n' + '/workspace/long-path/'.repeat(20) + '\\n~~~',
  '\\n| 文件 | 内容 |\\n| --- | --- |\\n| 测试 | ' + 'long-value-'.repeat(30) + ' |'].join('\\n\\n');
const messages = Array.from({length:4}, (_,i) => ({ id:'message-'+i, roomId:room.id, messageSeq:i+1,
  authorKind:'member', authorMemberId:'kun', authorLabelSnapshot:'小 Kun', body, bodyRevision:1,
  mentionMemberIds:[], attachmentIds:[], createdAt:now, status:'final' }));
window.mobileInputRequests = [];
window.mobileInputSubmissions = [];
window.failNextAnswer = false;
window.kunGui = { isRemoteWeb:true, platform:'web', runtimeRequest:async (path, method, payload) => {
  let data = {};
  if (path === '/v1/rooms/mobile-test/direct') data = { userInputs:window.mobileInputRequests, approvals:[], requests:[], pendingCount:0 };
  else if (path.startsWith('/v1/user-inputs/')) {
    if (window.failNextAnswer) { window.failNextAnswer = false; return {ok:false,status:503,body:JSON.stringify({error:'Offline - retry'})}; }
    window.mobileInputSubmissions.push(JSON.parse(payload));
    window.mobileInputRequests = [];
  }
  else if (path === '/v1/rooms/mobile-test') data = { room };
  else if (path.includes('/direct/permissions')) data = { revision:1,
    policy:{ approvalPolicy:'never', sandboxMode:'danger-full-access', approvalReviewer:'user' } };
  else if (path.endsWith('/interactions')) data = { reactions:{revision:1,reactions:[]} };
  else if (path.includes('/messages')) data = { messages };
  else if (path.includes('/tasks')) data = { tasks:[] };
  else if (path.includes('/rules')) data = { rules:[] };
  else if (path.includes('/presets')) data = { presets:[] };
  else if (path.includes('/read')) data = { seq:4 };
  return {ok:true,status:200,body:JSON.stringify(data)};
}};
// Safari changes visualViewport without resizing the layout viewport on keyboard open.
const viewport = Object.assign(new EventTarget(), { height:innerHeight, width:innerWidth, offsetTop:0, scale:1 });
Object.defineProperty(window, 'visualViewport', { configurable:true, value:viewport });
window.resizeVisualViewport = (height, top=0) => {
  Object.assign(viewport, { height, width:innerWidth, offsetTop:top });
  viewport.dispatchEvent(new Event('resize'));
  viewport.dispatchEvent(new Event('scroll'));
};
const [{MobileRoomConversation}, {useRemoteSurface}, {useMobileViewport}, {default:i18n}] = await Promise.all([
  import('/src/mobile/rooms/MobileRoomConversation.tsx'), import('/src/mobile/use-remote-surface.ts'),
  import('/src/mobile/use-mobile-viewport.ts'), import('/src/i18n.ts')]);
await i18n.changeLanguage('zh');
function Harness() {
  useRemoteSurface();
  useMobileViewport();
  return React.createElement('main', {className:'kun-mobile-app'},
    React.createElement('div', {className:'kun-mobile-app-content'},
      React.createElement(MobileRoomConversation, {roomId:room.id, onBack:()=>{}, onDetails:()=>{},
        onReply:()=>{}, onTask:()=>{}, onRun:()=>{}, onOpenTarget:()=>{}})));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
window.openNestedMenuFixture = async () => {
  const {RoomPopover} = await import('/src/components/rooms/RoomPopover.tsx');
  const dialog = document.createElement('dialog');
  document.body.append(dialog);
  dialog.showModal();
  const root = createRoot(dialog);
  root.render(React.createElement(RoomPopover, {label:'Outer menu', trigger:'Outer menu', children:() =>
    React.createElement(RoomPopover, {label:'Inner menu', trigger:'Inner menu', children:() =>
      React.createElement('button', null, 'Nested option')})}));
  return () => {root.unmount(); dialog.remove()};
};
`
let server
let browser
try {
  server = await createServer({
    configFile: false,
    root: resolve(repository, 'src/renderer'),
    cacheDir: join(temporary, 'vite'),
    resolve: { alias: { '@renderer': resolve(repository, 'src/renderer/src'), '@shared': resolve(repository, 'src/shared') } },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'mobile-layout-fixture',
      resolveId(id) { if (id === '/__mobile-layout-entry.js') return '\0mobile-layout-entry' },
      load(id) { if (id === '\0mobile-layout-entry') return entry },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === '/__mobile-layout') {
            response.setHeader('Content-Type', 'text/html')
            response.end(await vite.transformIndexHtml('/__mobile-layout', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/__mobile-layout-entry.js"></script></body></html>'))
          } else next()
        })
      }
    }]
  })
  await server.listen()
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH }
      : process.platform === 'darwin' ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}),
    headless: true
  })
  const page = await browser.newPage({ viewport: { width: 393, height: 670 }, screen: { width: 393, height: 852 },
    isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
  await page.goto(`${server.resolvedUrls.local[0]}__mobile-layout`)
  await page.locator('.rooms-rich-input').waitFor({ timeout: 90_000 })
  await page.locator('.room-permission-picker button').waitFor()
  await page.locator('.rooms-message-bubble').first().waitFor()

  const geometry = () => page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector).getBoundingClientRect()
    return { zoom: getComputedStyle(document.body).zoom,
      bottom: rect('.rooms-composer').bottom, top: rect('.kun-mobile-app').top,
      timelineHeight: rect('.rooms-timeline').height,
      overflow: document.documentElement.scrollWidth > innerWidth,
      inputFont: getComputedStyle(document.querySelector('.rooms-rich-input')).fontSize,
      sendSize: rect('.rooms-composer-send').height }
  })
  // Regression proof: the old inherited desktop zoom reproduces the screenshot's gap.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ds-ui-scale', '.85')
    document.documentElement.dataset.remoteSurface = 'desktop'
  })
  assert.ok(670 - (await geometry()).bottom > 90, 'baseline must reproduce bottom gap')
  await page.evaluate(() => { document.documentElement.dataset.remoteSurface = 'mobile' })

  for (const [width, height] of [[320,568], [375,667], [393,670], [430,760], [852,393]]) {
    await page.setViewportSize({ width, height })
    for (const scale of [0.85, 1, 1.25]) {
      await page.evaluate((scale) => document.documentElement.style.setProperty('--ds-ui-scale', String(scale)), scale)
      for (const [visible, top] of [[height,0], [Math.min(320,height),0], [260,24], [height,0]]) {
        await page.evaluate(([visible, top]) => window.resizeVisualViewport(visible, top), [visible,top])
        const actual = await geometry()
        assert.equal(actual.zoom, '1')
        assert.ok(Math.abs(actual.bottom - (visible + top)) < 1, JSON.stringify({width,height,scale,visible,top,actual}))
        assert.equal(actual.overflow, false)
        assert.ok(actual.timelineHeight > 50)
        assert.equal(actual.inputFont, '16px')
        assert.equal(actual.sendSize, 44)
      }
    }
    console.log(`${width}x${height}: desktop zoom 85/100/125%, keyboard open/pan/close PASS`)
  }
  await page.setViewportSize({width:393,height:670})
  await page.evaluate(() => window.resizeVisualViewport(670))
  await page.locator('.rooms-rich-input').fill('多行输入测试\n'.repeat(30))
  assert.ok((await geometry()).timelineHeight > 200)
  const focused = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect()
    const input = box('.rooms-rich-input')
    const send = box('.rooms-composer-send')
    const plus = box('.rooms-composer-context-popover')
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
    return {
      overlapSend: overlap(input, send),
      overlapPlus: overlap(input, plus),
      sendBelow: send.top >= input.bottom - 1,
      plusBelow: plus.top >= input.bottom - 1,
      sendSize: send.height
    }
  })
  assert.equal(focused.overlapSend, false, JSON.stringify(focused))
  assert.equal(focused.overlapPlus, false, JSON.stringify(focused))
  assert.equal(focused.sendBelow, true, JSON.stringify(focused))
  assert.equal(focused.plusBelow, true, JSON.stringify(focused))
  assert.equal(focused.sendSize, 44)
  await page.locator('.kun-mobile-room-conversation > header h1').click()
  const collapsed = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect()
    const input = box('.rooms-rich-input')
    const send = box('.rooms-composer-send')
    return { sendRightOf: send.left >= input.right - 1, sendSize: send.height }
  })
  assert.equal(collapsed.sendRightOf, true, JSON.stringify(collapsed))
  assert.equal(collapsed.sendSize, 44)
  await page.locator('.rooms-composer-context-popover').click()
  await page.locator('.rooms-popover-surface').waitFor()
  const popover = await page.locator('.rooms-popover-surface').boundingBox()
  assert.ok(popover.x >= 0 && popover.x + popover.width <= 393)
  await page.keyboard.press('Escape')
  await page.locator('.rooms-rich-input').fill('')
  for (const selector of ['.rooms-composer-context-popover', '.ds-composer-permission-button']) {
    await page.evaluate(() => window.resizeVisualViewport(260, 24))
    await page.locator(selector).click()
    const panel = page.locator(selector.includes('permission') ? '.ds-composer-permission-menu' : 'body > .rooms-popover-surface')
    await panel.waitFor()
    for (const [visible, top] of [[260,24], [220,0], [670,0]]) {
      await page.evaluate(([height, top]) => window.resizeVisualViewport(height, top), [visible,top])
      const bounds = await panel.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 393)
      assert.ok(bounds.y >= top && bounds.y + bounds.height <= visible + top,
        JSON.stringify({selector,visible,top,bounds}))
    }
    await page.locator('.kun-mobile-room-conversation > header h1').click()
    await panel.waitFor({state:'hidden'})
  }
  await page.evaluate(async () => { window.closeNestedMenuFixture = await window.openNestedMenuFixture() })
  await page.getByRole('button', {name:'Outer menu', exact:true}).click()
  await page.getByRole('button', {name:'Inner menu', exact:true}).click()
  for (const [height,top] of [[220,24],[670,0]]) {
    await page.evaluate(([height,top]) => window.resizeVisualViewport(height,top), [height,top])
    const nested = await page.getByRole('dialog', {name:'Inner menu', exact:true}).boundingBox()
    assert.ok(nested.y >= top && nested.y + nested.height <= top + height)
  }
  await page.evaluate(() => window.closeNestedMenuFixture())
  await page.evaluate(() => {
    window.mobileInputRequests = [{ id:'ask-mobile', prompt:'Choose', questions:[
      {id:'multi', question:'选择需要执行的操作', selectionMode:'multiple', minSelections:2, maxSelections:2,
        options:Array.from({length:8}, (_,i) => ({label:'Option '+i, description:'Long description '.repeat(12)}))},
      {id:'text', question:'补充说明', options:[]}
    ]}];
  })
  await page.locator('.kun-mobile-room-gates .kun-mobile-input-trigger').waitFor({timeout:20_000})
  await page.locator('.kun-mobile-room-gates .kun-mobile-input-trigger').click()
  for (const [width,height] of [[320,568],[393,670],[852,393]]) {
    await page.setViewportSize({width,height})
    for (const [visible,top] of [[height,0],[280,24]]) {
      await page.evaluate(([height,top]) => window.resizeVisualViewport(height,top), [visible,top])
      const metrics = await page.evaluate(() => {
        const sheet = document.querySelector('.kun-mobile-sheet').getBoundingClientRect();
        const footer = document.querySelector('.kun-mobile-sheet-footer').getBoundingClientRect();
        const body = document.querySelector('.kun-mobile-sheet-content');
        return {top:sheet.top,bottom:sheet.bottom,footerTop:footer.top,footerBottom:footer.bottom,
          scrollable:body.scrollHeight > body.clientHeight, overflow:document.documentElement.scrollWidth > innerWidth};
      })
      assert.ok(metrics.top >= top && metrics.bottom <= visible+top)
      assert.ok(metrics.footerBottom <= visible+top && metrics.footerTop >= top)
      assert.equal(metrics.scrollable,true)
      assert.equal(metrics.overflow,false)
    }
  }
  await page.setViewportSize({width:393,height:670})
  await page.evaluate(() => window.resizeVisualViewport(670))
  await page.locator('.kun-mobile-input-option input').nth(0).check()
  assert.equal(await page.locator('.kun-mobile-input-primary').isDisabled(),true)
  await page.locator('.kun-mobile-input-option input').nth(1).check()
  assert.equal(await page.locator('.kun-mobile-input-option input').nth(2).isDisabled(),true)
  await page.locator('.kun-mobile-input-primary').click()
  await page.locator('.kun-mobile-input textarea').fill('独立回答\\n第二行')
  await page.evaluate(() => { window.failNextAnswer = true; window.resizeVisualViewport(320) })
  await page.locator('.kun-mobile-input-primary').click()
  await page.getByRole('alert').filter({hasText:'Offline - retry'}).waitFor()
  assert.equal(await page.locator('.kun-mobile-input textarea').inputValue(),'独立回答\\n第二行')
  await page.locator('.kun-mobile-input-primary').click()
  await page.locator('.kun-mobile-sheet').waitFor({state:'hidden'})
  const submissions = await page.evaluate(() => window.mobileInputSubmissions)
  assert.equal(submissions.length,1)
  assert.deepEqual(submissions[0].answers[0].values,['Option 0','Option 1'])
  assert.equal(submissions[0].answers[1].value,'独立回答\\n第二行')
  console.log('Rooms pending input: visible footer, long options, multi-select, free text, retry PASS')
  await page.evaluate(() => {
    document.documentElement.dataset.remoteSurface = 'desktop'
    document.documentElement.style.setProperty('--ds-ui-scale', '.85')
  })
  assert.equal((await geometry()).zoom, '0.85', 'desktop font scale must remain unchanged')
  assert.deepEqual(errors, [])
  console.log('Real Rooms composer, long Markdown, multiline draft, keyboard-safe menus, desktop scale PASS')
} finally {
  await browser?.close()
  await server?.close()
  await rm(temporary, {recursive:true,force:true})
}
