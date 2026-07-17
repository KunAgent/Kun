#!/usr/bin/env node
/**
 * FBS-BookWriter 方法论知识获取器（闭环版）
 *
 * 核心链路：
 * 时间锚 -> 中文源路由 -> Query Planner -> JUDGE评分 -> Delta提炼 -> 知识写回
 */

import fs from 'fs';
import path from 'path';

import { SearchQueryPlanner } from './search-query-planner.mjs';
import { RetrievalEvaluator } from './retrieval-evaluator.mjs';
import { KnowledgeDeltaExtractor } from './knowledge-delta-extractor.mjs';
import { ReflectiveRepairOrchestrator } from './reflective-repair-orchestrator.mjs';
import { SmartMemoryCore } from './smart-memory-core.mjs';
import {
  appendLedgerEntry,
  createSearchPreflightEntry,
  loadEntryContractPolicy,
  normalizeStage
} from './lib/entry-contract-runtime.mjs';

const DEFAULT_DOMAIN_CONFIGS = {
  deAIFlavor: {
    name: '去AI味方法论',
    searchKeywords: ['去AI味 写作 方法', '自然化表达 技巧', '人味写作 最佳实践', '风格去机器感'],
    knowledgePoints: ['句式多样性', '情绪注入', '口语化平衡', '过渡词节制']
  },
  qualityCheck: {
    name: '质检优化方法论',
    searchKeywords: ['内容质检 方法', '质量评估 体系', '写作审校 最佳实践', '文本质量门禁'],
    knowledgePoints: ['逻辑连贯', '事实核查', '可读性', '结构完整性']
  },
  creativeTopic: {
    name: '创意选题方法论',
    searchKeywords: ['创意选题 方法', '差异化选题 框架', '内容选题 策略', '热点结合 选题'],
    knowledgePoints: ['需求洞察', '角度创新', '竞品差异', '选题验证']
  },
  styleAdjustment: {
    name: '风格微调方法论',
    searchKeywords: ['写作风格 微调', '风格一致性 方法', '语气调整 技巧', '风格迁移 写作'],
    knowledgePoints: ['风格识别', '映射规则', '语气控制', '一致性检查']
  },
  contentAssetization: {
    name: '内容资产化方法论',
    searchKeywords: ['内容资产化 方法', '知识沉淀 体系', '内容复用 策略', '知识库构建'],
    knowledgePoints: ['结构化', '标签体系', '复用路径', '价值评估']
  },
  meetingRoleDesign: {
    name: '会议角色智能设计',
    searchKeywords: ['会议角色 设计方法', '协作角色 配置', '会议效率 角色模型', '多角色协同 机制'],
    knowledgePoints: ['角色分工', '冲突机制', '协作节奏', '决策闭环']
  }
};

export class KnowledgeFetcher {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.searchCache = new Map();
    this.knowledgeCache = new Map();

    this.domainConfigs = {
      ...DEFAULT_DOMAIN_CONFIGS,
      ...(options.domainConfigs || {})
    };

    this.liveSearchEnabled = options.liveSearchEnabled !== false;
    this.requestTimeoutMs = Number(options.requestTimeoutMs || 8000);
    this.searchPolicy = this._loadSearchPolicy();

    this.queryPlanner = new SearchQueryPlanner(projectRoot, options);
    this.evaluator = new RetrievalEvaluator(options.judge || {});
    this.deltaExtractor = new KnowledgeDeltaExtractor();
    this.repairOrchestrator = new ReflectiveRepairOrchestrator(projectRoot, options);
    this.memoryCore = new SmartMemoryCore(projectRoot, options.smartMemory || {});
  }

  async fetchDomainKnowledge(domain, options = {}) {
    const domainConfig = this.domainConfigs[domain];
    if (!domainConfig) throw new Error(`未知的领域: ${domain}`);

    const stage = normalizeStage(options.stage || 'S0') || 'S0';
    const chapterId = String(options.chapterId || 'global');

    console.log(`📚 获取「${domainConfig.name}」知识（${domain}）...\n`);

    const plan = this.queryPlanner.buildPlan(domainConfig, {
      stage,
      intentHint: options.intentHint || 'method',
      taskDescription: options.taskDescription || `${domainConfig.name} 最新最佳实践`,
      includeHistoryLatestSplit: Boolean(options.includeHistoryLatestSplit),
      maxQueries: options.maxQueries || 10
    });

    const preflight = this._recordSearchPreflight({
      stage,
      chapterId,
      domainConfig,
      plan,
      options
    });

    console.log(`🕒 时间锚：${plan.anchor.dateText}（${plan.anchor.sourceType}）`);
    console.log(`🧭 路由：${plan.route.layer} / ${plan.intent}`);
    console.log(`🔎 规划查询数：${plan.queries.length}\n`);

    const primarySearch = await this._executeSearches(plan.queries, domain, plan.route, {
      stage,
      chapterId,
      intent: plan.intent,
      anchor: plan.anchor,
      reason: 'primary'
    });

    let mergedResults = [...primarySearch.rawResults];
    const repair = this.repairOrchestrator.analyzeAndPlanRepair(
      options.latestAnswerText || options.taskDescription || `${domainConfig.name} 方法更新`,
      {
        domain,
        stage,
        taskDescription: options.taskDescription || `${domainConfig.name} 方法更新`,
        maxQueries: Math.max(4, Math.min(8, Number(options.repairMaxQueries || 6)))
      }
    );

    let repairSearch = null;
    if (repair.shouldResearch && repair.researchPlan?.queries?.length) {
      repairSearch = await this._executeSearches(repair.researchPlan.queries, domain, repair.researchPlan.route || plan.route, {
        stage,
        chapterId,
        intent: repair.researchPlan.intent || plan.intent,
        anchor: repair.researchPlan.anchor || plan.anchor,
        reason: 'repair'
      });
      mergedResults = mergedResults.concat(repairSearch.rawResults || []);
    }

    const judged = this.evaluator.evaluateBatch(mergedResults, {
      keywords: plan.planMeta.baseTerms,
      anchorDate: plan.anchor.anchoredAt,
      intent: plan.intent,
      passThreshold: options.passThreshold || 0.62
    });

    const filteredResults = judged.evaluated
      .filter((r) => r.judge.pass)
      .slice(0, options.maxResults || 10)
      .map((r) => ({
        ...r,
        relevance: r.judge.relevance,
        authority: r.judge.authority,
        freshnessScore: r.judge.freshness,
        accessibilityScore: r.judge.accessibility,
        actionabilityScore: r.judge.actionability,
        judgeScore: r.judge.total
      }));

    const optimizationSummary = this._buildBatchOptimizationSummary({
      judged,
      filteredResults,
      plan,
      repair
    });

    const writeback = this._runMemoryWriteback({
      stage,
      anchor: plan.anchor,
      route: plan.route,
      plan,
      judged,
      filteredResults,
      optimizationSummary
    });

    console.log(`✅ 检索结果：${mergedResults.length} 条，JUDGE通过 ${filteredResults.length} 条\n`);

    const previous = this.knowledgeCache.get(domain) || {};
    const delta = this.deltaExtractor.extract(domain, filteredResults, previous);

    const methodologyKnowledge = this._extractMethodologyKnowledge(filteredResults, domainConfig);
    const bestPractices = this._generateBestPractices(filteredResults);
    const expertInsights = this._extractExpertInsights(filteredResults);

    const knowledge = {
      domain,
      domainName: domainConfig.name,
      fetchedAt: new Date().toISOString(),
      sourceResults: filteredResults,
      methodologyKnowledge,
      bestPractices,
      expertInsights,
      deltaKnowledge: delta,
      retrievalTrace: {
        anchor: plan.anchor,
        route: plan.route,
        plan: plan.queries,
        preflight,
        repair: {
          triggered: repair.shouldResearch,
          triggerSignals: repair.diagnostics?.triggers || [],
          repairQueryCount: repairSearch?.stats?.queries || 0
        },
        effectiveEndpoint: {
          primary: primarySearch.effectiveEndpoint,
          repair: repairSearch?.effectiveEndpoint || null
        },
        writeback,
        queryOptimization: optimizationSummary,
        judgeSummary: {
          averageScore: judged.averageScore,
          topScore: judged.topScore,
          recommendation: judged.recommendation
        }
      }
    };

    this.knowledgeCache.set(domain, knowledge);
    return knowledge;
  }

  async _executeSearches(queries, domain, route, context = {}) {
    const rawResults = [];
    const batchSize = 3;
    const endpointUsed = [];

    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((q) => this._executeSearch(q, domain, route, context)));

      batchResults.forEach((result, idx) => {
        rawResults.push(...result.rows);
        if (result.meta?.endpoint) endpointUsed.push(result.meta.endpoint);
        this._appendSearchLedgerEntry({
          query: batch[idx],
          rows: result.rows,
          context,
          meta: result.meta
        });
      });

      if (i + batchSize < queries.length) await this._sleep(800);
    }

    return {
      rawResults,
      effectiveEndpoint: endpointUsed.length ? [...new Set(endpointUsed)] : ['mock_fallback'],
      stats: {
        queries: queries.length,
        results: rawResults.length
      }
    };
  }

  async _executeSearch(query, domain, route, context = {}) {
    const cacheKey = `${domain}:${query.type}:${query.query}`;
    if (this.searchCache.has(cacheKey)) return this.searchCache.get(cacheKey);

    let rows = [];
    let meta = {
      endpoint: 'mock_fallback',
      usedMock: true,
      reason: 'live_disabled'
    };

    if (this.liveSearchEnabled) {
      const liveResult = await this._executeSearchViaEffectiveEndpoints(query, route, context);
      rows = liveResult.rows;
      meta = liveResult.meta;
    }

    if (!rows.length) {
      rows = await this._mockSearchResults(query, domain, route);
      meta = {
        ...(meta || {}),
        endpoint: meta?.endpoint || 'mock_fallback',
        usedMock: true,
        reason: meta?.reason || 'live_no_results'
      };
    }

    const output = { rows, meta };
    this.searchCache.set(cacheKey, output);
    return output;
  }

  async _executeSearchViaEffectiveEndpoints(query, route, context = {}) {
    const candidates = this._buildEndpointCandidates(query, route);
    const errors = [];

    for (const candidate of candidates) {
      try {
        const responseText = await this._fetchText(candidate.url, this.requestTimeoutMs);

        if (candidate.type === 'bing_rss') {
          if (this._isJsRenderedShell(responseText)) {
            errors.push(`${candidate.name}:js_shell`);
            continue;
          }
          const rows = this._parseBingRss(responseText, query, route);
          if (rows.length) {
            return {
              rows,
              meta: {
                endpoint: candidate.name,
                usedMock: false,
                reason: 'live_rss_ok',
                candidateType: candidate.type
              }
            };
          }
          errors.push(`${candidate.name}:rss_empty`);
        } else if (candidate.type === 'baidu_html') {
          const rows = this._parseBaiduHtml(responseText, query, route);
          if (rows.length) {
            return {
              rows,
              meta: {
                endpoint: candidate.name,
                usedMock: false,
                reason: 'live_html_ok',
                candidateType: candidate.type
              }
            };
          }
          errors.push(`${candidate.name}:html_empty`);
        }
      } catch (error) {
        errors.push(`${candidate.name}:${error.message}`);
      }
    }

    return {
      rows: [],
      meta: {
        endpoint: candidates[0]?.name || 'effective_endpoint_failed',
        usedMock: true,
        reason: errors.join('|') || 'effective_endpoint_failed'
      }
    };
  }

  _buildEndpointCandidates(query, route) {
    const encodedQuery = encodeURIComponent(query.query || '');
    const preferred = this.searchPolicy?.searchAccessPolicy?.effectiveEndpointStrategy?.preferredEndpoints || [];

    const resolved = [];
    preferred.forEach((cfg) => {
      if (cfg.rssEndpoint_USE_THIS) {
        resolved.push({
          type: 'bing_rss',
          name: `${cfg.engine || 'bing'}_rss`,
          url: this._renderEndpointUrl(cfg.rssEndpoint_USE_THIS, encodedQuery)
        });
      } else if (cfg.rssEndpoint) {
        resolved.push({
          type: 'bing_rss',
          name: `${cfg.engine || 'rss'}_rss`,
          url: this._renderEndpointUrl(cfg.rssEndpoint, encodedQuery)
        });
      }
    });

    if (!resolved.length) {
      resolved.push({
        type: 'bing_rss',
        name: 'bing_rss',
        url: this._renderEndpointUrl('https://www.bing.com/search?q={query}&format=rss&mkt=zh-CN', encodedQuery)
      });
    }

    resolved.push({
      type: 'baidu_html',
      name: 'baidu_html',
      url: this._renderEndpointUrl('https://www.baidu.com/s?wd={query}&rn=10', encodedQuery)
    });

    return resolved;
  }

  _renderEndpointUrl(template, encodedQuery) {
    return String(template || '')
      .replaceAll('{query}', encodedQuery)
      .replaceAll('{URL编码查询词}', encodedQuery);
  }

  async _fetchText(url, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': 'FBS-BookWriter/2.1.1'
        }
      });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  }

  _isJsRenderedShell(content) {
    const text = String(content || '').toLowerCase();
    return text.includes('<!doctype html') && !text.includes('<item>');
  }

  _parseBingRss(xml, query, route) {
    const items = [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 6);
    if (!items.length) return [];

    const qTokens = this._tokenize(query.query);

    return items.map((match, index) => {
      const block = match[1] || '';
      const title = this._decodeXml(this._pickTagText(block, 'title'));
      const link = this._decodeXml(this._pickTagText(block, 'link'));
      const snippet = this._decodeXml(this._pickTagText(block, 'description'));
      const source = this._extractDomain(link) || 'bing.com';
      const merged = `${title} ${snippet}`;
      const relevance = this._tokenOverlapScore(qTokens, this._tokenize(merged));

      return {
        id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 10)}`,
        query: query.query,
        queryType: query.type,
        source,
        title,
        author: 'Bing RSS',
        publishDate: this._decodeXml(this._pickTagText(block, 'pubDate')) || null,
        snippet,
        methodology: null,
        bestPractices: [],
        caseStudies: [],
        fetchMode: route.shouldUseSummaryFirst ? 'summary' : 'rss',
        relevance,
        url: link
      };
    }).filter((r) => r.relevance >= 0.15);
  }

  _parseBaiduHtml(html, query, route) {
    const blocks = [...String(html || '').matchAll(/<h3[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/gi)].slice(0, 4);
    if (!blocks.length) return [];

    const qTokens = this._tokenize(query.query);

    return blocks.map((match, index) => {
      const link = this._decodeHtml(match[1] || '');
      const title = this._stripHtml(this._decodeHtml(match[2] || ''));
      const source = this._extractDomain(link) || 'baidu.com';
      const snippet = `来自 ${source} 的检索结果`;
      const merged = `${title} ${snippet}`;
      const relevance = this._tokenOverlapScore(qTokens, this._tokenize(merged));

      return {
        id: `${Date.now()}-baidu-${index}-${Math.random().toString(36).slice(2, 10)}`,
        query: query.query,
        queryType: query.type,
        source,
        title,
        author: 'Baidu Search',
        publishDate: null,
        snippet,
        methodology: null,
        bestPractices: [],
        caseStudies: [],
        fetchMode: route.shouldUseSummaryFirst ? 'summary' : 'html',
        relevance,
        url: link
      };
    }).filter((r) => r.relevance >= 0.1);
  }

  _pickTagText(xml, tag) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = String(xml || '').match(re);
    return m ? m[1].trim() : '';
  }

  _decodeXml(text) {
    return String(text || '')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .trim();
  }

  _decodeHtml(text) {
    return this._decodeXml(text)
      .replaceAll('&nbsp;', ' ');
  }

  _stripHtml(text) {
    return String(text || '').replace(/<[^>]+>/g, '').trim();
  }

  _extractDomain(link) {
    try {
      return new URL(link).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  _appendSearchLedgerEntry({ query, rows, context, meta }) {
    const optimization = this._buildQueryOptimization(query, rows, meta);
    const stage = normalizeStage(context.stage || 'S0') || 'S0';
    const queryText = String(query?.query || '');

    const entry = {
      kind: 'search',
      ok: rows.length > 0,
      stage,
      chapterId: context.chapterId || 'global',
      query: queryText,
      queryType: query?.type || 'unknown',
      intent: context.intent || 'unknown',
      source: rows[0]?.source || meta?.endpoint || 'unknown',
      endpoint: meta?.endpoint || 'unknown',
      endpointMode: meta?.usedMock ? 'mock_fallback' : 'effective_endpoint',
      resultCount: rows.length,
      timestamp: new Date().toISOString(),
      queryOptimization: optimization.summary,
      queryOptimizationMeta: optimization.meta,
      yearSourceConfirmed: this._isTimestampQuery(queryText) ? rows.length > 0 : undefined
    };

    if (stage === 'S0' && this._isTimestampQuery(queryText)) {
      entry.s0Dimension = 'timestampCheck';
    }

    appendLedgerEntry(this.projectRoot, entry);
    return entry;
  }

  _isTimestampQuery(queryText) {
    return /(今天日期|当前年月日|今天是哪年哪月哪日|当前日期|当前年月|time\s*anchor|timestamp)/i.test(String(queryText || ''));
  }

  _buildQueryOptimization(query, rows, meta = {}) {
    const avgRelevance = rows.length
      ? rows.reduce((sum, row) => sum + Number(row.relevance || 0), 0) / rows.length
      : 0;
    const quality = rows.length >= 3 && avgRelevance >= 0.55
      ? '高'
      : rows.length >= 1
        ? '中'
        : '低';

    const newTerms = this._extractEmergentTerms(rows, [query?.query || '']).slice(0, 3);
    const hasNewTerms = newTerms.length > 0;

    const nextAction = quality === '低'
      ? '切换有效端点并增加站点限定检索'
      : quality === '中'
        ? '增加语义变体并补充中文权威源'
        : '保持当前路由并提炼可复用策略模板';

    const summary = `本轮检索自评：质量[${quality}]｜新专题词[${hasNewTerms ? `有：${newTerms.join('、')}` : '无'}]｜下轮优化[${nextAction}]`;

    return {
      summary,
      meta: {
        quality,
        resultCount: rows.length,
        avgRelevance: Number(avgRelevance.toFixed(4)),
        discoveredTerms: newTerms,
        endpoint: meta.endpoint || 'unknown',
        mode: meta.usedMock ? 'mock_fallback' : 'effective_endpoint'
      }
    };
  }

  _extractEmergentTerms(rows, baseTerms = []) {
    const baseSet = new Set(this._tokenize(baseTerms.join(' ')));
    const freq = new Map();

    rows.forEach((row) => {
      const text = `${row.title || ''} ${row.snippet || ''}`;
      this._tokenize(text).forEach((token) => {
        if (token.length < 2) return;
        if (baseSet.has(token)) return;
        if (/^[0-9]+$/.test(token)) return;
        freq.set(token, (freq.get(token) || 0) + 1);
      });
    });

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([token]) => token);
  }

  _buildBatchOptimizationSummary({ judged, filteredResults, plan, repair }) {
    const avg = Number(judged?.averageScore || 0);
    const quality = avg >= 0.75 ? '高' : avg >= 0.6 ? '中' : '低';
    const newTerms = this._extractEmergentTerms(filteredResults, plan?.planMeta?.baseTerms || []).slice(0, 5);

    const direction = judged?.recommendation === 'rewrite_query_and_switch_source'
      ? '重写 query 并切换至中文权威源 + RSS 端点'
      : judged?.recommendation === 'add_site_scoped_queries'
        ? '补充 site 限定与语义变体'
        : '维持当前策略并沉淀稳定 query 模板';

    return {
      quality,
      recommendation: direction,
      discoveredTerms: newTerms,
      summary: `本轮检索自评：质量[${quality}]｜新专题词[${newTerms.length ? `有：${newTerms.join('、')}` : '无'}]｜下轮优化[${direction}]`,
      repairTriggered: Boolean(repair?.shouldResearch)
    };
  }

  _recordSearchPreflight({ stage, chapterId, domainConfig, plan, options }) {
    try {
      const policy = this.searchPolicy || {};
      const entry = createSearchPreflightEntry({
        stage,
        chapterId,
        whyNow: options.whyNow || `获取${domainConfig.name}的最新有效方法并避免过时信息`,
        searchScope: options.searchScope || (plan.planMeta?.baseTerms || []).slice(0, 5).join('、') || domainConfig.name,
        nextStepAfterSearch: options.nextStepAfterSearch || 'JUDGE评估→增量知识提炼→策略写回',
        offlineFallback: options.offlineFallback || '若联网不可用则明确告知并使用本地知识库降级',
        source: 'knowledge-fetcher'
      }, policy);

      appendLedgerEntry(this.projectRoot, entry);
      return {
        ok: true,
        entry
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message
      };
    }
  }

  _runMemoryWriteback({ stage, anchor, route, plan, judged, filteredResults, optimizationSummary }) {
    const stableDomains = [...new Set(filteredResults.map((r) => r.source).filter(Boolean))].slice(0, 12);
    const effectiveQueryPatterns = [...new Set((plan.queries || []).map((q) => q.type).filter(Boolean))];
    const antiPatterns = judged.recommendation === 'rewrite_query_and_switch_source'
      ? ['单一表达检索', '缺少站点限定']
      : [];

    const shortTerm = this.memoryCore.routeMemoryWriteback({
      layer: 'shortTerm',
      payload: {
        stage,
        anchor,
        route
      }
    });

    const project = this.memoryCore.routeMemoryWriteback({
      layer: 'project',
      filePath: '.fbs/search-ledger.jsonl',
      payload: {
        stage,
        queryCount: plan.queries?.length || 0,
        passedCount: filteredResults.length,
        recommendation: judged.recommendation,
        summary: optimizationSummary.summary
      }
    });

    const longTerm = this.memoryCore.routeMemoryWriteback({
      layer: 'longTerm',
      payload: {
        stableDomains,
        effectiveQueryPatterns,
        antiPatterns
      }
    });

    return { shortTerm, project, longTerm };
  }

  _loadSearchPolicy() {
    try {
      return loadEntryContractPolicy(this.projectRoot);
    } catch {
      return {};
    }
  }

  async _mockSearchResults(query, domain, route) {
    await this._sleep(180);

    const candidates = this._getDomainMockKnowledge(domain);
    const qTokens = this._tokenize(query.query);

    const results = candidates
      .map((item) => {
        const merged = `${item.title} ${item.snippet} ${(item.tags || []).join(' ')}`;
        const score = this._tokenOverlapScore(qTokens, this._tokenize(merged));
        const source = item.source;

        return {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          query: query.query,
          queryType: query.type,
          source,
          title: item.title,
          author: item.author,
          publishDate: item.publishDate,
          snippet: item.snippet,
          methodology: item.methodology,
          bestPractices: item.bestPractices || [],
          caseStudies: item.caseStudies || [],
          fetchMode: route.shouldUseSummaryFirst ? 'summary' : 'full',
          relevance: score,
          authority: typeof item.authority === 'number' ? item.authority : undefined,
          actionability: typeof item.actionability === 'number' ? item.actionability : undefined
        };
      })
      .filter((r) => r.relevance >= 0.2)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 5);

    return results;
  }

  _getDomainMockKnowledge(domain) {
    const map = {
      deAIFlavor: [
        {
          title: '去AI味写作：从模板腔到人味表达的实操清单',
          source: '36kr.com',
          author: '内容策略团队',
          publishDate: '2026-03-21',
          authority: 0.78,
          snippet: '从句长波动、语气词控制、个人观点注入三个维度降低机器感，并给出逐段修订步骤。',
          tags: ['去AI味', '写作', '实操'],
          methodology: {
            coreTechniques: ['句长波动', '观点前置', '语气粒度控制'],
            commonPitfalls: ['过度连接词', '万能模板句'],
            assessmentCriteria: ['自然度', '风格稳定性', '读者沉浸度']
          },
          bestPractices: ['先减模板句再加人称经验', '每段保留一个具体细节']
        },
        {
          title: '写作自然化评估模型（2026版）',
          source: 'cloud.tencent.com/developer',
          author: '技术内容委员会',
          publishDate: '2026-02-11',
          authority: 0.86,
          snippet: '提出可执行的自然化评分维度：叙述弹性、语义节奏、情绪可信度。',
          tags: ['自然化', '评估'],
          methodology: {
            coreTechniques: ['节奏评估', '叙述弹性建模'],
            commonPitfalls: ['只改词不改结构'],
            assessmentCriteria: ['节奏CV', '语气一致性']
          },
          bestPractices: ['按段落而非按词微调']
        }
      ],
      qualityCheck: [
        {
          title: '内容质检闭环：S/P/C/B 指标化实践',
          source: 'huxiu.com',
          author: '编辑研究组',
          publishDate: '2026-03-09',
          authority: 0.76,
          snippet: '把质检从门禁式报告改为过程式反馈卡，降低跳过率并提升修复率。',
          tags: ['质检', '反馈卡'],
          methodology: {
            coreTechniques: ['分层指标', '过程反馈'],
            commonPitfalls: ['一次性堆叠问题'],
            assessmentCriteria: ['修复完成率', '用户接受率']
          },
          bestPractices: ['默认提供现在修/稍后修/跳过三个动作']
        }
      ],
      creativeTopic: [
        {
          title: '选题创新的三层验证法',
          source: '36kr.com',
          author: '内容增长团队',
          publishDate: '2026-01-30',
          authority: 0.75,
          snippet: '趋势验证、需求验证、差异验证三层并行，避免伪创新选题。',
          tags: ['选题', '验证'],
          methodology: {
            coreTechniques: ['三层验证', '竞品空位分析'],
            commonPitfalls: ['只看热点不看可写性'],
            assessmentCriteria: ['差异性', '完成概率']
          },
          bestPractices: ['先写 200 字试笔再定题']
        }
      ],
      styleAdjustment: [
        {
          title: '风格微调：保持语义不漂移的编辑策略',
          source: 'cloud.tencent.com/developer',
          author: '技术写作组',
          publishDate: '2026-02-25',
          authority: 0.84,
          snippet: '通过目标风格画像 + 约束词表，实现可控风格迁移。',
          tags: ['风格', '迁移'],
          methodology: {
            coreTechniques: ['风格画像', '约束词表'],
            commonPitfalls: ['全局重写导致语义漂移'],
            assessmentCriteria: ['语义保持率', '风格拟合度']
          },
          bestPractices: ['只重写偏差段落，不全稿重跑']
        }
      ],
      contentAssetization: [
        {
          title: '内容资产化流水线：从章节到知识部件',
          source: 'alibabacloud.com/help/zh',
          author: '解决方案团队',
          publishDate: '2025-12-18',
          authority: 0.82,
          snippet: '把章节拆成可复用知识部件，并标注适用场景和版本窗口。',
          tags: ['资产化', '复用'],
          methodology: {
            coreTechniques: ['知识切片', '场景标签'],
            commonPitfalls: ['只摘录不结构化'],
            assessmentCriteria: ['复用率', '检索命中率']
          },
          bestPractices: ['沉淀策略模板，不沉淀临时事实']
        }
      ],
      meetingRoleDesign: [
        {
          title: '多角色会议编排：提高协作决策质量',
          source: 'cloud.tencent.com/developer',
          author: '协作效率组',
          publishDate: '2026-03-01',
          authority: 0.83,
          snippet: '将创意、对抗、评审角色分离，减少意见同质化。',
          tags: ['会议', '角色'],
          methodology: {
            coreTechniques: ['角色拆分', '反证机制'],
            commonPitfalls: ['角色重叠导致讨论发散'],
            assessmentCriteria: ['冲突质量', '决策收敛速度']
          },
          bestPractices: ['每次会议限制一个决策目标']
        }
      ]
    };

    return map[domain] || [];
  }

  _tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[，。！？、；：,.!?;:()\[\]{}"'“”‘’]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  _tokenOverlapScore(queryTokens, docTokens) {
    if (!queryTokens.length || !docTokens.length) return 0;
    const set = new Set(docTokens);
    const hit = queryTokens.filter((t) => set.has(t)).length;
    return Math.min(1, hit / queryTokens.length + 0.2);
  }

  _extractMethodologyKnowledge(results, domainConfig) {
    return results
      .filter((r) => r.methodology)
      .map((r) => ({
        title: r.title,
        source: r.source,
        author: r.author,
        publishDate: r.publishDate,
        relevance: r.relevance,
        authority: r.authority,
        freshnessScore: r.freshnessScore,
        coreTechniques: r.methodology.coreTechniques || [],
        commonPitfalls: r.methodology.commonPitfalls || [],
        assessmentCriteria: r.methodology.assessmentCriteria || [],
        applicableScenarios: [domainConfig.name]
      }));
  }

  _generateBestPractices(results) {
    return results
      .filter((r) => Array.isArray(r.bestPractices) && r.bestPractices.length > 0)
      .map((r) => ({
        source: r.title,
        practice: r.bestPractices,
        evidence: r.caseStudies || []
      }));
  }

  _extractExpertInsights(results) {
    const insights = [];
    for (const r of results) {
      const snippets = String(r.snippet || '').split(/[。；]/).map((s) => s.trim()).filter(Boolean);
      snippets.slice(0, 2).forEach((s) => {
        insights.push({
          insight: s,
          source: r.title,
          sourceType: /(acm|ieee|arxiv|paper|academic)/i.test(r.source || '') ? 'academic' : 'practical'
        });
      });
    }
    return insights.slice(0, 20);
  }

  clearCache() {
    this.searchCache.clear();
    this.knowledgeCache.clear();
  }

  getCacheStats() {
    return {
      searchCacheSize: this.searchCache.size,
      knowledgeCacheSize: this.knowledgeCache.size,
      cachedDomains: [...this.knowledgeCache.keys()]
    };
  }

  async saveKnowledgeBase() {
    const target = path.join(this.projectRoot, '.fbs', 'evolution-knowledge', 'knowledge-base.json');
    const dir = path.dirname(target);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const obj = {};
    for (const [k, v] of this.knowledgeCache.entries()) obj[k] = v;
    fs.writeFileSync(target, JSON.stringify(obj, null, 2), 'utf8');
    console.log(`💾 知识库已保存：${target}`);
    return target;
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default KnowledgeFetcher;
