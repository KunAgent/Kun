#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

/**
 * 方法漂移检测器
 * - 超过阈值天数未更新
 * - 用户反馈触发
 * - 模块连续修正触发
 */
export class MethodDriftDetector {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.historyFile = path.join(projectRoot, '.fbs', 'evolution-history.json');
    this.feedbackFile = path.join(projectRoot, '.fbs', 'evolution-feedback.json');
    this.defaultThresholdDays = Number(options.defaultThresholdDays || 30);
  }

  detect(domain, options = {}) {
    const now = options.now ? new Date(options.now) : new Date();
    const thresholdDays = Number(options.thresholdDays || this.defaultThresholdDays);

    const history = this.loadJsonSafe(this.historyFile, []);
    const feedback = this.loadJsonSafe(this.feedbackFile, []);

    const domainHistory = history
      .filter((h) => h.domain === domain)
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    const last = domainHistory[0] || null;
    const triggers = [];

    if (!last) {
      triggers.push({ type: 'never_evolved', reason: '该领域尚无进化记录' });
    } else {
      const days = (now.getTime() - new Date(last.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= thresholdDays) {
        triggers.push({ type: 'time_drift', reason: `距上次更新 ${days.toFixed(1)} 天` });
      }
    }

    const domainFeedback = feedback.filter((f) => f.domain === domain);
    const negative = domainFeedback.filter((f) => ['bad', 'too_old', 'not_mainstream'].includes(String(f.label || '').toLowerCase()));
    if (negative.length >= 2) {
      triggers.push({ type: 'negative_feedback', reason: `负向反馈 ${negative.length} 条` });
    }

    const correctiveSignals = Number(options.correctiveSignals || 0);
    if (correctiveSignals >= 3) {
      triggers.push({ type: 'corrective_signal', reason: `连续人工修正 ${correctiveSignals} 次` });
    }

    return {
      domain,
      shouldTrigger: triggers.length > 0,
      triggers,
      lastEvolutionAt: last?.timestamp || null,
      checkedAt: now.toISOString()
    };
  }

  loadJsonSafe(file, fallback) {
    if (!fs.existsSync(file)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fallback;
    }
  }
}

export default MethodDriftDetector;
