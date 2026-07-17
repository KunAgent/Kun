const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldSkipHubCalls } = require('../src/evolve');

describe('shouldSkipHubCalls', () => {
  it('returns false when no saturation signals', () => {
    assert.equal(shouldSkipHubCalls(['log_error', 'stable_success_plateau']), false);
  });

  it('returns false for non-array input', () => {
    assert.equal(shouldSkipHubCalls(null), false);
    assert.equal(shouldSkipHubCalls(undefined), false);
    assert.equal(shouldSkipHubCalls('force_steady_state'), false);
  });

  it('returns true when only saturation signals are present', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'evolution_saturation', 'stable_success_plateau',
    ]), true);
  });

  it('returns true for evolution_saturation alone', () => {
    assert.equal(shouldSkipHubCalls(['evolution_saturation']), true);
  });

  it('returns true for empty_cycle_loop_detected + stable_success_plateau', () => {
    assert.equal(shouldSkipHubCalls([
      'empty_cycle_loop_detected', 'stable_success_plateau',
    ]), true);
  });

  it('returns false when log_error coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'evolution_saturation', 'log_error',
    ]), false);
  });

  it('returns false when errsig: coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'errsig:TypeError: foo is not a function',
    ]), false);
  });

  it('returns false when recurring_error coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'recurring_error',
    ]), false);
  });

  it('returns false when external_task coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'evolution_saturation', 'external_task',
    ]), false);
  });

  it('returns false when bounty_task coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'bounty_task',
    ]), false);
  });

  it('returns false when overdue_task coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'overdue_task',
    ]), false);
  });

  it('returns false when urgent coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'urgent',
    ]), false);
  });

  it('returns false when capability_gap coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'capability_gap',
    ]), false);
  });

  it('returns false when perf_bottleneck coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'empty_cycle_loop_detected', 'perf_bottleneck',
    ]), false);
  });

  it('returns false when user_feature_request has content', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'user_feature_request:add dark mode',
    ]), false);
  });

  it('returns true when user_feature_request is empty (no real request)', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'user_feature_request:',
    ]), true);
  });

  it('returns false when user_improvement_suggestion has content', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'user_improvement_suggestion:refactor the API',
    ]), false);
  });

  it('returns true when user_improvement_suggestion is empty', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'user_improvement_suggestion:',
    ]), true);
  });

  it('returns false when unsupported_input_type coexists with saturation', () => {
    assert.equal(shouldSkipHubCalls([
      'force_steady_state', 'unsupported_input_type',
    ]), false);
  });

  it('returns true for typical idle scenario from user report', () => {
    assert.equal(shouldSkipHubCalls([
      'evolution_saturation', 'force_steady_state',
      'empty_cycle_loop_detected', 'stable_success_plateau',
    ]), true);
  });

  it('returns false for empty signals array (no saturation indicator)', () => {
    assert.equal(shouldSkipHubCalls([]), false);
  });

  it('returns false when only stable_success_plateau without saturation indicators', () => {
    assert.equal(shouldSkipHubCalls(['stable_success_plateau']), false);
  });
});
