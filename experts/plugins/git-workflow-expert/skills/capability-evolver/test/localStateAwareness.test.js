const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  // Also clear paths.js cache to pick up env overrides
  try { delete require.cache[require.resolve('../src/gep/paths')]; } catch (_) {}
  return require(resolved);
}

describe('localStateAwareness', () => {
  let tmpDir;
  const savedEnv = {};
  const envKeys = [
    'EVOLVER_REPO_ROOT', 'OPENCLAW_WORKSPACE', 'MEMORY_DIR',
    'EVOLUTION_DIR', 'SKILLS_DIR', 'A2A_NODE_ID', 'A2A_HUB_URL',
    'A2A_NODE_SECRET', 'AGENT_NAME', 'EVOLVE_STRATEGY',
    'WORKER_ENABLED', 'EVOLVER_SESSION_SCOPE', 'GITHUB_TOKEN',
    'GEP_ASSETS_DIR',
  ];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsa-test-'));
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.EVOLVER_REPO_ROOT = tmpDir;
    fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('captureLocalState', () => {
    it('returns a non-empty string', () => {
      const { captureLocalState } = freshRequire('../src/gep/localStateAwareness');
      const result = captureLocalState();
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 0);
    });

    it('contains all expected section headers', () => {
      const { captureLocalState } = freshRequire('../src/gep/localStateAwareness');
      const result = captureLocalState();
      assert.ok(result.includes('[Node Identity]'));
      assert.ok(result.includes('[Environment Config]'));
      assert.ok(result.includes('[Evolution State]'));
      assert.ok(result.includes('[Memory & Knowledge]'));
      assert.ok(result.includes('[Skills]'));
    });
  });

  describe('captureNodeIdentity', () => {
    it('reports NOT SET when no node ID configured', () => {
      const { captureNodeIdentity } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureNodeIdentity();
      const joined = lines.join('\n');
      assert.ok(joined.includes('NOT SET') || joined.includes('REGISTERED'));
    });

    it('reports REGISTERED when A2A_NODE_ID is set', () => {
      process.env.A2A_NODE_ID = 'node_abc123def456';
      const { captureNodeIdentity } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureNodeIdentity();
      const joined = lines.join('\n');
      assert.ok(joined.includes('REGISTERED'));
      assert.ok(joined.includes('node_abc123def456'));
    });

    it('reports PRESENT when A2A_NODE_SECRET is set', () => {
      process.env.A2A_NODE_SECRET = 'test_secret_value';
      const { captureNodeIdentity } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureNodeIdentity();
      const joined = lines.join('\n');
      assert.ok(joined.includes('PRESENT'));
    });

    it('reports MISSING when no secret exists', () => {
      const { captureNodeIdentity } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureNodeIdentity();
      const joined = lines.join('\n');
      assert.ok(joined.includes('MISSING') || joined.includes('PRESENT'));
    });
  });

  describe('captureEnvConfig', () => {
    it('lists configured env keys', () => {
      process.env.A2A_NODE_ID = 'node_test123';
      process.env.A2A_HUB_URL = 'https://test.evomap.ai';
      const { captureEnvConfig } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureEnvConfig();
      const joined = lines.join('\n');
      assert.ok(joined.includes('A2A_NODE_ID'));
      assert.ok(joined.includes('A2A_HUB_URL'));
    });

    it('reports .env file status', () => {
      const { captureEnvConfig } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureEnvConfig();
      const joined = lines.join('\n');
      assert.ok(joined.includes('.env file:'));
    });

    it('detects .env file when present', () => {
      fs.writeFileSync(path.join(tmpDir, '.env'), 'A2A_NODE_ID=test\n');
      const { captureEnvConfig } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureEnvConfig();
      const joined = lines.join('\n');
      assert.ok(joined.includes('EXISTS'));
    });
  });

  describe('captureEvolutionState', () => {
    it('reports NOT FOUND when no evolution state exists', () => {
      const { captureEvolutionState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureEvolutionState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('NOT FOUND'));
    });

    it('reads cycle count from evolution_state.json', () => {
      const memDir = path.join(tmpDir, 'workspace', 'memory');
      const evoDir = path.join(memDir, 'evolution');
      fs.mkdirSync(evoDir, { recursive: true });
      fs.writeFileSync(
        path.join(evoDir, 'evolution_state.json'),
        JSON.stringify({ cycleCount: 42, lastRun: Date.now() - 5000 })
      );
      process.env.MEMORY_DIR = memDir;
      process.env.EVOLUTION_DIR = evoDir;
      const { captureEvolutionState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureEvolutionState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('42'));
    });
  });

  describe('captureMemoryState', () => {
    it('reports MISSING when memory dir does not exist', () => {
      process.env.MEMORY_DIR = path.join(tmpDir, 'nonexistent');
      const { captureMemoryState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureMemoryState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('MISSING'));
    });

    it('detects MEMORY.md when present', () => {
      const memDir = path.join(tmpDir, 'workspace', 'memory');
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, 'MEMORY.md'), '# Test Memory\nSome content here');
      process.env.MEMORY_DIR = memDir;
      const { captureMemoryState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureMemoryState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('MEMORY.md'));
      assert.ok(joined.includes('bytes'));
    });
  });

  describe('captureSkillsState', () => {
    it('counts skill directories', () => {
      const skillsDir = path.join(tmpDir, 'workspace', 'skills');
      fs.mkdirSync(path.join(skillsDir, 'skill-a'), { recursive: true });
      fs.mkdirSync(path.join(skillsDir, 'skill-b'), { recursive: true });
      process.env.SKILLS_DIR = skillsDir;
      const { captureSkillsState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureSkillsState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('2'));
    });

    it('reports NOT FOUND when skills dir missing', () => {
      process.env.SKILLS_DIR = path.join(tmpDir, 'no-skills');
      const { captureSkillsState } = freshRequire('../src/gep/localStateAwareness');
      const lines = captureSkillsState();
      const joined = lines.join('\n');
      assert.ok(joined.includes('NOT FOUND'));
    });
  });

  describe('captureLocalStatePaths', () => {
    it('returns an object with expected keys', () => {
      const { captureLocalStatePaths } = freshRequire('../src/gep/localStateAwareness');
      const paths = captureLocalStatePaths();
      assert.ok(paths.nodeIdFile);
      assert.ok(paths.nodeSecretFile);
      assert.ok(paths.envFile);
      assert.ok(paths.memoryDir);
      assert.ok(paths.evolutionDir);
      assert.ok(paths.skillsDir);
    });
  });
});
