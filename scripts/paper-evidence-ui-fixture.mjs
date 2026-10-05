// Deterministic offline harness for real production components.
// The preload boundary is simulated; backend persistence has integration tests.
export function paperEvidenceFixture() {
  return `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PaperMatrixWorkspace } from '/src/renderer/src/components/paper/evidence/PaperMatrixWorkspace';
import { PaperReadingDialog } from '/src/renderer/src/components/paper/evidence/PaperReadingDialog';
import { PaperReaderDrawer } from '/src/renderer/src/components/paper/reader/PaperReaderDrawer';
import { usePaperMarksStore } from '/src/renderer/src/paper/paper-marks-store';
import { useWriteWorkspaceStore } from '/src/renderer/src/write/write-workspace-store';
import { useChatStore } from '/src/renderer/src/store/chat-store';
import { createPaperComparisonMatrix, updatePaperComparisonMatrix } from '/src/shared/paper/paper-matrix';
import i18n from '/src/renderer/src/i18n';
import '/src/renderer/src/index.css';
import '/src/renderer/src/styles/base-shell.css';
const NOW = '2026-10-05T12:00:00.000Z';
const HASH = 'a'.repeat(64);
const entries = [1, 2, 3].map(n => ({ unitDir: 'papers/p' + n, meta: { version: 2, slug: 'p' + n, title: ['Small-model code search', 'Code retrieval at scale', 'A new evaluation split'][n - 1], authors: ['Researcher'], arxivId: '2601.0000' + n, citeKey: 'paper' + n, pdfFile: 'paper.pdf', importedAt: NOW }, hasPdf: true, interpretationCount: 0 }));
const blank = { version: 1, revision: 0, evidence: [], matrices: [] };
let state = JSON.parse(localStorage.getItem('paper-ui-state') || 'null') || structuredClone(blank);
let selected = entries.slice(0, 2);
let view = 'matrix', corrupt = false, stale = false, partial = false;
const calls = { model: [], source: 0, promote: 0, updates: 0 };
function persist() { localStorage.setItem('paper-ui-state', JSON.stringify(state)); }
function fail() { return { ok: false, code: 'invalid-store', message: 'Evidence file is corrupt. Original file retained; repair before editing.' }; }
function result() { return corrupt ? fail() : { ok: true, revision: state.revision, items: structuredClone(state.evidence) }; }
function matrices() { return corrupt ? fail() : { ok: true, revision: state.revision, matrices: structuredClone(state.matrices) }; }
function check(r) { if (r.expectedRevision !== state.revision)
    throw Error('Conflict: reload saved data'); }
function evidence() { return { id: 'e1', unitDir: 'papers/p1', sourceMarkId: 'mark1', sourceKind: 'highlight', originalQuote: 'We did not improve recall on the held-out split.', anchor: { page: 2, rects: [[0.1, 0.2, 0.7, 0.04]] }, paperVersion: { canonicalId: 'arxiv:2601.00001', arxivVersion: 'v2', citeKey: 'paper1', title: entries[0].meta.title, pdfFile: 'paper.pdf', pdfSha256: HASH, pdfBytes: 1234, capturedAt: NOW }, mechanical: { versionBinding: 'bound', quoteMatch: 'matched', pageCount: 3, textPartial: false, checkedAt: NOW }, interpretation: '', conditions: '', question: '', claimKind: 'author-reported', verification: 'unverified', createdAt: NOW, updatedAt: NOW }; }
Object.assign(window, { kunGui: { platform: 'fixture', paperEvidenceRead: async (r) => { const out = result(); if (out.ok && r.unitDir)
            out.items = out.items.filter(e => e.unitDir === r.unitDir); return out; }, paperMatricesRead: async () => matrices(), paperEvidencePromote: async (r) => { calls.promote++; check(r); if (!state.evidence.length) {
            state.evidence.push(evidence());
            state.revision++;
            persist();
        } return result(); }, paperEvidenceUpdate: async (r) => { check(r); calls.updates++; state.evidence = state.evidence.map(e => e.id === r.evidenceId ? { ...e, ...r.patch, updatedAt: new Date().toISOString() } : e); state.revision++; persist(); return result(); }, paperEvidenceSource: async () => { calls.source++; return { ok: true, status: stale ? 'stale' : 'current', unitDir: 'papers/p1', pdfFile: 'paper.pdf', page: 2, title: entries[0].meta.title, citeKey: 'paper1', expectedSha256: HASH, currentSha256: stale ? 'b'.repeat(64) : HASH, message: stale ? 'PDF changed. The old page anchor was not opened.' : '' }; }, paperMatrixCreate: async (r) => { check(r); state.matrices.push(createPaperComparisonMatrix({ id: 'matrix' + (state.matrices.length + 1), title: r.title, axes: r.axes, rows: entries.filter(e => r.unitDirs.includes(e.unitDir)).map(e => ({ unitDir: e.unitDir, title: e.meta.title, canonicalId: e.meta.arxivId, citeKey: e.meta.citeKey })), now: NOW })); state.revision++; persist(); return matrices(); }, paperMatrixUpdate: async (r) => { check(r); const { addUnitDirs = [], ...patch } = r.patch; state.matrices = state.matrices.map(m => m.id === r.matrixId ? updatePaperComparisonMatrix(m, { ...patch, addRows: entries.filter(e => addUnitDirs.includes(e.unitDir)).map(e => ({ unitDir: e.unitDir, title: e.meta.title, canonicalId: e.meta.arxivId, citeKey: e.meta.citeKey })) }, state.evidence, new Date().toISOString()) : m); state.revision++; persist(); return matrices(); }, paperEvidenceMaterial: async () => ({ ok: true, paperVersion: evidence().paperVersion, sourceText: '<!-- page 1 --> A code-search study. <!-- page 2 --> We did not improve recall on the held-out split.', pageCount: 3, extractedPages: partial ? [1] : [1, 2, 3], missingTextPages: partial ? [2, 3] : [], textPartial: partial, abstractOnly: false, figuresStatus: 'partial', figureConfidence: { high: 1, medium: 0, low: 1 }, figuresVersionBound: false }), paperMarksRead: async () => ({ ok: true, items: [] }), runtimeRequest: async () => { throw Error('Unexpected runtime request in offline UI fixture'); } } });
useWriteWorkspaceStore.setState({ workspaceRoot: '/fixture', openFile: async () => true });
useChatStore.setState({ composerProviderId: 'fixture-provider', composerModel: 'offline-model', ensureWriteThreadForWorkspace: async () => 'paper-thread', sendMessage: async (...args) => { calls.model.push(args); return true; } });
usePaperMarksStore.setState({ unitDir: 'papers/p1', items: [{ id: 'mark1', kind: 'highlight', color: 'yellow', page: 2, rects: [[0.1, 0.2, 0.7, 0.04]], quote: 'We did not improve recall on the held-out split.', pdfSha256: HASH, createdAt: NOW, updatedAt: NOW }], cards: {}, dirty: false });
const root = createRoot(document.getElementById('root'));
function render(next = {}) { ({ view = view, selected = selected, corrupt = corrupt, stale = stale, partial = partial } = next); flushSync(() => root.render(<main style={{ height: '100vh', display: 'flex', minWidth: 0 }}>{view === 'reader' ? <PaperReaderDrawer workspaceRoot="/fixture" unitDir="papers/p1" paperTitle={entries[0].meta.title} pdfFile="paper.pdf" pdfDocument={null} pdfSha256={HASH} onJumpToPage={() => { }} onDeleteMark={() => { }} t={i18n.t.bind(i18n)}/> : view === 'reading' ? <PaperReadingDialog key={'reading-' + partial} request={{ workspaceRoot: '/fixture', unitDir: 'papers/p1', meta: entries[0].meta }} onClose={() => render({ view: 'matrix' })}/> : <PaperMatrixWorkspace key={'matrix-' + corrupt} workspaceRoot="/fixture" selected={selected} onClose={() => render({ view: 'reader' })}/>}</main>)); }
i18n.changeLanguage('en').then(() => { document.documentElement.dataset.theme = 'light'; render(); window.paperFixture = { ready: true, render, calls, entries, state: () => structuredClone(state), setTheme: t => { document.documentElement.dataset.theme = t; }, reset: () => { state = structuredClone(blank); persist(); render(); } }; });
`
}
