#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

/**
 * 时间锚解析器
 * - 优先复用近期时间锚
 * - 可从 search-ledger.jsonl 的时间戳检索中提取锚点
 * - 回退到宿主当前时间
 */
export class TimeAnchorResolver {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.anchorFile = path.join(projectRoot, '.fbs', 'time-anchor.json');
    this.ledgerFile = path.join(projectRoot, '.fbs', 'search-ledger.jsonl');
    this.defaultTTLMinutes = Number(options.defaultTTLMinutes || 60);
  }

  resolve(options = {}) {
    const ttlMinutes = Number(options.ttlMinutes || this.defaultTTLMinutes);
    const forceRefresh = Boolean(options.forceRefresh);

    const existing = this.readAnchor();
    if (!forceRefresh && existing && !this.isExpired(existing, ttlMinutes)) {
      return { ...existing, reused: true };
    }

    const fromLedger = this.resolveFromLedger(ttlMinutes);
    if (fromLedger) {
      this.writeAnchor(fromLedger);
      return { ...fromLedger, reused: false };
    }

    const hostNow = options.now ? new Date(options.now) : new Date();
    const anchor = this.buildAnchor({
      sourceType: 'host',
      sourceName: 'host_current_time',
      date: hostNow,
      confidence: 0.85,
      stage: options.stage || 'unknown'
    });
    this.writeAnchor(anchor);
    return { ...anchor, reused: false };
  }

  readAnchor() {
    if (!fs.existsSync(this.anchorFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.anchorFile, 'utf8'));
    } catch {
      return null;
    }
  }

  isExpired(anchor, ttlMinutes) {
    if (!anchor?.anchoredAt) return true;
    const anchoredAt = new Date(anchor.anchoredAt).getTime();
    if (Number.isNaN(anchoredAt)) return true;
    return Date.now() - anchoredAt > ttlMinutes * 60 * 1000;
  }

  resolveFromLedger(ttlMinutes) {
    if (!fs.existsSync(this.ledgerFile)) return null;
    const lines = fs.readFileSync(this.ledgerFile, 'utf8').split(/\r?\n/).filter(Boolean);
    const now = Date.now();
    const hints = ['今天日期', '当前年月日', '今天是哪年哪月哪日', '当前日期', '当前年月'];

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const query = String(row.query || row.keyword || '');
        const ts = new Date(row.timestamp || row.at || row.createdAt || 0).getTime();
        if (!ts || Number.isNaN(ts)) continue;
        if (now - ts > ttlMinutes * 60 * 1000) continue;
        const isTimestampRow = row.yearSourceConfirmed === true || String(row.s0Dimension || '').toLowerCase() === 'timestampcheck' || hints.some((h) => query.includes(h));
        if (!isTimestampRow) continue;

        return this.buildAnchor({
          sourceType: 'web',
          sourceName: row.source || row.engine || 'search-ledger',
          date: new Date(ts),
          confidence: 0.92,
          stage: row.stage || row.workflowStage || 'S0'
        });
      } catch {
        // ignore invalid jsonl line
      }
    }

    return null;
  }

  buildAnchor({ sourceType, sourceName, date, confidence, stage }) {
    const d = date instanceof Date ? date : new Date(date);
    const anchoredAt = d.toISOString();
    const year = d.getFullYear();

    return {
      anchoredAt,
      dateText: `${year}年${d.getMonth() + 1}月${d.getDate()}日`,
      sourceType,
      sourceName,
      confidence,
      stage,
      expiresAt: new Date(d.getTime() + this.defaultTTLMinutes * 60 * 1000).toISOString(),
      relativeTimeTokens: this.getRelativeTimeTokens(year)
    };
  }

  getRelativeTimeTokens(year) {
    return [
      '最新',
      '当前',
      '近三年',
      '最近发布',
      `${year}年最新`,
      `${year - 1}-${year}趋势`
    ];
  }

  writeAnchor(anchor) {
    const dir = path.dirname(this.anchorFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.anchorFile, JSON.stringify(anchor, null, 2), 'utf8');
  }
}

export default TimeAnchorResolver;
