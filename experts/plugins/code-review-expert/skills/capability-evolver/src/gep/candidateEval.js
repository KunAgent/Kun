// Candidate evaluation logic extracted from evolve.js for maintainability.
// Handles capability candidate extraction, persistence, and preview building.

const {
  readRecentCandidates,
  readRecentExternalCandidates,
  readRecentFailedCapsules,
  appendCandidateJsonl,
} = require('./assetStore');
const { extractCapabilityCandidates, renderCandidatesPreview } = require('./candidates');
const { matchPatternToSignals } = require('./selector');

function buildCandidatePreviews({ signals, recentSessionTranscript }) {
  const newCandidates = extractCapabilityCandidates({
    recentSessionTranscript: recentSessionTranscript || '',
    signals,
    recentFailedCapsules: readRecentFailedCapsules(50),
  });
  for (const c of newCandidates) {
    try {
      appendCandidateJsonl(c);
    } catch (e) {
      console.warn('[Candidates] Failed to persist candidate:', e && e.message || e);
    }
  }
  const recentCandidates = readRecentCandidates(20);
  const capabilityCandidatesPreview = renderCandidatesPreview(recentCandidates.slice(-8), 1600);

  let externalCandidatesPreview = '(none)';
  try {
    const external = readRecentExternalCandidates(50);
    const list = Array.isArray(external) ? external : [];
    const capsulesOnly = list.filter(x => x && x.type === 'Capsule');
    const genesOnly = list.filter(x => x && x.type === 'Gene');

    const matchedExternalGenes = genesOnly
      .map(g => {
        const pats = Array.isArray(g.signals_match) ? g.signals_match : [];
        const hit = pats.reduce((acc, p) => (matchPatternToSignals(p, signals) ? acc + 1 : acc), 0);
        return { gene: g, hit };
      })
      .filter(x => x.hit > 0)
      .sort((a, b) => b.hit - a.hit)
      .slice(0, 3)
      .map(x => x.gene);

    const matchedExternalCapsules = capsulesOnly
      .map(c => {
        const triggers = Array.isArray(c.trigger) ? c.trigger : [];
        const score = triggers.reduce((acc, t) => (matchPatternToSignals(t, signals) ? acc + 1 : acc), 0);
        return { capsule: c, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(x => x.capsule);

    if (matchedExternalGenes.length || matchedExternalCapsules.length) {
      externalCandidatesPreview = `\`\`\`json\n${JSON.stringify(
        [
          ...matchedExternalGenes.map(g => ({
            type: g.type,
            id: g.id,
            category: g.category || null,
            signals_match: g.signals_match || [],
            a2a: g.a2a || null,
          })),
          ...matchedExternalCapsules.map(c => ({
            type: c.type,
            id: c.id,
            trigger: c.trigger,
            gene: c.gene,
            summary: c.summary,
            confidence: c.confidence,
            blast_radius: c.blast_radius || null,
            outcome: c.outcome || null,
            success_streak: c.success_streak || null,
            a2a: c.a2a || null,
          })),
        ],
        null,
        2
      )}\n\`\`\``;
    }
  } catch (e) {
    console.warn('[ExternalCandidates] Preview build failed (non-fatal):', e && e.message || e);
  }

  return { capabilityCandidatesPreview, externalCandidatesPreview, newCandidates };
}

module.exports = { buildCandidatePreviews };
