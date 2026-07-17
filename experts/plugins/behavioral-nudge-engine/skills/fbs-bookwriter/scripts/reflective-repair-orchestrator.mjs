#!/usr/bin/env node
import { SearchQueryPlanner } from './search-query-planner.mjs';

/**
 * 反思式纠错编排器
 * - 判断是否必须补检
 * - 生成补检计划
 */
export class ReflectiveRepairOrchestrator {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.queryPlanner = new SearchQueryPlanner(projectRoot, options);
  }

  analyzeAndPlanRepair(text, options = {}) {
    const diagnostics = this.detectIssues(text, options);
    const shouldResearch = diagnostics.triggers.length > 0;

    let researchPlan = null;
    if (shouldResearch) {
      researchPlan = this.queryPlanner.buildPlan(
        options.domainConfig || { name: options.domain || 'method' },
        {
          stage: options.stage || 'S3',
          intentHint: options.intentHint || diagnostics.intentHint,
          taskDescription: options.taskDescription || text.slice(0, 120),
          baseKeywords: diagnostics.focusKeywords,
          includeHistoryLatestSplit: diagnostics.hasMethodDriftSignal,
          maxQueries: options.maxQueries || 8
        }
      );
    }

    return {
      shouldResearch,
      diagnostics,
      researchPlan,
      rewriteRule: shouldResearch
        ? '仅改写受影响片段，必须附修正依据'
        : '可直接微调措辞，不触发补检'
    };
  }

  detectIssues(text, options = {}) {
    const normalized = String(text || '');
    const triggers = [];

    const temporalSignal = /(最新|当前|近年来|最近|发布|更新)/.test(normalized);
    if (temporalSignal) triggers.push('temporal_signal');

    const hasVersionOrDate = /(v\d+\.\d+|\d{4}年|\d{4}-\d{2}-\d{2}|Q[1-4])/.test(normalized);
    if (hasVersionOrDate) triggers.push('version_or_date_signal');

    const uncertaintySignal = /(不确定|可能|似乎|印象中|估计|应该是)/.test(normalized);
    if (uncertaintySignal) triggers.push('uncertainty_signal');

    const hasNumberFact = /(\d+(\.\d+)?%|\d+万|\d+亿|同比|增长率)/.test(normalized);
    if (hasNumberFact) triggers.push('numeric_fact_signal');

    const methodRefreshSignal = /(更先进|最佳实践|换一种方法|优化方法|主流做法)/.test(normalized);
    if (methodRefreshSignal) triggers.push('method_refresh_signal');

    const yearEcho = this.detectYearEcho(normalized);
    if (yearEcho.detected) triggers.push('year_echo_signal');

    const focusKeywords = this.extractFocusKeywords(normalized, options.maxKeywords || 6);
    const intentHint = methodRefreshSignal ? 'method' : (hasNumberFact ? 'fact' : 'fallback');

    return {
      triggers,
      hasMethodDriftSignal: methodRefreshSignal || yearEcho.detected,
      yearEcho,
      focusKeywords,
      intentHint
    };
  }

  detectYearEcho(text) {
    const years = text.match(/20\d{2}/g) || [];
    if (!years.length) return { detected: false, dominantYear: null, count: 0 };

    const bucket = years.reduce((acc, y) => {
      acc[y] = (acc[y] || 0) + 1;
      return acc;
    }, {});

    let dominantYear = null;
    let maxCount = 0;
    for (const [y, c] of Object.entries(bucket)) {
      if (c > maxCount) {
        dominantYear = y;
        maxCount = c;
      }
    }

    return {
      detected: maxCount >= 2,
      dominantYear,
      count: maxCount,
      bucket
    };
  }

  extractFocusKeywords(text, max = 6) {
    const words = text
      .replace(/[，。！？、；：,.!?;:()\[\]{}"'“”‘’]/g, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2);

    const stop = new Set(['我们', '这个', '那个', '可以', '需要', '进行', '一个', '已经', '以及', '如果']);
    const freq = new Map();
    for (const w of words) {
      if (stop.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }

    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([k]) => k);
  }
}

export default ReflectiveRepairOrchestrator;
