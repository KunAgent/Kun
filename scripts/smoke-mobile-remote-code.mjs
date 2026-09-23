import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Drives the real mobile Code home + conversation through the real chat store.
// Only the host bridge (window.kunGui) is faked: it serves a global first page
// that does NOT contain the selected project's threads, project-scoped pages,
// a live SSE channel the test can push frames into, and a call log used to
// assert the renderer hit the right runtime endpoints without ever persisting
// the host's settings.
const repository = fileURLToPath(new URL('../', import.meta.url))
const temporary = await mkdtemp(join(tmpdir(), 'kun-mobile-code-'))
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import '/src/index.css';
import '/src/mobile/mobile-app-shell.css';

const NOW = '2026-09-22T00:00:00.000Z';
const PROJECT = '/repo/app';
const OTHER = '/repo/other';
const WORKTREE = '/repo/app/.kun-worktrees/wt-1';

// 120 filler threads crowd the global first page (limit 100) while sharing
// only 5 workspaces — the remembered-roots list caps at 30 entries, so a
// distinct root per filler would evict the selected project from the picker.
const fillers = Array.from({length: 120}, (_, i) => ({
  id: 'filler-' + i, title: 'Filler ' + i, workspace: '/filler/ws-' + (i % 5),
  model: 'deepseek-chat', mode: 'agent', status: 'idle', createdAt: NOW, updatedAt: NOW
}));
const projectThreads = Array.from({length: 11}, (_, i) => ({
  id: 'app-thread-' + i, title: 'App Session ' + i, workspace: PROJECT,
  model: 'deepseek-chat', mode: 'agent', status: 'idle', createdAt: NOW, updatedAt: NOW
}));
const worktreeThread = {
  id: 'wt-1', title: 'Worktree Fix', workspace: WORKTREE,
  model: 'deepseek-chat', mode: 'agent', status: 'idle', createdAt: NOW, updatedAt: NOW
};
const writeThread = {
  id: 'write-1', title: 'Write Doc', workspace: PROJECT, agentSurface: 'write',
  model: 'deepseek-chat', mode: 'agent', status: 'idle', createdAt: NOW, updatedAt: NOW
};
const scoped = [...projectThreads, worktreeThread, writeThread];

window.__kunCalls = { http: [], sse: [], acks: [], approvals: [], settingsWrites: [] };
const sseHandlers = new Map();
const onEvent = (name) => (handler) => {
  if (typeof handler !== 'function') return () => {};
  const list = sseHandlers.get(name) || [];
  list.push(handler);
  sseHandlers.set(name, list);
  return () => { const i = list.indexOf(handler); if (i >= 0) list.splice(i, 1) };
};
window.__kunEmit = (channel, payload) => {
  for (const handler of (sseHandlers.get(channel) || []).slice()) handler(payload);
};

const settings = {
  workspaceRoot: OTHER,
  conversationWorkspaceRoot: '/conversations',
  write: { defaultWorkspaceRoot: '', activeWorkspaceRoot: '', workspaces: [] },
  claw: { channels: [] },
  theme: 'dark', uiFontScale: 1, chatContentMaxWidthPx: 896,
  composerSendKey: 'enter', locale: 'en', initialSetupCompleted: true,
  agents: { kun: { autoStart: false, apiKey: '', model: 'deepseek-chat',
    providerId: 'deepseek', baseUrl: '' } },
  disabledSkillIds: []
};

function listResponse(url) {
  const query = new URLSearchParams(url.split('?')[1] || '');
  const workspace = query.get('workspace');
  const extra = query.getAll('workspaces');
  const search = (query.get('search') || '').toLowerCase();
  const cursor = query.get('cursor');
  if (workspace) {
    const roots = [workspace, ...extra];
    let rows = scoped.filter((thread) => roots.includes(thread.workspace));
    if (search) rows = rows.filter((thread) => thread.title.toLowerCase().includes(search));
    return { threads: rows, hasMore: false };
  }
  if (cursor === 'g2') return { threads: [], hasMore: false };
  return { threads: fillers, hasMore: true, nextCursor: 'g2', total: fillers.length + scoped.length };
}

function threadRecord(id, workspace, title) {
  return { id, title, workspace, model: 'deepseek-chat', mode: 'agent',
    status: 'idle', createdAt: NOW, updatedAt: NOW };
}

async function runtimeRequest(path, method, body) {
  window.__kunCalls.http.push({ path, method: method || 'GET', body: body || null });
  const respond = (data, status = 200) => ({ ok: status < 400, status, body: JSON.stringify(data) });
  if (path === '/health') return respond({ ok: true });
  if (path === '/v1/model-connections') return respond({
    schemaVersion: 1, revision: 1,
    defaultProviderId: 'deepseek', defaultAccountId: 'acct-1', defaultModel: 'deepseek-chat',
    providers: [{ id: 'deepseek', accountId: 'acct-1', configured: true, models: ['deepseek-chat'] }],
    proxy: { enabled: false, url: '' }, routePools: [], localModelGateway: { enabled: false }
  });
  if (path === '/v1/runtime/info') return respond({
    host: '127.0.0.1', port: 18899, dataDir: '/tmp/kun', startedAt: NOW,
    capabilities: { attachments: { available: false } }
  });
  if ((path === '/v1/threads' || path.startsWith('/v1/threads?')) &&
      (method || 'GET') === 'GET') return respond(listResponse(path));
  if (path === '/v1/threads' && method === 'POST') {
    const payload = JSON.parse(body || '{}');
    const created = threadRecord('new-thread-1', payload.workspace, payload.title || 'New conversation');
    created.agentSurface = payload.agentSurface;
    scoped.push(created);
    window.__kunCalls.created = payload;
    return respond(created);
  }
  const timeline = path.match(/^\\/v1\\/threads\\/([^/]+)\\/timeline/);
  if (timeline) {
    const id = decodeURIComponent(timeline[1]);
    const known = scoped.find((thread) => thread.id === id) || fillers[0];
    return respond({ id, title: known.title, workspace: known.workspace, model: 'deepseek-chat',
      mode: 'agent', status: 'idle', turns: [], latestSeq: 0,
      pendingUserInputIds: [], pendingApprovalIds: [], timeline: { hasMore: false },
      createdAt: NOW, updatedAt: NOW });
  }
  const state = path.match(/^\\/v1\\/threads\\/([^/]+)\\/state/);
  if (state) return respond({ status: 'idle', updatedAt: NOW, latestSeq: window.__kunCalls.latestSeq || 0,
    pendingUserInputIds: [] });
  if (/^\\/v1\\/threads\\/[^/]+\\/queued-turns/.test(path)) return respond({ queuedTurns: [] });
  if (/^\\/v1\\/threads\\/[^/]+\\/turns/.test(path) && method === 'POST') {
    window.__kunCalls.lastTurn = JSON.parse(body || '{}');
    return respond({ threadId: decodeURIComponent(path.split('/')[3]), turnId: 'turn-1',
      userMessageItemId: 'um-1', status: 'running' });
  }
  return respond({});
}

const api = {
  platform: 'web', isRemoteWeb: true, homeDir: '/home/remote',
  appEnvironment: { flavor: 'production', isPackaged: true },
  desktopTitleBarMode: 'system',
  getSettings: async () => settings,
  setSettings: async (partial) => {
    window.__kunCalls.settingsWrites.push(partial);
    return { ...settings, ...partial };
  },
  saveSettingsSilent: async (partial) => ({ ...settings, ...partial }),
  runtimeRequest,
  cancelRuntimeRequest: async () => true,
  startSse: async (threadId, sinceSeq, streamId, options) => {
    window.__kunCalls.sse.push({ threadId, sinceSeq, streamId, options });
    return { streamId };
  },
  stopSse: async () => true,
  ackSse: async (streamId, batchId) => {
    window.__kunCalls.acks.push({ streamId, batchId });
    return true;
  },
  onSseOpen: onEvent('runtime:sse-open'),
  onSseEvent: onEvent('runtime:sse-event'),
  onSseEnd: onEvent('runtime:sse-end'),
  onSseError: onEvent('runtime:sse-error'),
  onRemoteStreamReconnected: onEvent('remote:stream-reconnected'),
  onRemoteSenderReset: onEvent('remote:sender-reset'),
  onRuntimeStatus: onEvent('runtime:status'),
  resolveKunApproval: async (payload) => {
    window.__kunCalls.approvals.push(payload);
    return { confirmed: true, response: { ok: true, status: 200, body: '{}' } };
  },
  fetchUpstreamModels: async () => ({ ok: true, modelIds: ['deepseek-chat'],
    defaultModel: { providerId: 'deepseek', modelId: 'deepseek-chat' },
    modelGroups: [{ providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-chat'] }] }),
  workspaceDirectoryExists: async () => true,
  pickWorkspaceDirectory: async () => ({ canceled: true, path: null }),
  pickLocalFiles: async () => ({ canceled: true, paths: [] }),
  getPathForFile: () => '',
  getAppVersion: async () => '0.0.0-smoke',
  setAppBadgeCount: async () => ({ applied: true }),
  logError: async () => ({ ok: true }),
  startup: { getState: async () => ({ phase: 'ready' }), onState: onEvent('startup:state') },
  sharedClientState: { read: async () => ({ revision: 0, entries: {} }), write: async () => ({ ok: true }) }
};
window.kunGui = new Proxy(api, {
  get(target, prop) {
    if (typeof prop === 'symbol' || prop === 'then') return undefined;
    if (prop in target) return target[prop];
    if (typeof prop === 'string' && /^on[A-Z]/.test(prop)) return () => () => {};
    return () => Promise.reject(new Error('kunGui.' + String(prop) + ' is not available in this smoke'));
  }
});

localStorage.setItem('kun.threadWorktrees.v1', JSON.stringify({ version: 1, worktrees: {
  'wt-1': { projectPath: PROJECT, worktreePath: WORKTREE, branch: 'kun-wt-1' }
} }));

const [{ useChatStore }, { MobileCodeHome }, { MobileCodeConversation },
  { useMobileViewport }, { useRemoteReconnectRecovery }, { useRemoteSurface },
  { default: i18n }] = await Promise.all([
  import('/src/store/chat-store.ts'),
  import('/src/mobile/screens/MobileCodeHome.tsx'),
  import('/src/mobile/chat/MobileCodeConversation.tsx'),
  import('/src/mobile/use-mobile-viewport.ts'),
  import('/src/use-remote-reconnect-recovery.ts'),
  import('/src/mobile/use-remote-surface.ts'),
  import('/src/i18n.ts')
]);
await i18n.changeLanguage('en');

useChatStore.setState({
  route: 'chat', runtimeConnection: 'offline', workspaceRoot: OTHER,
  conversationWorkspaceRoot: '/conversations',
  codeWorkspaceRoots: [OTHER, PROJECT],
  removedCodeWorkspaces: { version: 1, removed: [] },
  threads: [], threadListStatus: 'loading', threadListCursorByWorkspace: {},
  activeThreadId: null, blocks: [], busy: false, error: null,
  clawChannels: [], showArchivedThreads: false, threadSearch: ''
});
window.__kunStore = useChatStore;

function Harness() {
  useRemoteSurface();
  useMobileViewport();
  useRemoteReconnectRecovery();
  const [threadId, setThreadId] = React.useState(null);
  return React.createElement('main', { className: 'kun-mobile-app' },
    React.createElement('div', { className: 'kun-mobile-app-content' },
      threadId
        ? React.createElement(MobileCodeConversation, { threadId, onBack: () => setThreadId(null) })
        : React.createElement(MobileCodeHome, { onOpen: setThreadId })));
}
createRoot(document.getElementById('root')).render(React.createElement(Harness));
useChatStore.getState().probeRuntime('user').catch((e) => { window.__kunError = String(e && e.stack || e) });
window.addEventListener('unhandledrejection', (e) => { window.__kunError = String(e.reason && e.reason.stack || e.reason) });
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
      name: 'mobile-code-fixture',
      resolveId(id) { if (id === '/__mobile-code-entry.js') return '\0mobile-code-entry' },
      load(id) { if (id === '\0mobile-code-entry') return entry },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url === '/__mobile-code') {
            response.setHeader('Content-Type', 'text/html')
            response.end(await vite.transformIndexHtml('/__mobile-code', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body><div id="root"></div><script type="module" src="/__mobile-code-entry.js"></script></body></html>'))
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
  const page = await browser.newPage({ viewport: { width: 393, height: 670 },
    screen: { width: 393, height: 852 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message) })
  await page.goto(`${server.resolvedUrls.local[0]}__mobile-code`)

  const httpCalls = (predicate) => page.evaluate(
    (source) => window.__kunCalls.http.filter(new Function('call', `return (${source})(call)`)),
    predicate.toString()
  )
  const threadListCalls = (scope) => httpCalls(
    `c => c.path.startsWith('/v1/threads?') || c.path === '/v1/threads' ? (${scope})(c) : false`
  )

  // Boot: runtime probe + global first page (the 120 fillers crowd out the
  // project's rows — the reproduction scenario).
  await page.locator('.kun-mobile-projects').waitFor({ timeout: 90_000 })
  await page.getByRole('button', { name: 'app', exact: false }).first().waitFor()
  await page.waitForFunction(() =>
    window.__kunCalls.http.some((call) => call.path.startsWith('/v1/threads')))
  assert.equal(await page.evaluate(() => window.__kunCalls.settingsWrites.length), 0)

  // Selecting a project fetches its own first page from the server instead of
  // relying on the global inventory.
  await page.getByRole('button', { name: 'app', exact: false }).first().click()
  try {
    await page.locator('.kun-mobile-home').waitFor({ timeout: 15_000 })
  } catch (e) {
    console.log('DEBUG store:', await page.evaluate(() => {
      const s = window.__kunStore.getState()
      return JSON.stringify({ runtimeConnection: s.runtimeConnection,
        workspaceRoot: s.workspaceRoot, error: s.error, stack: window.__kunError,
        http: window.__kunCalls.http.map((c) => c.method + ' ' + c.path),
        threadListStatus: s.threadListStatus, threadCount: s.threads.length,
        buttons: [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent).slice(0, 20) })
    }))
    throw e
  }
  await page.waitForFunction(() =>
    window.__kunCalls.http.some((call) => call.path.includes('workspace=%2Frepo%2Fapp')))
  await page.locator('.kun-mobile-thread-title', { hasText: 'App Session 10' }).waitFor()
  // Worktree conversations group under the owning project; write threads do not leak in.
  await page.locator('.kun-mobile-thread-title', { hasText: 'Worktree Fix' }).waitFor()
  assert.equal(await page.locator('.kun-mobile-thread-title', { hasText: 'Write Doc' }).count(), 0)
  assert.equal(await page.locator('.kun-mobile-thread-title', { hasText: 'Filler' }).count(), 0)
  console.log('project-scoped load: cold project page, worktree grouping, Code-only rows PASS')

  // Server-side search reaches sessions outside every loaded page.
  await page.locator('.kun-mobile-search input').fill('Session 3')
  await page.waitForFunction(() =>
    window.__kunCalls.http.some((call) =>
      /[?&]search=Session/.test(call.path) && call.path.includes('workspace=%2Frepo%2Fapp')),
    { timeout: 10_000 })
  await page.locator('.kun-mobile-thread-title', { hasText: 'App Session 3' }).waitFor()
  assert.equal(await page.locator('.kun-mobile-thread-title', { hasText: 'App Session 10' }).count(), 0)
  await page.locator('.kun-mobile-search input').fill('')
  await page.locator('.kun-mobile-thread-title', { hasText: 'App Session 10' }).waitFor()
  console.log('project search: server-side workspace+search query PASS')

  // Open a conversation: timeline hydration + live SSE subscription.
  await page.locator('.kun-mobile-thread-title', { hasText: 'App Session 3' }).click()
  await page.locator('.kun-mobile-code-conversation').waitFor()
  await page.waitForFunction(() =>
    window.__kunCalls.http.some((call) => call.path.includes('/v1/threads/app-thread-3/timeline')))
  await page.waitForFunction(() =>
    window.__kunCalls.sse.some((call) => call.threadId === 'app-thread-3'))
  const streamId = await page.evaluate(() =>
    window.__kunCalls.sse.find((call) => call.threadId === 'app-thread-3').streamId)

  // Push replay sync + an assistant delta through the ack'd batch channel.
  await page.evaluate(([sid]) => {
    window.__kunEmit('runtime:sse-open', { streamId: sid, threadId: 'app-thread-3' })
    window.__kunEmit('runtime:sse-event', { streamId: sid, batchId: 'b1', events: [
      { kind: 'replay_synchronized', threadId: 'app-thread-3', cursor: 0 },
      { kind: 'assistant_text_delta', seq: 1, threadId: 'app-thread-3', turnId: 'turn-1',
        itemId: 'item-1', timestamp: '2026-09-22T00:00:01.000Z',
        item: { id: 'item-1', kind: 'assistant_text', threadId: 'app-thread-3', turnId: 'turn-1',
          text: 'Hello from Kun remote' } }
    ] })
  }, [streamId])
  await page.locator('.kun-mobile-code-timeline', { hasText: 'Hello from Kun remote' }).waitFor()
  await page.waitForFunction(() => window.__kunCalls.acks.some((ack) => ack.batchId === 'b1'))
  console.log('live stream: open, replay_synchronized, delta projection, batch ack PASS')

  // Approval request lands as an actionable card; Allow resolves through the bridge.
  await page.evaluate(([sid]) => {
    window.__kunEmit('runtime:sse-event', { streamId: sid, batchId: 'b2', events: [
      { kind: 'approval_requested', seq: 2, threadId: 'app-thread-3', turnId: 'turn-1',
        approvalId: 'appr-1', toolName: 'bash', summary: 'Run npm test',
        timestamp: '2026-09-22T00:00:02.000Z' }
    ] })
  }, [streamId])
  await page.locator('.kun-mobile-approval').waitFor()
  await page.locator('.kun-mobile-approval').getByRole('button', { name: 'Allow', exact: true }).click()
  await page.waitForFunction(() =>
    window.__kunCalls.approvals.some((entry) =>
      entry.approvalId === 'appr-1' && entry.decision === 'allow'))
  console.log('approval card: request event -> Allow -> resolveKunApproval PASS')

  // Composer send posts the turn to the owning thread.
  await page.locator('.kun-mobile-composer textarea').fill('Ship the fix')
  await page.locator('.kun-mobile-composer-send').click()
  await page.waitForFunction(() => window.__kunCalls.lastTurn &&
    window.__kunCalls.lastTurn.prompt === 'Ship the fix')
  const lastTurn = await page.evaluate(() => window.__kunCalls.lastTurn)
  assert.equal(lastTurn.clientSurface, 'gui')
  assert.ok(await page.evaluate(() =>
    window.__kunCalls.http.some((call) =>
      call.method === 'POST' && call.path === '/v1/threads/app-thread-3/turns')))
  console.log('composer send: POST /v1/threads/<id>/turns with clientSurface=gui PASS')

  // Settle the turn so the send-time catch-up window closes before the drop.
  // The send may have rotated the SSE stream — always target the latest one.
  const liveStreamId = await page.evaluate(() =>
    window.__kunCalls.sse.filter((call) => call.threadId === 'app-thread-3').at(-1).streamId)
  await page.evaluate(([sid]) => {
    window.__kunEmit('runtime:sse-open', { streamId: sid, threadId: 'app-thread-3' })
    window.__kunEmit('runtime:sse-event', { streamId: sid, batchId: 'b3', events: [
      { kind: 'replay_synchronized', threadId: 'app-thread-3', cursor: 2 },
      { kind: 'turn_completed', seq: 3, threadId: 'app-thread-3', turnId: 'turn-1',
        timestamp: '2026-09-22T00:00:03.000Z' }
    ] })
  }, [liveStreamId])
  await page.waitForFunction(() => window.__kunCalls.acks.some((ack) => ack.batchId === 'b3'))

  // Stream drop -> scheduled recovery re-subscribes the active thread.
  const sseCount = await page.evaluate(() => window.__kunCalls.sse.length)
  await page.evaluate(([sid]) => window.__kunEmit('runtime:sse-end', { streamId: sid }), [liveStreamId])
  await page.waitForFunction((before) => window.__kunCalls.sse.length > before, sseCount,
    { timeout: 20_000 })
  console.log('stream end: recoverActiveTurn re-subscribed PASS')

  // Per-stream terminal errors recover just that stream; sender reset
  // resubscribes the active stream and refreshes inventory; a plain
  // stream-reconnect only quietly refreshes inventory.
  const activeStreamId = await page.evaluate(() =>
    window.__kunCalls.sse.filter((call) => call.threadId === 'app-thread-3').at(-1).streamId)
  const sseBeforeOverflow = await page.evaluate(() => window.__kunCalls.sse.length)
  await page.evaluate(([sid]) => window.__kunEmit('runtime:sse-error', {
    streamId: sid, code: 'remote_buffer_overflow', message: 'remote buffer overflow'
  }), [activeStreamId])
  await page.waitForFunction((before) => window.__kunCalls.sse.length > before,
    sseBeforeOverflow, { timeout: 20_000 })
  console.log('per-stream overflow: terminal error resubscribed PASS')

  const listBeforeReset = (await threadListCalls('c => true')).length
  await page.evaluate(() => window.__kunEmit('remote:sender-reset', {}))
  await page.waitForFunction((before) =>
    window.__kunCalls.http.filter((call) =>
      call.path === '/v1/threads' || call.path.startsWith('/v1/threads?')).length > before,
    listBeforeReset, { timeout: 10_000 })
  console.log('sender reset: inventory refresh + stream resubscribe PASS')

  await page.waitForTimeout(2_200)
  const sseBeforeReconnect = await page.evaluate(() => window.__kunCalls.sse.length)
  const listBeforeReconnect = (await threadListCalls('c => true')).length
  await page.evaluate(() => window.__kunEmit('remote:stream-reconnected', {}))
  await page.waitForFunction((before) =>
    window.__kunCalls.http.filter((call) =>
      call.path === '/v1/threads' || call.path.startsWith('/v1/threads?')).length > before,
    listBeforeReconnect, { timeout: 10_000 })
  const sseAfterReconnect = await page.evaluate(() => window.__kunCalls.sse.length)
  assert.strictEqual(sseAfterReconnect, sseBeforeReconnect,
    'quiet reconnect must not resubscribe healthy streams')
  console.log('quiet reconnect: inventory refresh only, streams untouched PASS')

  // Back to the project list, re-enter the project, open the settings sheet,
  // then New chat creates the thread inside it.
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('.kun-mobile-projects').waitFor()
  await page.getByRole('button', { name: 'app', exact: false }).first().click()
  await page.locator('.kun-mobile-home').waitFor()
  await page.locator('.kun-mobile-home-header button[aria-label="Settings"]').click()
  await page.locator('.kun-mobile-sheet').waitFor()
  const settingsBox = await page.locator('.kun-mobile-sheet').boundingBox()
  assert.ok(settingsBox && settingsBox.x >= 0 && settingsBox.y >= 0)
  await page.locator('.kun-mobile-sheet-header button').click()
  await page.locator('.kun-mobile-sheet').waitFor({ state: 'detached' })
  console.log('settings sheet: opens bounded over the project home PASS')
  await page.getByRole('button', { name: 'New chat', exact: true }).click()
  try {
    await page.waitForFunction(() => window.__kunCalls.created, undefined, { timeout: 15_000 })
  } catch (e) {
    console.log('DEBUG create:', await page.evaluate(() => {
      const s = window.__kunStore.getState()
      return JSON.stringify({ error: s.error, http: window.__kunCalls.http.slice(-12),
        homeError: document.querySelector('.kun-mobile-home [role="alert"]')?.textContent })
    }))
    throw e
  }
  const created = await page.evaluate(() => window.__kunCalls.created)
  assert.equal(created.workspace, '/repo/app')
  assert.equal(created.agentSurface, 'code')
  await page.locator('.kun-mobile-code-conversation').waitFor()
  console.log('new conversation: workspace=/repo/app agentSurface=code PASS')

  // Thread details sheet opens as a bounded overlay on the conversation.
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.locator('.kun-mobile-sheet').waitFor()
  const detailsBox = await page.locator('.kun-mobile-sheet').boundingBox()
  assert.ok(detailsBox && detailsBox.x >= 0 && detailsBox.y >= 0)
  await page.locator('.kun-mobile-sheet-header button').click()
  await page.locator('.kun-mobile-sheet').waitFor({ state: 'detached' })
  console.log('details sheet: opens bounded over the conversation PASS')

  // Geometry: no horizontal overflow and the composer stays inside the visual
  // viewport at the smallest phone size and in landscape.
  for (const size of [{ width: 320, height: 568 }, { width: 852, height: 393 }]) {
    await page.setViewportSize(size)
    await page.waitForTimeout(150)
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      composer: document.querySelector('.kun-mobile-composer')?.getBoundingClientRect()
    }))
    assert.ok(metrics.scrollWidth <= metrics.innerWidth + 1,
      `horizontal overflow at ${size.width}x${size.height}: ${metrics.scrollWidth} > ${metrics.innerWidth}`)
    assert.ok(!metrics.composer ||
      (metrics.composer.bottom <= size.height + 1 && metrics.composer.right <= size.width + 1),
      `composer out of viewport at ${size.width}x${size.height}`)
  }
  await page.setViewportSize({ width: 393, height: 670 })
  console.log('geometry: no horizontal overflow, composer in viewport (320x568, 852x393) PASS')

  // The whole session must never have persisted the host's settings.
  assert.equal(await page.evaluate(() => window.__kunCalls.settingsWrites.length), 0)
  assert.deepEqual(errors, [])
  console.log('Mobile Remote Code smoke PASS: project load, search, stream, approval, send, recovery, sheets, geometry, no settings writes')
} finally {
  await browser?.close()
  await server?.close()
  await rm(temporary, { recursive: true, force: true })
}
