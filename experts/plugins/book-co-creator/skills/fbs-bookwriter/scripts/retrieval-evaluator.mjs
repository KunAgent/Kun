#!/usr/bin/env node

/**
 * JUDGE 评分器
 * relevance / freshness / authority / accessibility / actionability
 */
export class RetrievalEvaluator {
  constructor(options = {}) {
    this.now = options.now ? new Date(options.now) : new Date();
    this.weights = {
      relevance: 0.25,
      freshness: 0.2,
      authority: 0.25,
      accessibility: 0.15,
      actionability: 0.15,
      ...(options.weights || {})
    };
  }

  evaluateResult(result, context = {}) {
    const relevance = this.scoreRelevance(result, context);
    const freshness = this.scoreFreshness(result, context);
    const authority = this.scoreAuthority(result);
    const accessibility = this.scoreAccessibility(result);
    const actionability = this.scoreActionability(result, context);

    const total =
      relevance * this.weights.relevance +
      freshness * this.weights.freshness +
      authority * this.weights.authority +
      accessibility * this.weights.accessibility +
      actionability * this.weights.actionability;

    return {
      relevance,
      freshness,
      authority,
      accessibility,
      actionability,
      total: Number(total.toFixed(4)),
      pass: total >= (context.passThreshold || 0.65)
    };
  }

  evaluateBatch(results = [], context = {}) {
    const evaluated = results.map((r) => ({
      ...r,
      judge: this.evaluateResult(r, context)
    }));

    evaluated.sort((a, b) => b.judge.total - a.judge.total);

    const avg = evaluated.length
      ? evaluated.reduce((s, r) => s + r.judge.total, 0) / evaluated.length
      : 0;

    const recommendation = avg < 0.55
      ? 'rewrite_query_and_switch_source'
      : avg < 0.7
        ? 'add_site_scoped_queries'
        : 'keep_and_extract_delta';

    return {
      evaluated,
      averageScore: Number(avg.toFixed(4)),
      topScore: evaluated[0]?.judge?.total || 0,
      recommendation
    };
  }

  scoreRelevance(result, context) {
    if (typeof result.relevance === 'number') return this.clamp01(result.relevance);
    const text = `${result.title || ''} ${result.snippet || ''}`.toLowerCase();
    const kws = Array.isArray(context.keywords) ? context.keywords.map((k) => String(k).toLowerCase()) : [];
    if (!kws.length) return 0.7;
    const hit = kws.filter((k) => text.includes(k)).length;
    return this.clamp01(hit / Math.max(kws.length, 1));
  }

  scoreFreshness(result, context) {
    const dt = result.publishDate || result.date || result.publishedAt;
    if (!dt) return 0.55;
    const ts = new Date(dt).getTime();
    if (Number.isNaN(ts)) return 0.5;
    const now = context.anchorDate ? new Date(context.anchorDate).getTime() : this.now.getTime();
    const diffDays = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));

    if (diffDays <= 30) return 1;
    if (diffDays <= 90) return 0.85;
    if (diffDays <= 180) return 0.7;
    if (diffDays <= 365) return 0.55;
    return 0.35;
  }

  scoreAuthority(result) {
    if (typeof result.authority === 'number') return this.clamp01(result.authority);
    const source = String(result.source || result.url || '').toLowerCase();
    if (!source) return 0.55;
    if (/(gov\.cn|people\.com\.cn|xinhuanet\.com|cctv\.com)/.test(source)) return 0.95;
    if (/(github\.com|gitee\.com|developers\.weixin|cloud\.tencent\.com|alibabacloud)/.test(source)) return 0.88;
    if (/(36kr|huxiu|acm|ieee|arxiv)/.test(source)) return 0.78;
    if (/(zhihu|xiaohongshu|douban|bilibili)/.test(source)) return 0.62;
    return 0.5;
  }

  scoreAccessibility(result) {
    const source = String(result.source || result.url || '').toLowerCase();
    if (!source) return 0.6;
    if (/(zhihu|xiaohongshu|mp\.weixin\.qq\.com)/.test(source)) return 0.45;
    if (result.fetchMode === 'summary') return 0.5;
    return 0.85;
  }

  scoreActionability(result, context) {
    if (typeof result.actionability === 'number') return this.clamp01(result.actionability);
    const snippet = String(result.snippet || '');
    const hasMethodSignal = /(步骤|清单|方法|流程|策略|框架|最佳实践)/.test(snippet);
    const hasDataSignal = /\d+/.test(snippet);
    const hasIntentHit = context.intent ? snippet.includes(String(context.intent)) : false;

    let score = 0.45;
    if (hasMethodSignal) score += 0.25;
    if (hasDataSignal) score += 0.2;
    if (hasIntentHit) score += 0.1;
    return this.clamp01(score);
  }

  clamp01(v) {
    if (Number.isNaN(v)) return 0;
    return Math.max(0, Math.min(1, Number(v)));
  }
}

export default RetrievalEvaluator;
