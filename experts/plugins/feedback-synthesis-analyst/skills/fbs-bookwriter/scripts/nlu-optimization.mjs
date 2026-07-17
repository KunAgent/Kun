/**
 * 2.1.2 NLU 主实现（单真源：references/01-core/intent-canonical.json）
 */
import {
  classifyConfidence,
  completeIntentSlots,
  getIntentById,
  isConflictPair,
  listIntentIds,
  loadIntentCanonical,
  resolveIntentCandidates,
} from './lib/intent-canonical.mjs';

export class NaturalLanguageEngine {
  recognizeIntent(input, context = {}) {
    const candidates = resolveIntentCandidates(input, {
      contextIntentHints: this.#buildContextHints(context),
    });
    const top = candidates[0] || { intent: 'OTHER', score: 0.2, method: 'fallback' };
    const second = candidates[1] || null;
    const confidenceBand = classifyConfidence(top.score);
    const margin = second ? top.score - second.score : top.score;
    const hasConflict = second ? isConflictPair(top.intent, second.intent) : false;
    const weakSignal = top.method === 'weak-signal' || top.method === 'fallback';
    const shouldClarify =
      confidenceBand === 'low' ||
      weakSignal ||
      hasConflict ||
      margin < 0.12 ||
      (confidenceBand === 'medium' && top.method !== 'exact' && margin < 0.2);
    const chosenIntent = this.#applyContextCorrection(top.intent, context);
    const slotState = completeIntentSlots(chosenIntent, input, context);
    return {
      intent: chosenIntent,
      confidence: Number(top.score.toFixed(3)),
      method: top.method,
      confidenceBand,
      shouldClarify,
      needsSlotPrompt: !slotState.complete,
      slotState,
      topK: candidates,
      conflictWith: hasConflict ? second.intent : null,
      routesTo: getIntentById(chosenIntent)?.routes_to || 'fallback_help',
    };
  }

  getActivationResponse(context = {}) {
    const { hasChapterStatus, lastChapterName, lastChapterNo, isNewUser } = context;
    if (hasChapterStatus && lastChapterName) {
      return `上次写到第${lastChapterNo || ''}章《${lastChapterName}》，说“继续上次”我就接着写。`;
    }
    if (isNewUser) {
      return '福帮手已就绪。你想写新书、接着写，还是先做质检？';
    }
    return '福帮手已就绪。告诉我这次要做什么，我马上开始。';
  }

  getHelpSuggestions() {
    return [
      { intent: 'WRITE_BOOK', message: '写新书或定大纲' },
      { intent: 'CONTINUE', message: '继续上次进度' },
      { intent: 'REVIEW', message: '质量自检或去AI味' },
    ];
  }

  #buildContextHints(context) {
    const hints = [];
    if (context?.sessionState === 'writing') hints.push('CONTINUE');
    if (context?.hasUnconfirmedAction) hints.push('CONFIRM_TOPIC');
    if (context?.userHasMaterials) hints.push('ACTIVATE_MATERIAL');
    return hints;
  }

  #applyContextCorrection(intent, context) {
    if (context?.sessionState === 'writing' && intent === 'WRITE_BOOK') return 'CONTINUE';
    if (context?.hasUnconfirmedAction && intent === 'WRITE_BOOK') return 'CONFIRM_TOPIC';
    return intent;
  }
}

export const NLU_OPTIMIZATION = {
  version: '2.1.2',
  canonicalPath: 'references/01-core/intent-canonical.json',
  supportedIntents: listIntentIds(),
  confidenceBands: loadIntentCanonical().confidenceBands,
};

export default NLU_OPTIMIZATION;
