import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Render the real mobile Code home switch, conversation list and mode bar with
// fixture data. Conversations live under Code: no Rooms tab, one badge on Code.
const repository = fileURLToPath(new URL('../', import.meta.url))
const evidenceArgument = process.argv.indexOf('--evidence')
const evidence = evidenceArgument > 0 ? resolve(process.argv[evidenceArgument + 1]) : null
const temporary = await mkdtemp(join(tmpdir(), 'kun-mobile-code-segments-'))
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import '/src/styles/base-shell.css';
import '/src/mobile/mobile-app-shell.css';
const now = new Date().toISOString();
const member = (id, displayName, avatar) => ({ id, displayName, role:'developer', enabled:true, presetId:'kun',
  roleNotes:'', allowedRepositoryIds:[], revision:1, avatar:{ kind:'builtin', id:avatar } });
const latest = (preview, authorKind='member', authorLabelSnapshot='') => ({ preview, authorKind, authorLabelSnapshot,
  createdAt:now, attachmentCount:0 });
window.fixtureEntries = [
  { id:'chat-kun', roomId:'room-kun', agentId:'agent-kun', name:'小 Kun', title:'小 Kun', kind:'user_agent',
    avatar:{ kind:'builtin', id:'coordinator' }, members:[], pinned:false, archived:false, deleted:false,
    latestMessage:latest('好的，已经帮你整理成三条待办。'), latestMessageSeq:4, readSeq:3, runningCount:0, attentionCount:0 },
  { id:'group-review', roomId:'room-review', name:'发布前评审', title:'发布前评审', kind:'group',
    members:[member('kun','小 Kun','coordinator'), member('coder','代码助手','coder')], pinned:false, archived:false,
    deleted:false, latestMessage:latest('测试都过了，可以合并。', 'member', '代码助手'), latestMessageSeq:9, readSeq:8,
    runningCount:1, attentionCount:0 },
  { id:'chat-detective', roomId:'room-detective', agentId:'agent-detective', name:'侦探', title:'侦探', kind:'user_agent',
    avatar:{ kind:'builtin', id:'detective' }, members:[], pinned:false, archived:false, deleted:false,
    latestMessage:latest('需要你确认是否回滚。'), latestMessageSeq:2, readSeq:2, runningCount:0, attentionCount:1 }
];
window.kunGui = { isRemoteWeb:true, platform:'web', runtimeRequest:async () => ({ ok:true, status:200, body:'{}' }) };
const [{MobileRoomsHome}, {MobileCodeSegments}, {MobileModeNav}, {default:i18n}] = await Promise.all([
  import('/src/mobile/rooms/MobileRoomsHome.tsx'), import('/src/mobile/screens/MobileCodeSegments.tsx'),
  import('/src/mobile/MobileModeNav.tsx'), import('/src/i18n.ts')]);
await i18n.changeLanguage('zh');
window.segmentSelections = [];
function Harness() {
  const [segment, setSegment] = React.useState('chats');
  const segments = React.createElement(MobileCodeSegments, { active:segment, chatsBadge:2,
    onSelect:(next) => { window.segmentSelections.push(next); setSegment(next) } });
  const noop = () => {};
  const home = segment === 'chats'
    ? React.createElement(MobileRoomsHome, { segments, rooms:window.fixtureEntries, agents:[], view:'chats', deletedOnly:false,
      onView:noop, onDeletedOnly:noop, onOpenAgent:noop, search:'', filter:'all', loading:false, error:'', hasMore:false,
      onSearch:noop, onFilter:noop, onOpen:noop, onPin:noop, onSettings:noop, onArchive:noop, onDelete:noop, onRestore:noop,
      onCreate:noop, onProfile:noop, onRetry:noop, onLoadMore:noop })
    : React.createElement('section', { className:'kun-mobile-projects' },
      React.createElement('header', null, React.createElement('h1', null, '项目')), segments,
      React.createElement('p', { style:{ padding:'0 16px', color:'var(--ds-text-muted)' } }, '最近任务与项目列表'));
  return React.createElement('main', {className:'kun-mobile-app', 'data-mobile-mode':'code'},
    React.createElement('div', {className:'kun-mobile-app-content'}, home),
    React.createElement(MobileModeNav, { active:'code', attention:{ code:2 }, modes:['code', 'work'],
      labels:{ code:'Code', rooms:'对话', work:'Work', agents:'Agents' }, onSelect:noop }));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
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
      name: 'mobile-code-segments-fixture',
      resolveId(id) { if (id === '/__mobile-segments-entry.js') return '\0mobile-segments-entry' },
      load(id) { if (id === '\0mobile-segments-entry') return entry },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === '/__mobile-segments') {
            response.setHeader('Content-Type', 'text/html')
            response.end(await vite.transformIndexHtml('/__mobile-segments', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/__mobile-segments-entry.js"></script></body></html>'))
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
  if (evidence) await mkdir(evidence, { recursive: true })
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 393, height: 760 }, isMobile: true, hasTouch: true,
      reducedMotion: 'reduce', colorScheme: theme })
    const errors = []
    page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
    await page.goto(`${server.resolvedUrls.local[0]}__mobile-segments`)
    if (theme === 'dark') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await page.locator('.kun-mobile-room-open').first().waitFor({ timeout: 90_000 })
    const nav = page.locator('.kun-mobile-mode-nav button')
    assert.deepEqual(await nav.allInnerTexts().then((labels) => labels.map((label) => label.replace(/\d+/g, '').trim())), ['Code', 'Work'],
      'The mobile mode bar no longer offers Rooms')
    assert.equal(await page.locator('.kun-mobile-mode-nav .kun-mobile-mode-badge').innerText(), '2', 'Conversation unread count sits on Code')
    const tabs = page.getByRole('tab')
    assert.deepEqual(await tabs.allInnerTexts().then((labels) => labels.map((label) => label.replace(/\d+/g, '').trim())), ['任务', '对话'])
    assert.equal(await page.getByRole('tab', { name: /对话/ }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.locator('.kun-mobile-room-open .rooms-avatar[data-compact]').count() > 0, true,
      'List avatars use the compact face crop')
    if (evidence) await page.screenshot({ path: join(evidence, `mobile-code-chats-${theme}.png`) })
    await page.getByRole('tab', { name: '任务' }).click()
    await page.locator('.kun-mobile-projects').waitFor()
    assert.equal(await page.getByRole('tab', { name: '任务' }).getAttribute('aria-selected'), 'true')
    assert.deepEqual(await page.evaluate(() => window.segmentSelections), ['tasks'])
    if (evidence) await page.screenshot({ path: join(evidence, `mobile-code-tasks-${theme}.png`) })
    assert.deepEqual(errors, [])
    await page.close()
  }
  console.log('Mobile Code tasks / conversations switch, mode bar without Rooms, compact avatars PASS')
} finally {
  await browser?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
