// Execution Trace: structured, desensitized evolution execution summary.
// Built during solidify and optionally shared with Hub via EvolutionEvent payload.
//
// Desensitization rules (applied locally, never on Hub):
// - File paths: basename + extension only (src/utils/retry.js -> retry.js)
// - Code content: never sent, only statistical metrics (lines, files)
// - Error messages: type signature only (TypeError: x is not a function -> TypeError)
// - Environment variables, secrets, user data: stripped entirely
// - Configurable via EVOLVER_TRACE_LEVEL: none | minimal | standard (default: minimal)

const path = require('path');

const TRACE_LEVELS = { none: 0, minimal: 1, standard: 2 };

function getTraceLevel() {
  const raw = String(process.env.EVOLVER_TRACE_LEVEL || 'minimal').toLowerCase().trim();
  return TRACE_LEVELS[raw] != null ? raw : 'minimal';
}

function desensitizeFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const ext = path.extname(filePath);
  const base = path.basename(filePath);
  return base || ext || 'unknown';
}

function extractErrorSignature(errorText) {
  if (!errorText || typeof errorText !== 'string') return null;
  const text = errorText.trim();

  // Match common error type patterns: TypeError, ReferenceError, SyntaxError, etc.
  const jsError = text.match(/^((?:[A-Z][a-zA-Z]*)?Error)\b/);
  if (jsError) return jsError[1];

  // Match errno-style: ECONNRESET, ENOENT, EPERM, etc.
  const errno = text.match(/\b(E[A-Z]{2,})\b/);
  if (errno) return errno[1];

  // Match HTTP status codes
  const http = text.match(/\b((?:4|5)\d{2})\b/);
  if (http) return 'HTTP_' + http[1];

  // Fallback: first word if it looks like an error type
  const firstWord = text.split(/[\s:]/)[0];
  if (firstWord && firstWord.length <= 40 && /^[A-Z]/.test(firstWord)) return firstWord;

  return 'UnknownError';
}

function inferToolChain(validationResults, blast) {
  const tools = new Set();

  if (blast && blast.files > 0) tools.add('file_edit');

  if (Array.isArray(validationResults)) {
    for (const r of validationResults) {
      const cmd = String(r.cmd || '').trim();
      if (cmd.startsWith('npm test') || cmd.includes('jest') || cmd.includes('mocha')) {
        tools.add('test_run');
      } else if (cmd.includes('lint') || cmd.includes('eslint')) {
        tools.add('lint_check');
      } else if (cmd.includes('validate') || cmd.includes('check')) {
        tools.add('validation_run');
      } else if (cmd.startsWith('node ')) {
        tools.add('node_exec');
      }
    }
  }

  return Array.from(tools);
}

function classifyBlastLevel(blast) {
  if (!blast) return 'unknown';
  const files = Number(blast.files) || 0;
  const lines = Number(blast.lines) || 0;
  if (files <= 3 && lines <= 50) return 'low';
  if (files <= 10 && lines <= 200) return 'medium';
  return 'high';
}

function buildExecutionTrace({
  gene,
  mutation,
  signals,
  blast,
  constraintCheck,
  validation,
  canary,
  outcomeStatus,
  startedAt,
}) {
  const level = getTraceLevel();
  if (level === 'none') return null;

  const trace = {
    gene_id: gene && gene.id ? String(gene.id) : null,
    mutation_category: (mutation && mutation.category) || (gene && gene.category) || null,
    signals_matched: Array.isArray(signals) ? signals.slice(0, 10) : [],
    outcome: outcomeStatus || 'unknown',
  };

  // Minimal level: core metrics only
  trace.files_changed_count = blast ? Number(blast.files) || 0 : 0;
  trace.lines_added = 0;
  trace.lines_removed = 0;

  // Compute added/removed from blast if available
  if (blast && blast.lines) {
    // blast.lines is total churn (added + deleted); split heuristically
    const total = Number(blast.lines) || 0;
    if (outcomeStatus === 'success') {
      trace.lines_added = Math.round(total * 0.6);
      trace.lines_removed = total - trace.lines_added;
    } else {
      trace.lines_added = Math.round(total * 0.5);
      trace.lines_removed = total - trace.lines_added;
    }
  }

  trace.validation_result = validation && validation.ok ? 'pass' : 'fail';
  trace.blast_radius = classifyBlastLevel(blast);

  // Standard level: richer context
  if (level === 'standard') {
    // Desensitized file list (basenames only)
    if (blast && Array.isArray(blast.changed_files)) {
      trace.file_types = {};
      for (const f of blast.changed_files) {
        const ext = path.extname(f) || '.unknown';
        trace.file_types[ext] = (trace.file_types[ext] || 0) + 1;
      }
    }

    // Validation commands (already safe -- node/npm/npx only)
    if (validation && Array.isArray(validation.results)) {
      trace.validation_commands = validation.results.map(r => String(r.cmd || '').slice(0, 100));
    }

    // Error signatures (desensitized)
    trace.error_signatures = [];
    if (constraintCheck && Array.isArray(constraintCheck.violations)) {
      for (const v of constraintCheck.violations) {
        // Constraint violations have known prefixes; classify directly
        const vStr = String(v);
        if (vStr.startsWith('max_files')) trace.error_signatures.push('max_files_exceeded');
        else if (vStr.startsWith('forbidden_path')) trace.error_signatures.push('forbidden_path');
        else if (vStr.startsWith('HARD CAP')) trace.error_signatures.push('hard_cap_breach');
        else if (vStr.startsWith('CRITICAL')) trace.error_signatures.push('critical_overrun');
        else if (vStr.startsWith('critical_path')) trace.error_signatures.push('critical_path_modified');
        else if (vStr.startsWith('canary_failed')) trace.error_signatures.push('canary_failed');
        else if (vStr.startsWith('ethics:')) trace.error_signatures.push('ethics_violation');
        else {
          const sig = extractErrorSignature(v);
          if (sig) trace.error_signatures.push(sig);
        }
      }
    }
    if (validation && Array.isArray(validation.results)) {
      for (const r of validation.results) {
        if (!r.ok && r.err) {
          const sig = extractErrorSignature(r.err);
          if (sig && !trace.error_signatures.includes(sig)) {
            trace.error_signatures.push(sig);
          }
        }
      }
    }
    trace.error_signatures = trace.error_signatures.slice(0, 10);

    // Tool chain inference
    trace.tool_chain = inferToolChain(
      validation && validation.results ? validation.results : [],
      blast
    );

    // Duration
    if (validation && validation.startedAt && validation.finishedAt) {
      trace.validation_duration_ms = validation.finishedAt - validation.startedAt;
    }

    // Canary result
    if (canary && !canary.skipped) {
      trace.canary_ok = !!canary.ok;
    }
  }

  // Timestamp
  trace.created_at = new Date().toISOString();

  return trace;
}

module.exports = {
  buildExecutionTrace,
  desensitizeFilePath,
  extractErrorSignature,
  inferToolChain,
  classifyBlastLevel,
  getTraceLevel,
};
