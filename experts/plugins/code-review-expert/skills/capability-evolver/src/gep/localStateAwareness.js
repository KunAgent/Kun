'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getRepoRoot, getWorkspaceRoot, getMemoryDir, getEvolutionDir, getSkillsDir } = require('./paths');

const NODE_ID_DIR = path.join(os.homedir(), '.evomap');
const NODE_ID_FILE = path.join(NODE_ID_DIR, 'node_id');
const NODE_SECRET_FILE = path.join(NODE_ID_DIR, 'node_secret');

const A2A_ENV_KEYS = [
  'A2A_NODE_ID',
  'A2A_HUB_URL',
  'A2A_NODE_SECRET',
  'AGENT_NAME',
  'EVOLVE_STRATEGY',
  'WORKER_ENABLED',
  'EVOLVER_SESSION_SCOPE',
  'GITHUB_TOKEN',
];

function _readFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (_) {
    return null;
  }
}

function _readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function _fileExists(filePath) {
  try { return fs.existsSync(filePath); } catch (_) { return false; }
}

function _fileSize(filePath) {
  try { return fs.statSync(filePath).size; } catch (_) { return 0; }
}

function _countDirs(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory(); }).length;
  } catch (_) {
    return 0;
  }
}

function captureNodeIdentity() {
  const lines = [];

  const nodeId = process.env.A2A_NODE_ID || _readFileSafe(NODE_ID_FILE);
  if (nodeId) {
    lines.push('- Node ID: ' + nodeId + ' (REGISTERED -- do NOT re-register)');
  } else {
    lines.push('- Node ID: NOT SET (registration may be needed)');
  }

  const localNodeIdFile = path.join(getRepoRoot(), '.evomap_node_id');
  if (!nodeId && _fileExists(localNodeIdFile)) {
    const localId = _readFileSafe(localNodeIdFile);
    if (localId) {
      lines.push('- Local node_id fallback: ' + localId + ' (found at ' + localNodeIdFile + ')');
    }
  }

  const hasSecret = !!process.env.A2A_NODE_SECRET || _fileExists(NODE_SECRET_FILE);
  if (hasSecret) {
    lines.push('- Node Secret: PRESENT (authenticated -- do NOT request new secret)');
  } else {
    lines.push('- Node Secret: MISSING (hello handshake may be needed)');
  }

  return lines;
}

function captureEnvConfig() {
  const lines = [];
  const configured = [];
  const missing = [];

  for (var i = 0; i < A2A_ENV_KEYS.length; i++) {
    var key = A2A_ENV_KEYS[i];
    var val = process.env[key];
    if (val !== undefined && val !== '') {
      configured.push(key);
    } else {
      missing.push(key);
    }
  }

  if (configured.length > 0) {
    lines.push('- Env configured: ' + configured.join(', '));
  }
  if (missing.length > 0) {
    lines.push('- Env not set: ' + missing.join(', '));
  }

  const repoRoot = getRepoRoot();
  const envFile = path.join(repoRoot, '.env');
  if (_fileExists(envFile)) {
    lines.push('- .env file: EXISTS at ' + envFile);
  } else {
    lines.push('- .env file: MISSING at ' + envFile);
  }

  return lines;
}

function captureEvolutionState() {
  const lines = [];
  const evoDir = getEvolutionDir();

  const statePath = path.join(evoDir, 'evolution_state.json');
  const state = _readJsonSafe(statePath);
  if (state) {
    lines.push('- Evolution cycles completed: ' + (state.cycleCount || 0));
    if (state.lastRun) {
      var ago = Math.round((Date.now() - state.lastRun) / 1000);
      lines.push('- Last evolution run: ' + ago + 's ago');
    }
  } else {
    lines.push('- Evolution state: NOT FOUND (first run?)');
  }

  const solidifyPath = path.join(evoDir, 'evolution_solidify_state.json');
  const solidifyState = _readJsonSafe(solidifyPath);
  if (solidifyState && solidifyState.last_run) {
    var lr = solidifyState.last_run;
    lines.push('- Last run gene: ' + (lr.selected_gene_id || 'none'));
    if (lr.active_task_title) {
      lines.push('- Active task: ' + lr.active_task_title);
    }
  }

  const personalityPath = path.join(evoDir, 'personality_state.json');
  const personality = _readJsonSafe(personalityPath);
  if (personality && personality.current) {
    var p = personality.current;
    lines.push('- Personality: rigor=' + (p.rigor || 0) +
      ' creativity=' + (p.creativity || 0) +
      ' risk_tolerance=' + (p.risk_tolerance || 0));
  }

  return lines;
}

function captureMemoryState() {
  const lines = [];
  const memDir = getMemoryDir();

  if (_fileExists(memDir)) {
    lines.push('- Memory directory: EXISTS at ' + memDir);
  } else {
    lines.push('- Memory directory: MISSING');
    return lines;
  }

  const memoryMd = path.join(memDir, 'MEMORY.md');
  if (_fileExists(memoryMd)) {
    lines.push('- MEMORY.md: ' + _fileSize(memoryMd) + ' bytes');
  }

  const evoDir = getEvolutionDir();
  const graphPath = path.join(evoDir, 'memory_graph.jsonl');
  if (_fileExists(graphPath)) {
    lines.push('- Memory graph: ' + _fileSize(graphPath) + ' bytes');
  }

  const narrativePath = path.join(evoDir, 'evolution_narrative.md');
  if (_fileExists(narrativePath)) {
    lines.push('- Evolution narrative: EXISTS');
  }

  return lines;
}

function captureSkillsState() {
  const lines = [];
  const skillsDir = getSkillsDir();

  if (_fileExists(skillsDir)) {
    var count = _countDirs(skillsDir);
    lines.push('- Installed skills: ' + count + ' (at ' + skillsDir + ')');
  } else {
    lines.push('- Skills directory: NOT FOUND');
  }

  return lines;
}

function captureLocalState() {
  var sections = [];

  sections.push('[Node Identity]');
  sections = sections.concat(captureNodeIdentity());

  sections.push('[Environment Config]');
  sections = sections.concat(captureEnvConfig());

  sections.push('[Evolution State]');
  sections = sections.concat(captureEvolutionState());

  sections.push('[Memory & Knowledge]');
  sections = sections.concat(captureMemoryState());

  sections.push('[Skills]');
  sections = sections.concat(captureSkillsState());

  return sections.join('\n');
}

function captureLocalStatePaths() {
  return {
    nodeIdFile: NODE_ID_FILE,
    nodeSecretFile: NODE_SECRET_FILE,
    envFile: path.join(getRepoRoot(), '.env'),
    memoryDir: getMemoryDir(),
    evolutionDir: getEvolutionDir(),
    skillsDir: getSkillsDir(),
  };
}

module.exports = {
  captureLocalState,
  captureLocalStatePaths,
  captureNodeIdentity,
  captureEnvConfig,
  captureEvolutionState,
  captureMemoryState,
  captureSkillsState,
};
