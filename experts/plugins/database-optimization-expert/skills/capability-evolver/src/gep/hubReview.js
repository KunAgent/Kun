// Hub Asset Review: submit usage-verified reviews after solidify.
//
// When an evolution cycle reuses a Hub asset (source_type = 'reused' or 'reference'),
// we submit a review to POST /a2a/assets/:assetId/reviews after solidify completes.
// Rating is derived from outcome: success -> 4-5, failure -> 1-2.
// Reviews are non-blocking; errors never affect the solidify result.
// Duplicate prevention: a local file tracks reviewed assetIds to avoid re-reviewing.

const fs = require('fs');
const path = require('path');
const { getNodeId, getHubNodeSecret } = require('./a2aProtocol');
const { logAssetCall } = require('./assetCallLog');

const REVIEW_HISTORY_FILE = path.join(
  require('./paths').getEvolutionDir(),
  'hub_review_history.json'
);

const REVIEW_HISTORY_MAX_ENTRIES = 500;

function _loadReviewHistory() {
  try {
    if (!fs.existsSync(REVIEW_HISTORY_FILE)) return {};
    const raw = fs.readFileSync(REVIEW_HISTORY_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function _saveReviewHistory(history) {
  try {
    const dir = path.dirname(REVIEW_HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const keys = Object.keys(history);
    if (keys.length > REVIEW_HISTORY_MAX_ENTRIES) {
      const sorted = keys
        .map(k => ({ k, t: history[k].at || 0 }))
        .sort((a, b) => a.t - b.t);
      const toRemove = sorted.slice(0, keys.length - REVIEW_HISTORY_MAX_ENTRIES);
      for (const entry of toRemove) delete history[entry.k];
    }
    const tmp = REVIEW_HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(history, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, REVIEW_HISTORY_FILE);
  } catch {}
}

function _alreadyReviewed(assetId) {
  const history = _loadReviewHistory();
  return !!history[assetId];
}

function _markReviewed(assetId, rating, success) {
  const history = _loadReviewHistory();
  history[assetId] = { at: Date.now(), rating, success };
  _saveReviewHistory(history);
}

function _deriveRating(outcome, constraintCheck) {
  if (outcome && outcome.status === 'success') {
    const score = Number(outcome.score) || 0;
    return score >= 0.85 ? 5 : 4;
  }
  const hasConstraintViolation =
    constraintCheck &&
    Array.isArray(constraintCheck.violations) &&
    constraintCheck.violations.length > 0;
  return hasConstraintViolation ? 1 : 2;
}

function _buildReviewContent({ outcome, gene, signals, blast, sourceType }) {
  const parts = [];
  const status = outcome && outcome.status ? outcome.status : 'unknown';
  const score = outcome && Number.isFinite(Number(outcome.score))
    ? Number(outcome.score).toFixed(2) : '?';

  parts.push('Outcome: ' + status + ' (score: ' + score + ')');
  parts.push('Reuse mode: ' + (sourceType || 'unknown'));

  if (gene && gene.id) {
    parts.push('Gene: ' + gene.id + ' (' + (gene.category || 'unknown') + ')');
  }

  if (Array.isArray(signals) && signals.length > 0) {
    parts.push('Signals: ' + signals.slice(0, 6).join(', '));
  }

  if (blast) {
    parts.push('Blast radius: ' + (blast.files || 0) + ' file(s), ' + (blast.lines || 0) + ' line(s)');
  }

  if (status === 'success') {
    parts.push('The fetched asset was successfully applied and solidified.');
  } else {
    parts.push('The fetched asset did not lead to a successful evolution cycle.');
  }

  return parts.join('\n').slice(0, 2000);
}

function getHubUrl() {
  return (process.env.A2A_HUB_URL || '').replace(/\/+$/, '');
}

async function submitHubReview({
  reusedAssetId,
  sourceType,
  outcome,
  gene,
  signals,
  blast,
  constraintCheck,
  runId,
}) {
  var hubUrl = getHubUrl();
  if (!hubUrl) return { submitted: false, reason: 'no_hub_url' };

  if (!reusedAssetId || typeof reusedAssetId !== 'string') {
    return { submitted: false, reason: 'no_reused_asset_id' };
  }

  if (sourceType !== 'reused' && sourceType !== 'reference') {
    return { submitted: false, reason: 'not_hub_sourced' };
  }

  if (_alreadyReviewed(reusedAssetId)) {
    return { submitted: false, reason: 'already_reviewed' };
  }

  var rating = _deriveRating(outcome, constraintCheck);
  var content = _buildReviewContent({ outcome, gene, signals, blast, sourceType });
  var senderId = getNodeId();

  var endpoint = hubUrl + '/a2a/assets/' + encodeURIComponent(reusedAssetId) + '/reviews';

  var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
  var secret = getHubNodeSecret();
  if (secret) {
    headers['Authorization'] = 'Bearer ' + secret;
  }

  var body = JSON.stringify({
    sender_id: senderId,
    rating: rating,
    content: content,
  });

  try {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort('hub_review_timeout'); }, 10000);

    var res = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      _markReviewed(reusedAssetId, rating, true);
      console.log(
        '[HubReview] Submitted review for ' + reusedAssetId + ': rating=' + rating + ', outcome=' + (outcome && outcome.status)
      );
      logAssetCall({
        run_id: runId || null,
        action: 'hub_review_submitted',
        asset_id: reusedAssetId,
        extra: { rating: rating, outcome_status: outcome && outcome.status },
      });
      return { submitted: true, rating: rating, asset_id: reusedAssetId };
    }

    var errData = await res.json().catch(function () { return {}; });
    var errCode = errData.error || errData.code || ('http_' + res.status);

    if (errCode === 'already_reviewed') {
      _markReviewed(reusedAssetId, rating, false);
    }

    console.log('[HubReview] Hub rejected review for ' + reusedAssetId + ': ' + errCode);
    logAssetCall({
      run_id: runId || null,
      action: 'hub_review_rejected',
      asset_id: reusedAssetId,
      extra: { rating: rating, error: errCode },
    });
    return { submitted: false, reason: errCode, rating: rating };
  } catch (err) {
    var reason = err.name === 'AbortError' ? 'timeout' : 'fetch_error';
    console.log('[HubReview] Failed (non-fatal, ' + reason + '): ' + err.message);
    logAssetCall({
      run_id: runId || null,
      action: 'hub_review_failed',
      asset_id: reusedAssetId,
      extra: { rating: rating, reason: reason, error: err.message },
    });
    return { submitted: false, reason: reason, error: err.message };
  }
}

module.exports = {
  submitHubReview,
};
