const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { resolveStrategy, getStrategyNames, STRATEGIES } = require('../src/gep/strategy');

describe('STRATEGIES', function () {
  it('defines all expected presets', function () {
    const names = getStrategyNames();
    assert.ok(names.includes('balanced'));
    assert.ok(names.includes('innovate'));
    assert.ok(names.includes('harden'));
    assert.ok(names.includes('repair-only'));
    assert.ok(names.includes('early-stabilize'));
    assert.ok(names.includes('steady-state'));
  });

  it('all strategies have required fields', function () {
    for (const [name, s] of Object.entries(STRATEGIES)) {
      assert.equal(typeof s.repair, 'number', `${name}.repair`);
      assert.equal(typeof s.optimize, 'number', `${name}.optimize`);
      assert.equal(typeof s.innovate, 'number', `${name}.innovate`);
      assert.equal(typeof s.repairLoopThreshold, 'number', `${name}.repairLoopThreshold`);
      assert.equal(typeof s.label, 'string', `${name}.label`);
      assert.equal(typeof s.description, 'string', `${name}.description`);
    }
  });

  it('all strategy ratios sum to approximately 1.0', function () {
    for (const [name, s] of Object.entries(STRATEGIES)) {
      const sum = s.repair + s.optimize + s.innovate;
      assert.ok(Math.abs(sum - 1.0) < 0.01, `${name} ratios sum to ${sum}`);
    }
  });
});

describe('resolveStrategy', function () {
  let origStrategy;
  let origForceInnovation;
  let origEvolveForceInnovation;

  beforeEach(function () {
    origStrategy = process.env.EVOLVE_STRATEGY;
    origForceInnovation = process.env.FORCE_INNOVATION;
    origEvolveForceInnovation = process.env.EVOLVE_FORCE_INNOVATION;
    delete process.env.EVOLVE_STRATEGY;
    delete process.env.FORCE_INNOVATION;
    delete process.env.EVOLVE_FORCE_INNOVATION;
  });

  afterEach(function () {
    if (origStrategy !== undefined) process.env.EVOLVE_STRATEGY = origStrategy;
    else delete process.env.EVOLVE_STRATEGY;
    if (origForceInnovation !== undefined) process.env.FORCE_INNOVATION = origForceInnovation;
    else delete process.env.FORCE_INNOVATION;
    if (origEvolveForceInnovation !== undefined) process.env.EVOLVE_FORCE_INNOVATION = origEvolveForceInnovation;
    else delete process.env.EVOLVE_FORCE_INNOVATION;
  });

  it('defaults to balanced when no env var set', function () {
    const s = resolveStrategy({});
    assert.ok(['balanced', 'early-stabilize'].includes(s.name));
  });

  it('respects explicit EVOLVE_STRATEGY', function () {
    process.env.EVOLVE_STRATEGY = 'harden';
    const s = resolveStrategy({});
    assert.equal(s.name, 'harden');
    assert.equal(s.label, 'Hardening');
  });

  it('respects innovate strategy', function () {
    process.env.EVOLVE_STRATEGY = 'innovate';
    const s = resolveStrategy({});
    assert.equal(s.name, 'innovate');
    assert.ok(s.innovate >= 0.8);
  });

  it('respects repair-only strategy', function () {
    process.env.EVOLVE_STRATEGY = 'repair-only';
    const s = resolveStrategy({});
    assert.equal(s.name, 'repair-only');
    assert.equal(s.innovate, 0);
  });

  it('FORCE_INNOVATION=true maps to innovate', function () {
    process.env.FORCE_INNOVATION = 'true';
    const s = resolveStrategy({});
    assert.equal(s.name, 'innovate');
  });

  it('EVOLVE_FORCE_INNOVATION=true maps to innovate', function () {
    process.env.EVOLVE_FORCE_INNOVATION = 'true';
    const s = resolveStrategy({});
    assert.equal(s.name, 'innovate');
  });

  it('explicit EVOLVE_STRATEGY takes precedence over FORCE_INNOVATION', function () {
    process.env.EVOLVE_STRATEGY = 'harden';
    process.env.FORCE_INNOVATION = 'true';
    const s = resolveStrategy({});
    assert.equal(s.name, 'harden');
  });

  it('saturation signal triggers steady-state', function () {
    const s = resolveStrategy({ signals: ['evolution_saturation'] });
    assert.equal(s.name, 'steady-state');
  });

  it('force_steady_state signal triggers steady-state', function () {
    const s = resolveStrategy({ signals: ['force_steady_state'] });
    assert.equal(s.name, 'steady-state');
  });

  it('falls back to balanced for unknown strategy name', function () {
    process.env.EVOLVE_STRATEGY = 'nonexistent';
    const s = resolveStrategy({});
    const fallback = STRATEGIES['balanced'];
    assert.equal(s.repair, fallback.repair);
    assert.equal(s.optimize, fallback.optimize);
    assert.equal(s.innovate, fallback.innovate);
  });

  it('auto maps to balanced or heuristic', function () {
    process.env.EVOLVE_STRATEGY = 'auto';
    const s = resolveStrategy({});
    assert.ok(['balanced', 'early-stabilize'].includes(s.name));
  });

  it('returned strategy has name property', function () {
    process.env.EVOLVE_STRATEGY = 'harden';
    const s = resolveStrategy({});
    assert.equal(s.name, 'harden');
  });
});
