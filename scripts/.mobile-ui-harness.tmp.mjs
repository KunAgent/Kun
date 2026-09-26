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
import '/src/styles/base-shell.css';
import '/src/styles/markdown-code.css';
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
await i18n.changeLanguage('zh');

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
    server: { host: '127.0.0.1', port: 5199, strictPort: true },
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
  console.log('READY')
  await new Promise(() => {})
} finally {
  await server?.close()
}
