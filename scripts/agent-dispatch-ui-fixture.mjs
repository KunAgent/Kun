// Production cards and controls with a host boundary fixture. Execution and
// persistence are covered separately by Kun tests; this fixture never invokes a model.
export function agentDispatchUiFixture() {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import '/src/renderer/src/index.css';
import '/src/renderer/src/styles/base-shell.css';
import '/src/renderer/src/styles/neutral-polish.css';
const calls = [], root = createRoot(document.getElementById('root'));
let epoch = 0, current, delay = 0;
const initial = (state = 'countdown') => ({
  intentId: 'fixture-intent-' + (++epoch), kind: 'worker', state, revision: 1,
  source: { threadId: 'fixture-parent', turnId: 'fixture-turn', toolCallId: 'fixture-tool', applicationSessionId: 'fixture-app' },
  policySnapshot: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
  recommendation: { title: 'Implement the selected project with the configured third-party Agent and validate all acceptance conditions',
    task: 'Read the project, implement the selected change, run its focused tests, and return evidence for the main Agent to review.',
    agentId: 'fixture-external', agentName: 'Configured external Agent with a deliberately long display name',
    model: 'very-long-provider-model-name-with-thinking-and-extended-context-window-2026-10',
    workspace: '/fixture/a/very/long/project/path/for/narrow-window-validation',
    acceptanceCriteria: ['Relevant checks pass.', 'The parent Agent reviews the changes and reports the outcome.'],
    permissionMode: 'full-access', effectivePermissionMode: 'approve-for-me', agentSelection: 'auto' },
  startRequestId: 'fixture-stable-start-' + epoch, deadline: new Date(Date.now() + 60_000).toISOString(),
  cancellationRequested: false, takenOver: false, replacementCount: 0,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
});
current = initial();
window.kunGui = { platform: 'fixture', appEnvironment: 'development', openExternal: async () => undefined,
  runtimeRequest: async (path, method, body) => {
    if (!path.startsWith('/v1/agent-dispatch-intents/')) return { ok: true, status: 200, body: '{}' };
    if (method === 'POST') {
      const action = JSON.parse(body); calls.push(action);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (action.expectedRevision !== current.revision) return { ok: false, status: 409, body: JSON.stringify({ error: { message: 'Stale revision' } }) };
      if (action.action === 'pause') { current.state = 'paused'; delete current.deadline; }
      if (action.action === 'start_now') { current.state = 'queued'; delete current.deadline; }
      if (action.action === 'resume' || action.action === 'update') {
        if (action.recommendation) current.recommendation = { ...current.recommendation, ...action.recommendation };
        current.state = 'countdown'; current.deadline = new Date(Date.now() + 60_000).toISOString();
      }
      if (action.action === 'cancel') { current.state = current.target ? 'stopping' : 'cancelled'; current.cancellationRequested = true; delete current.deadline; }
      current.revision += 1; current.updatedAt = new Date().toISOString();
    }
    return { ok: true, status: 200, body: JSON.stringify({ intent: current }) };
  }
};
const { AgentDispatchGroup } = await import('/src/renderer/src/components/chat/AgentDispatchCard');
const { publishAgentDispatchIntent } = await import('/src/renderer/src/agent/agent-dispatch-client');
const { useChatStore } = await import('/src/renderer/src/store/chat-store');
const { default: i18n } = await import('/src/renderer/src/i18n');
useChatStore.setState({ activeThreadId: 'fixture-parent', runtimeConnection: 'ready' });
await i18n.changeLanguage('en');
function render() {
  const block = { kind: 'tool', id: 'fixture-tool-block-' + epoch, status: 'success', summary: 'Dispatch saved',
    meta: { dispatchIntentId: current.intentId, dispatchIntent: current } };
  flushSync(() => root.render(<main style={{ maxWidth: 640, margin: '20px auto', padding: 16, minWidth: 0 }}>
    <AgentDispatchGroup blocks={[block]} />
  </main>));
}
function update(patch) {
  current = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  publishAgentDispatchIntent(current);
}
window.dispatchFixture = { calls, ready: true, snapshot: () => structuredClone(current),
  scenario: state => { current = initial(state); render(); },
  state: state => update({ state, ...(state === 'running' ? { target: { workerIds: ['fixture-worker'], dispatchIds: ['fixture-dispatch'] } } : {}),
    ...(state === 'completed' ? { resultSummary: 'Focused checks passed. The parent Agent reviewed the result.' } : {}) }),
  deny: () => update({ state: 'failed', error: 'Automatic review rejected this task because it is outside the requested scope.',
    decision: { decision: 'deny', reason: 'Outside requested scope', decidedAt: new Date().toISOString() } }),
  language: locale => i18n.changeLanguage(locale),
  theme: theme => { document.documentElement.dataset.theme = theme; },
  delay: ms => { delay = ms; },
  active: enabled => useChatStore.setState({ activeThreadId: enabled ? 'fixture-parent' : 'other-conversation' })
};
document.documentElement.dataset.theme = 'light';
render();
`
}
