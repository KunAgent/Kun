#!/usr/bin/env node
import crypto from 'crypto';

/**
 * Delta 知识提炼器
 * 只提炼变化，不整页吸收
 */
export class KnowledgeDeltaExtractor {
  fingerprint(item) {
    const base = `${item.title || ''}|${item.source || ''}|${item.publishDate || ''}`;
    return crypto.createHash('sha1').update(base).digest('hex');
  }

  normalize(item) {
    return {
      title: item.title || '',
      source: item.source || '',
      publishDate: item.publishDate || item.date || null,
      snippet: item.snippet || '',
      methodology: item.methodology || null,
      bestPractices: item.bestPractices || []
    };
  }

  extract(domain, incomingResults = [], previousDomainKnowledge = {}) {
    const prevResults = Array.isArray(previousDomainKnowledge?.sourceResults)
      ? previousDomainKnowledge.sourceResults
      : [];

    const prevMap = new Map();
    prevResults.forEach((r) => prevMap.set(this.fingerprint(this.normalize(r)), this.normalize(r)));

    const nextMap = new Map();
    incomingResults.forEach((r) => nextMap.set(this.fingerprint(this.normalize(r)), this.normalize(r)));

    const added = [];
    const updated = [];
    const removed = [];

    for (const [key, item] of nextMap.entries()) {
      if (!prevMap.has(key)) {
        added.push(item);
        continue;
      }

      const prev = prevMap.get(key);
      const changed = prev.snippet !== item.snippet || String(prev.publishDate || '') !== String(item.publishDate || '');
      if (changed) {
        updated.push({ before: prev, after: item });
      }
    }

    for (const [key, item] of prevMap.entries()) {
      if (!nextMap.has(key)) removed.push(item);
    }

    return {
      domain,
      extractedAt: new Date().toISOString(),
      stats: {
        previous: prevResults.length,
        current: incomingResults.length,
        added: added.length,
        updated: updated.length,
        removed: removed.length
      },
      added,
      updated,
      removed,
      summary: this.buildSummary(domain, added, updated, removed)
    };
  }

  buildSummary(domain, added, updated, removed) {
    return {
      domain,
      newMethods: added
        .map((r) => r.title)
        .slice(0, 5),
      updatedSignals: updated
        .map((r) => r.after.title)
        .slice(0, 5),
      obsoleteSignals: removed
        .map((r) => r.title)
        .slice(0, 5)
    };
  }
}

export default KnowledgeDeltaExtractor;
