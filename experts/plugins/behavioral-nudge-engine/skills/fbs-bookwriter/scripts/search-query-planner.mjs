#!/usr/bin/env node
import { TimeAnchorResolver } from './time-anchor-resolver.mjs';
import { CNSourceRouter } from './cn-source-router.mjs';

/**
 * 检索查询规划器
 * 产出：相对时效 / 站点限定 / 中文语义（+可选历史vs最新）
 */
export class SearchQueryPlanner {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.anchorResolver = new TimeAnchorResolver(projectRoot, options.timeAnchorOptions || {});
    this.sourceRouter = new CNSourceRouter(options.sourceRouting || {});
  }

  buildPlan(domainConfig, options = {}) {
    const anchor = this.anchorResolver.resolve({
      ttlMinutes: options.anchorTTLMinutes || 60,
      stage: options.stage || 'S0',
      forceRefresh: Boolean(options.forceRefreshAnchor)
    });

    const intent = this.sourceRouter.classifyIntent({
      intentHint: options.intentHint || domainConfig?.name || '',
      query: options.taskDescription || ''
    });
    const route = this.sourceRouter.route({
      intentHint: intent,
      text: options.taskDescription || ''
    });

    const baseTerms = this.collectBaseTerms(domainConfig, options);
    const relativeQueries = this.buildRelativeQueries(baseTerms, anchor);
    const siteQueries = this.buildSiteQueries(baseTerms, route.preferredDomains || []);
    const semanticQueries = this.buildSemanticCNQueries(baseTerms);

    const queries = [
      ...relativeQueries,
      ...siteQueries,
      ...semanticQueries
    ];

    if (options.includeHistoryLatestSplit) {
      queries.push(...this.buildHistoryLatestSplitQueries(baseTerms));
    }

    const deduped = this.deduplicateAndRank(queries).slice(0, options.maxQueries || 12);

    return {
      anchor,
      intent,
      route,
      queries: deduped,
      planMeta: {
        baseTerms,
        generatedAt: new Date().toISOString(),
        variantCount: deduped.length,
        policy: ['relative_time', 'site_scoped', 'semantic_cn']
      }
    };
  }

  collectBaseTerms(domainConfig, options) {
    const terms = [];
    if (Array.isArray(options.baseKeywords)) terms.push(...options.baseKeywords);
    if (Array.isArray(domainConfig?.searchKeywords)) terms.push(...domainConfig.searchKeywords.slice(0, 4));
    if (Array.isArray(domainConfig?.knowledgePoints)) terms.push(...domainConfig.knowledgePoints.slice(0, 4));
    if (options.taskDescription) terms.push(options.taskDescription);

    return [...new Set(terms.map((v) => this.sanitizeQuery(v)).filter(Boolean))].slice(0, 8);
  }

  buildRelativeQueries(baseTerms, anchor) {
    const suffixes = anchor.relativeTimeTokens?.length ? anchor.relativeTimeTokens : ['最新', '当前', '近三年'];
    const out = [];
    baseTerms.slice(0, 4).forEach((t, i) => {
      out.push({
        query: `${t} ${suffixes[i % suffixes.length]}`,
        type: 'relative_time',
        priority: 1
      });
    });
    return out;
  }

  buildSiteQueries(baseTerms, domains) {
    const out = [];
    if (!domains?.length) return out;
    baseTerms.slice(0, 3).forEach((t) => {
      domains.slice(0, 2).forEach((d) => {
        out.push({
          query: `${t} site:${d}`,
          type: 'site_scoped',
          priority: 2
        });
      });
    });
    return out;
  }

  buildSemanticCNQueries(baseTerms) {
    const out = [];
    const synonymMap = [
      ['最佳实践', ['实战经验', '落地方法', '操作指南']],
      ['方法论', ['框架', '流程', '策略']],
      ['质检', ['质量检查', '内容评估', '审核标准']],
      ['去AI味', ['自然化表达', '人味写作', '去机器感']]
    ];

    for (const term of baseTerms.slice(0, 3)) {
      out.push({ query: term, type: 'semantic_cn', priority: 3 });
      for (const [k, syns] of synonymMap) {
        if (term.includes(k)) {
          syns.slice(0, 2).forEach((syn) => {
            out.push({ query: term.replace(k, syn), type: 'semantic_cn', priority: 3 });
          });
        }
      }
    }

    return out;
  }

  buildHistoryLatestSplitQueries(baseTerms) {
    const out = [];
    for (const term of baseTerms.slice(0, 2)) {
      out.push({ query: `${term} 历史演进`, type: 'history_vs_latest', priority: 4 });
      out.push({ query: `${term} 最新进展`, type: 'history_vs_latest', priority: 4 });
    }
    return out;
  }

  sanitizeQuery(input) {
    if (!input) return '';
    let q = String(input).trim();
    q = q.replace(/\b(20\d{2})\b/g, '');
    q = q.replace(/\s+/g, ' ').trim();
    return q;
  }

  deduplicateAndRank(queries) {
    const seen = new Set();
    const out = [];
    for (const row of queries) {
      const key = row.query.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }

    return out.sort((a, b) => (a.priority || 9) - (b.priority || 9));
  }
}

export default SearchQueryPlanner;
