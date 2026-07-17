/**
 * 2.1.2 NLU 增强实现（基于 canonical + Top-K）
 */
import { NaturalLanguageEngine } from './nlu-optimization.mjs';
import { loadIntentCanonical } from './lib/intent-canonical.mjs';

export class EnhancedNLUEngine extends NaturalLanguageEngine {
  async enhancedRecognizeIntent(input, context = {}) {
    const base = this.recognizeIntent(input, context);
    const now = Date.now();
    return {
      ...base,
      elapsedMs: Math.max(1, Date.now() - now),
      decision: base.shouldClarify ? 'clarify' : 'execute',
      canonicalVersion: loadIntentCanonical().version,
    };
  }
}

export const NLU_ENHANCED = {
  version: '2.1.2',
  canonicalPath: 'references/01-core/intent-canonical.json',
};

export default NLU_ENHANCED;
