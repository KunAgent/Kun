const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

let tmpDir;
const savedEnv = {};
const envKeys = ['EVOLVER_REPO_ROOT', 'OPENCLAW_WORKSPACE', 'GEP_ASSETS_DIR', 'MEMORY_DIR', 'EVOLUTION_DIR', 'EVOLVER_SESSION_SCOPE'];

function setupTempEnv() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assetstore-test-'));
  for (const k of envKeys) { savedEnv[k] = process.env[k]; }
  const assetsDir = path.join(tmpDir, 'assets', 'gep');
  fs.mkdirSync(assetsDir, { recursive: true });
  process.env.EVOLVER_REPO_ROOT = tmpDir;
  process.env.GEP_ASSETS_DIR = assetsDir;
  process.env.OPENCLAW_WORKSPACE = tmpDir;
  delete process.env.EVOLVER_SESSION_SCOPE;
}

function teardownTempEnv() {
  for (const k of envKeys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function freshRequire() {
  const modPath = require.resolve('../src/gep/assetStore');
  const pathsPath = require.resolve('../src/gep/paths');
  delete require.cache[modPath];
  delete require.cache[pathsPath];
  return require(modPath);
}

function writeJsonl(filePath, objects) {
  fs.writeFileSync(filePath, objects.map(o => JSON.stringify(o)).join('\n') + '\n', 'utf8');
}

describe('readRecentCandidates', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('returns empty array when file does not exist', () => {
    const { readRecentCandidates } = freshRequire();
    assert.deepEqual(readRecentCandidates(), []);
  });

  it('returns empty array for empty file', () => {
    const { candidatesPath, readRecentCandidates } = freshRequire();
    fs.writeFileSync(candidatesPath(), '', 'utf8');
    assert.deepEqual(readRecentCandidates(), []);
  });

  it('reads and parses JSONL entries', () => {
    const { candidatesPath, readRecentCandidates } = freshRequire();
    const items = [
      { type: 'Candidate', id: 'c1', score: 0.8 },
      { type: 'Candidate', id: 'c2', score: 0.9 },
    ];
    writeJsonl(candidatesPath(), items);
    const result = readRecentCandidates(10);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'c1');
    assert.equal(result[1].id, 'c2');
  });

  it('respects limit parameter (returns last N)', () => {
    const { candidatesPath, readRecentCandidates } = freshRequire();
    const items = [];
    for (let i = 0; i < 10; i++) {
      items.push({ type: 'Candidate', id: 'c' + i });
    }
    writeJsonl(candidatesPath(), items);
    const result = readRecentCandidates(3);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'c7');
    assert.equal(result[1].id, 'c8');
    assert.equal(result[2].id, 'c9');
  });

  it('skips malformed JSON lines gracefully', () => {
    const { candidatesPath, readRecentCandidates } = freshRequire();
    const content = '{"id":"c1"}\n{BROKEN\n{"id":"c2"}\n';
    fs.writeFileSync(candidatesPath(), content, 'utf8');
    const result = readRecentCandidates(10);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'c1');
    assert.equal(result[1].id, 'c2');
  });

  it('handles large file (>1MB) by reading tail only', () => {
    const { candidatesPath, readRecentCandidates } = freshRequire();
    const p = candidatesPath();
    const padding = '{"type":"pad","data":"' + 'x'.repeat(500) + '"}\n';
    const padCount = Math.ceil((1024 * 1024 + 100) / padding.length);
    let content = '';
    for (let i = 0; i < padCount; i++) content += padding;
    content += '{"type":"tail","id":"last1"}\n';
    content += '{"type":"tail","id":"last2"}\n';
    fs.writeFileSync(p, content, 'utf8');
    const stat = fs.statSync(p);
    assert.ok(stat.size > 1024 * 1024, 'file should be >1MB for large file path');
    const result = readRecentCandidates(2);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'last1');
    assert.equal(result[1].id, 'last2');
  });
});

describe('appendCandidateJsonl + readRecentCandidates roundtrip', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('appends and reads back candidates', () => {
    const { appendCandidateJsonl, readRecentCandidates } = freshRequire();
    appendCandidateJsonl({ type: 'Candidate', id: 'rt1', score: 0.5 });
    appendCandidateJsonl({ type: 'Candidate', id: 'rt2', score: 0.7 });
    const result = readRecentCandidates(10);
    assert.equal(result.length, 2);
    assert.equal(result[0].id, 'rt1');
    assert.equal(result[1].id, 'rt2');
  });
});

describe('loadGenes', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('returns default genes when no files exist', () => {
    const { ensureAssetFiles, loadGenes } = freshRequire();
    ensureAssetFiles();
    const genes = loadGenes();
    assert.ok(Array.isArray(genes));
    assert.ok(genes.length >= 2, 'should have at least 2 default genes');
    assert.ok(genes.every(g => g.type === 'Gene'));
  });

  it('deduplicates genes by id (jsonl overrides json)', () => {
    const { genesPath, loadGenes } = freshRequire();
    const jsonContent = {
      version: 1,
      genes: [{ type: 'Gene', id: 'gene_a', category: 'repair', signals_match: ['error'] }],
    };
    fs.writeFileSync(genesPath(), JSON.stringify(jsonContent), 'utf8');
    const jsonlPath = path.join(path.dirname(genesPath()), 'genes.jsonl');
    fs.writeFileSync(jsonlPath, JSON.stringify({ type: 'Gene', id: 'gene_a', category: 'optimize', signals_match: ['perf'] }) + '\n', 'utf8');
    const genes = loadGenes();
    const geneA = genes.find(g => g.id === 'gene_a');
    assert.ok(geneA);
    assert.equal(geneA.category, 'optimize');
  });
});

describe('readAllEvents', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('returns empty array when file does not exist', () => {
    const { readAllEvents } = freshRequire();
    assert.deepEqual(readAllEvents(), []);
  });

  it('parses JSONL events and skips malformed lines', () => {
    const { eventsPath, readAllEvents } = freshRequire();
    const content = [
      JSON.stringify({ type: 'EvolutionEvent', id: 'evt_1', intent: 'repair' }),
      'NOT_JSON',
      JSON.stringify({ type: 'EvolutionEvent', id: 'evt_2', intent: 'innovate' }),
    ].join('\n') + '\n';
    fs.writeFileSync(eventsPath(), content, 'utf8');
    const events = readAllEvents();
    assert.equal(events.length, 2);
    assert.equal(events[0].id, 'evt_1');
    assert.equal(events[1].id, 'evt_2');
  });
});

describe('getLastEventId', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('returns null when no events file', () => {
    const { getLastEventId } = freshRequire();
    assert.equal(getLastEventId(), null);
  });

  it('returns id of the last event', () => {
    const { eventsPath, getLastEventId } = freshRequire();
    writeJsonl(eventsPath(), [
      { type: 'EvolutionEvent', id: 'evt_first' },
      { type: 'EvolutionEvent', id: 'evt_last' },
    ]);
    assert.equal(getLastEventId(), 'evt_last');
  });
});

describe('readRecentFailedCapsules', () => {
  beforeEach(setupTempEnv);
  afterEach(teardownTempEnv);

  it('returns empty array when file does not exist', () => {
    const { readRecentFailedCapsules } = freshRequire();
    assert.deepEqual(readRecentFailedCapsules(), []);
  });

  it('respects limit parameter', () => {
    const { failedCapsulesPath, readRecentFailedCapsules } = freshRequire();
    const list = [];
    for (let i = 0; i < 10; i++) list.push({ type: 'Capsule', id: 'fc' + i, outcome: { status: 'failed' } });
    fs.writeFileSync(failedCapsulesPath(), JSON.stringify({ version: 1, failed_capsules: list }), 'utf8');
    const result = readRecentFailedCapsules(3);
    assert.equal(result.length, 3);
    assert.equal(result[0].id, 'fc7');
  });
});
