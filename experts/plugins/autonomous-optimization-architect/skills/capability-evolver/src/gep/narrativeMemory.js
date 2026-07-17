'use strict';

const fs = require('fs');
const path = require('path');
const { getNarrativePath, getEvolutionDir } = require('./paths');

const MAX_NARRATIVE_ENTRIES = 30;
const MAX_NARRATIVE_SIZE = 12000;

function ensureDir(dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}

function recordNarrative({ gene, signals, mutation, outcome, blast, capsule }) {
  const narrativePath = getNarrativePath();
  ensureDir(path.dirname(narrativePath));

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const geneId = gene && gene.id ? gene.id : '(auto)';
  const category = (mutation && mutation.category) || (gene && gene.category) || 'unknown';
  const status = outcome && outcome.status ? outcome.status : 'unknown';
  const score = outcome && typeof outcome.score === 'number' ? outcome.score.toFixed(2) : '?';
  const signalsSummary = Array.isArray(signals) ? signals.slice(0, 4).join(', ') : '(none)';
  const filesChanged = blast ? blast.files : 0;
  const linesChanged = blast ? blast.lines : 0;
  const rationale = mutation && mutation.rationale
    ? String(mutation.rationale).slice(0, 200) : '';
  const strategy = gene && Array.isArray(gene.strategy)
    ? gene.strategy.slice(0, 3).map((s, i) => `  ${i + 1}. ${s}`).join('\n') : '';
  const capsuleSummary = capsule && capsule.summary ? String(capsule.summary).slice(0, 200) : '';

  const entry = [
    `### [${ts}] ${category.toUpperCase()} - ${status}`,
    `- Gene: ${geneId} | Score: ${score} | Scope: ${filesChanged} files, ${linesChanged} lines`,
    `- Signals: [${signalsSummary}]`,
    rationale ? `- Why: ${rationale}` : null,
    strategy ? `- Strategy:\n${strategy}` : null,
    capsuleSummary ? `- Result: ${capsuleSummary}` : null,
    '',
  ].filter(line => line !== null).join('\n');

  let existing = '';
  try {
    if (fs.existsSync(narrativePath)) {
      existing = fs.readFileSync(narrativePath, 'utf8');
    }
  } catch (_) {}

  if (!existing.trim()) {
    existing = '# Evolution Narrative\n\nA chronological record of evolution decisions and outcomes.\n\n';
  }

  const combined = existing + entry;
  const trimmed = trimNarrative(combined);

  const tmp = narrativePath + '.tmp';
  fs.writeFileSync(tmp, trimmed, 'utf8');
  fs.renameSync(tmp, narrativePath);
}

function trimNarrative(content) {
  if (content.length <= MAX_NARRATIVE_SIZE) return content;

  const headerEnd = content.indexOf('###');
  if (headerEnd < 0) return content.slice(-MAX_NARRATIVE_SIZE);

  const header = content.slice(0, headerEnd);
  const entries = content.slice(headerEnd).split(/(?=^### \[)/m);

  while (entries.length > MAX_NARRATIVE_ENTRIES) {
    entries.shift();
  }

  let result = header + entries.join('');
  if (result.length > MAX_NARRATIVE_SIZE) {
    const keep = Math.max(1, entries.length - 5);
    result = header + entries.slice(-keep).join('');
  }

  return result;
}

function loadNarrativeSummary(maxChars) {
  const limit = Number.isFinite(maxChars) ? maxChars : 4000;
  const narrativePath = getNarrativePath();
  try {
    if (!fs.existsSync(narrativePath)) return '';
    const content = fs.readFileSync(narrativePath, 'utf8');
    if (!content.trim()) return '';

    const headerEnd = content.indexOf('###');
    if (headerEnd < 0) return '';

    const entries = content.slice(headerEnd).split(/(?=^### \[)/m);
    const recent = entries.slice(-8);
    let summary = recent.join('');
    if (summary.length > limit) {
      summary = summary.slice(-limit);
      const firstEntry = summary.indexOf('### [');
      if (firstEntry > 0) summary = summary.slice(firstEntry);
    }
    return summary.trim();
  } catch (_) {
    return '';
  }
}

module.exports = { recordNarrative, loadNarrativeSummary, trimNarrative };
