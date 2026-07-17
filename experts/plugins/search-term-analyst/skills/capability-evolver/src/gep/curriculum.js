'use strict';

const fs = require('fs');
const path = require('path');
const { getEvolutionDir, getMemoryDir } = require('./paths');

var MASTERY_THRESHOLD = 0.8;
var MASTERY_MIN_ATTEMPTS = 3;
var FAILURE_THRESHOLD = 0.3;
var MAX_CURRICULUM_SIGNALS = 2;

function curriculumStatePath() {
  return path.join(getEvolutionDir(), 'curriculum_state.json');
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    var raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, obj) {
  try {
    var dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (_) {}
}

function loadCurriculumState() {
  return readJsonSafe(curriculumStatePath(), {
    level: 1,
    current_targets: [],
    completed: [],
    updated_at: null,
  });
}

function saveCurriculumState(state) {
  state.updated_at = new Date().toISOString();
  writeJsonAtomic(curriculumStatePath(), state);
}

function aggregateOutcomes(memoryGraphPath) {
  var outcomes = {};
  try {
    if (!fs.existsSync(memoryGraphPath)) return outcomes;
    var lines = fs.readFileSync(memoryGraphPath, 'utf8').trim().split('\n').filter(Boolean);
    var recent = lines.slice(-200);
    for (var i = 0; i < recent.length; i++) {
      try {
        var ev = JSON.parse(recent[i]);
        if (ev.kind !== 'outcome' || !ev.outcome) continue;
        var key = ev.signal_key || ev.key || '';
        if (!key) continue;
        if (!outcomes[key]) outcomes[key] = { success: 0, fail: 0, total: 0 };
        if (ev.outcome.status === 'success') outcomes[key].success++;
        else if (ev.outcome.status === 'failed') outcomes[key].fail++;
        outcomes[key].total++;
      } catch (_) {}
    }
  } catch (_) {}
  return outcomes;
}

function identifyFrontier(outcomes) {
  var mastered = [];
  var failing = [];
  var frontier = [];

  var keys = Object.keys(outcomes);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var o = outcomes[k];
    if (o.total < 2) continue;
    var rate = o.success / o.total;
    if (rate >= MASTERY_THRESHOLD && o.total >= MASTERY_MIN_ATTEMPTS) {
      mastered.push({ key: k, rate: rate, total: o.total });
    } else if (rate <= FAILURE_THRESHOLD && o.total >= 2) {
      failing.push({ key: k, rate: rate, total: o.total });
    } else {
      frontier.push({ key: k, rate: rate, total: o.total });
    }
  }

  frontier.sort(function (a, b) {
    return Math.abs(a.rate - 0.5) - Math.abs(b.rate - 0.5);
  });

  return { mastered: mastered, failing: failing, frontier: frontier };
}

function generateCurriculumSignals(opts) {
  var capabilityGaps = Array.isArray(opts.capabilityGaps) ? opts.capabilityGaps : [];
  var memoryGraphPath = opts.memoryGraphPath || '';
  var personality = opts.personality || {};

  var signals = [];

  try {
    var outcomes = aggregateOutcomes(memoryGraphPath);
    var analysis = identifyFrontier(outcomes);
    var state = loadCurriculumState();

    if (capabilityGaps.length > 0) {
      var gapTarget = capabilityGaps[0];
      var alreadyMastered = analysis.mastered.some(function (m) {
        return m.key.indexOf(gapTarget) >= 0;
      });
      if (!alreadyMastered) {
        signals.push('curriculum_target:gap:' + String(gapTarget).slice(0, 60));
      }
    }

    if (signals.length < MAX_CURRICULUM_SIGNALS && analysis.frontier.length > 0) {
      var best = analysis.frontier[0];
      var alreadyTargeted = signals.some(function (s) { return s.indexOf(best.key) >= 0; });
      if (!alreadyTargeted) {
        signals.push('curriculum_target:frontier:' + String(best.key).slice(0, 60));
      }
    }

    if (signals.length > 0) {
      state.current_targets = signals.slice();
      state.level = Math.max(1, Math.min(5, state.level));
      saveCurriculumState(state);
    }
  } catch (_) {}

  return signals.slice(0, MAX_CURRICULUM_SIGNALS);
}

function markCurriculumProgress(signal, outcome) {
  try {
    var state = loadCurriculumState();
    if (!Array.isArray(state.completed)) state.completed = [];
    state.completed.push({
      signal: String(signal).slice(0, 100),
      outcome: String(outcome).slice(0, 20),
      at: new Date().toISOString(),
    });
    if (state.completed.length > 50) state.completed = state.completed.slice(-50);

    var successCount = state.completed.filter(function (c) { return c.outcome === 'success'; }).length;
    if (successCount > 0 && successCount % 5 === 0 && state.level < 5) {
      state.level++;
    }
    saveCurriculumState(state);
  } catch (_) {}
}

module.exports = {
  generateCurriculumSignals: generateCurriculumSignals,
  markCurriculumProgress: markCurriculumProgress,
  loadCurriculumState: loadCurriculumState,
};
