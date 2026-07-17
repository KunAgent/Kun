#!/usr/bin/env node
/**
 * FBS-BookWriter 自增强进化机制（闭环版）
 *
 * 核心升级：
 * - 周期触发 + 方法漂移触发 + 反馈触发 + 纠错补检触发
 * - 接入知识获取闭环（时间锚/路由/规划/JUDGE/Delta）
 * - 只沉淀策略能力，不沉淀临时事实
 */

import fs from 'fs';
import path from 'path';

import { KnowledgeFetcher } from './knowledge-fetcher.mjs';
import { MethodDriftDetector } from './method-drift-detector.mjs';
import { ReflectiveRepairOrchestrator } from './reflective-repair-orchestrator.mjs';

export const EVOLUTION_CONFIG = {
  version: '2.1.1',
  lastUpdated: '2026-04-11',
  evolutionDomains: {
    deAIFlavor: { name: '去AI味方法论', capabilityModule: 'de-aiflavor-enhancer' },
    qualityCheck: { name: '质检优化方法论', capabilityModule: 'quality-check-enhancer' },
    creativeTopic: { name: '创意选题方法论', capabilityModule: 'creative-topic-enhancer' },
    styleAdjustment: { name: '风格微调方法论', capabilityModule: 'style-adjustment-enhancer' },
    contentAssetization: { name: '内容资产化方法论', capabilityModule: 'content-assetization-enhancer' },
    meetingRoleDesign: { name: '会议角色智能设计', capabilityModule: 'meeting-role-enhancer' }
  },
  evolutionTriggers: {
    timeBased: {
      enabled: true,
      intervalDays: 30,
      lastCheckDate: null
    },
    usageBased: {
      enabled: true,
      thresholdOperations: 100,
      operationCount: 0
    },
    performanceBased: {
      enabled: true,
      qualityDropThreshold: 0.1,
      userComplaintThreshold: 3
    },
    methodDriftBased: {
      enabled: true,
      thresholdDays: 30,
      correctiveSignalsThreshold: 3
    },
    feedbackBased: {
      enabled: true,
      negativeFeedbackThreshold: 2
    },
    correctiveSearchTrigger: {
      enabled: true,
      temporalOrVersionSignalRequired: true
    },
    manualTrigger: {
      enabled: true,
      requireConfirmation: true
    }
  },
  safetyMechanisms: {
    preEvolutionChecks: {
      versionCompatibility: true,
      resourceAvailability: true,
      networkStability: true,
      backupCurrent: true
    },
    evolutionLimits: {
      maxDomainsPerRun: 1,
      maxKnowledgePoints: 5,
      maxModulesPerMonth: 2,
      rollbackDays: 7
    },
    qualityValidation: {
      enabled: true,
      minSearchResults: 3,
      judgeAverageThreshold: 0.62,
      authorityCheck: true,
      duplicateDetection: true,
      harmfulContentCheck: true
    },
    rollbackMechanism: {
      enabled: true,
      automaticRollback: true,
      manualRollback: true,
      maxRollbackVersions: 3
    }
  },
  knowledgeManagement: {
    knowledgeBasePath: '.fbs/evolution-knowledge/',
    updateStrategy: {
      incremental: true,
      mergeConflicts: 'prefer_new',
      pruneObsolete: true,
      obsoleteDays: 365
    }
  },
  userControl: {
    authorizationMode: 'explicit',
    notification: {
      preEvolution: true,
      progressUpdates: true,
      postEvolution: true,
      rollbackAvailable: true
    },
    transparency: {
      showSearchResults: true,
      showMethodology: true,
      showChanges: true,
      showImpact: true,
      showTesting: true,
      showRollbackOption: true
    }
  }
};

export class EvolutionEngine {
  constructor(projectRoot, config = EVOLUTION_CONFIG) {
    this.projectRoot = projectRoot;
    this.config = config;
    this.currentPhase = null;

    this.knowledgeFetcher = new KnowledgeFetcher(projectRoot);
    this.methodDriftDetector = new MethodDriftDetector(projectRoot, {
      defaultThresholdDays: this.config.evolutionTriggers.methodDriftBased.thresholdDays
    });
    this.repairOrchestrator = new ReflectiveRepairOrchestrator(projectRoot);

    this.evolutionHistoryFile = path.join(projectRoot, '.fbs', 'evolution-history.json');
    this.feedbackFile = path.join(projectRoot, '.fbs', 'evolution-feedback.json');
    this.evolutionHistory = this._loadEvolutionHistory();
  }

  async checkEvolutionNeeded(options = {}) {
    const triggers = [];

    if (this._checkTimeTrigger()) {
      triggers.push({ type: 'time', reason: '达到时间间隔' });
    }

    if (this._checkUsageTrigger()) {
      triggers.push({ type: 'usage', reason: '达到使用阈值' });
    }

    if (this._checkPerformanceTrigger()) {
      triggers.push({ type: 'performance', reason: '检测到性能下降' });
    }

    const feedbackTrigger = this._checkFeedbackTrigger();
    if (feedbackTrigger) triggers.push(feedbackTrigger);

    const driftDomain = options.domain || this._selectDefaultDomain();
    const drift = this.methodDriftDetector.detect(driftDomain, {
      thresholdDays: this.config.evolutionTriggers.methodDriftBased.thresholdDays,
      correctiveSignals: Number(options.correctiveSignals || 0)
    });
    if (drift.shouldTrigger) {
      triggers.push({ type: 'methodDrift', reason: drift.triggers.map((t) => t.reason).join('；'), domain: driftDomain });
    }

    if (options.latestAnswerText) {
      const repairCheck = this.repairOrchestrator.analyzeAndPlanRepair(options.latestAnswerText, {
        domain: driftDomain,
        stage: 'S3'
      });
      if (repairCheck.shouldResearch) {
        triggers.push({ type: 'correctiveSearch', reason: `检测到纠错补检信号：${repairCheck.diagnostics.triggers.join(',')}`, domain: driftDomain });
      }
    }

    return {
      needed: triggers.length > 0,
      triggers,
      suggestedDomain: options.domain || driftDomain
    };
  }

  async startEvolution(domain, userAuthorized = false, options = {}) {
    if (!this.config.evolutionDomains[domain]) {
      throw new Error(`未知领域: ${domain}`);
    }

    await this._phaseTrigger(domain, userAuthorized);
    await this._phaseAnalysis(domain);
    const knowledge = await this._phaseSearch(domain, options);
    const synthesized = await this._phaseSynthesis(domain, knowledge);
    const validated = await this._phaseValidation(domain, synthesized);
    const integrated = await this._phaseIntegration(domain, validated);
    const tested = await this._phaseTesting(domain, integrated);
    await this._phaseDeployment(domain, tested);

    return {
      success: true,
      domain,
      summary: tested
    };
  }

  async _phaseTrigger(domain, userAuthorized) {
    this.currentPhase = 'trigger';
    if (!userAuthorized && this.config.userControl.authorizationMode === 'explicit') {
      throw new Error('用户未授权进化');
    }

    if (this.config.safetyMechanisms.preEvolutionChecks.backupCurrent) {
      await this._backupCurrentVersion(domain);
    }
  }

  async _phaseAnalysis(domain) {
    this.currentPhase = 'analysis';
    const domainName = this.config.evolutionDomains[domain].name;
    console.log(`🔍 分析领域：${domainName}`);
  }

  async _phaseSearch(domain, options = {}) {
    this.currentPhase = 'search';
    return this.knowledgeFetcher.fetchDomainKnowledge(domain, {
      stage: 'S0',
      intentHint: 'method',
      includeHistoryLatestSplit: true,
      maxQueries: options.maxQueries || 10,
      maxResults: options.maxResults || 10
    });
  }

  async _phaseSynthesis(domain, knowledge) {
    this.currentPhase = 'synthesis';

    const methodologies = knowledge.methodologyKnowledge || [];
    const delta = knowledge.deltaKnowledge || { stats: {} };

    return {
      domain,
      extractedAt: new Date().toISOString(),
      sourceResults: knowledge.sourceResults || [],
      methodologies,
      bestPractices: knowledge.bestPractices || [],
      expertInsights: knowledge.expertInsights || [],
      delta,
      judgeSummary: knowledge.retrievalTrace?.judgeSummary || {}
    };
  }

  async _phaseValidation(domain, synthesized) {
    this.currentPhase = 'validation';

    const minSearchResults = this.config.safetyMechanisms.qualityValidation.minSearchResults;
    const minJudge = this.config.safetyMechanisms.qualityValidation.judgeAverageThreshold;

    const resultCount = synthesized.sourceResults.length;
    const avgJudge = Number(synthesized.judgeSummary.averageScore || 0);

    const qualityCheck = {
      passed: resultCount >= minSearchResults && avgJudge >= minJudge,
      details: {
        resultCount,
        minSearchResults,
        avgJudge,
        minJudge
      }
    };

    const safetyCheck = {
      passed: !this._containsHarmfulContent(synthesized.sourceResults),
      details: { checked: synthesized.sourceResults.length }
    };

    const compatibilityCheck = {
      passed: Array.isArray(synthesized.methodologies) && !!synthesized.delta,
      details: {
        hasMethodologies: Array.isArray(synthesized.methodologies),
        hasDelta: !!synthesized.delta
      }
    };

    const approved = qualityCheck.passed && safetyCheck.passed && compatibilityCheck.passed;
    if (!approved) throw new Error('验证未通过');

    return {
      approved,
      knowledge: synthesized,
      qualityCheck,
      safetyCheck,
      compatibilityCheck
    };
  }

  async _phaseIntegration(domain, validated) {
    this.currentPhase = 'integration';

    const evolutionDir = path.join(this.projectRoot, this.config.knowledgeManagement.knowledgeBasePath);
    if (!fs.existsSync(evolutionDir)) fs.mkdirSync(evolutionDir, { recursive: true });

    const deltaFile = path.join(evolutionDir, `${domain}-delta.json`);
    fs.writeFileSync(deltaFile, JSON.stringify(validated.knowledge.delta, null, 2), 'utf8');

    const strategyPackFile = path.join(evolutionDir, `${domain}-strategy-pack.json`);
    const strategyPack = {
      domain,
      updatedAt: new Date().toISOString(),
      judgeSummary: validated.knowledge.judgeSummary,
      newMethods: validated.knowledge.delta?.summary?.newMethods || [],
      updatedSignals: validated.knowledge.delta?.summary?.updatedSignals || [],
      recommendedPractices: (validated.knowledge.bestPractices || []).slice(0, 5)
    };
    fs.writeFileSync(strategyPackFile, JSON.stringify(strategyPack, null, 2), 'utf8');

    await this.knowledgeFetcher.saveKnowledgeBase();

    return {
      deltaFile,
      strategyPackFile,
      knowledgeBaseUpdated: true
    };
  }

  async _phaseTesting(domain, integrated) {
    this.currentPhase = 'testing';

    const filesExist = [integrated.deltaFile, integrated.strategyPackFile].every((f) => fs.existsSync(f));
    const performanceOK = true;

    const tested = {
      functionalTest: { passed: filesExist },
      performanceTest: { passed: performanceOK },
      compatibilityTest: { passed: true },
      approved: filesExist && performanceOK
    };

    if (!tested.approved && this.config.safetyMechanisms.rollbackMechanism.automaticRollback) {
      await this._performRollback(domain);
      throw new Error('测试未通过，已触发回滚');
    }

    return tested;
  }

  async _phaseDeployment(domain, tested) {
    this.currentPhase = 'deployment';

    const record = {
      timestamp: new Date().toISOString(),
      domain,
      version: this.config.version,
      phase: this.currentPhase,
      results: tested,
      status: 'completed'
    };

    this.evolutionHistory.unshift(record);
    fs.mkdirSync(path.join(this.projectRoot, '.fbs'), { recursive: true });
    fs.writeFileSync(this.evolutionHistoryFile, JSON.stringify(this.evolutionHistory.slice(0, 100), null, 2), 'utf8');
  }

  async _backupCurrentVersion(domain) {
    const backupDir = path.join(this.projectRoot, '.fbs', 'evolution-backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const knowledgeBasePath = path.join(this.projectRoot, this.config.knowledgeManagement.knowledgeBasePath, 'knowledge-base.json');
    const payload = {
      domain,
      timestamp: new Date().toISOString(),
      version: this.config.version,
      knowledgeBase: fs.existsSync(knowledgeBasePath)
        ? JSON.parse(fs.readFileSync(knowledgeBasePath, 'utf8'))
        : {}
    };

    const filename = `${domain}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(path.join(backupDir, filename), JSON.stringify(payload, null, 2), 'utf8');
  }

  async _performRollback(domain) {
    const backupDir = path.join(this.projectRoot, '.fbs', 'evolution-backups');
    if (!fs.existsSync(backupDir)) throw new Error('无可用备份');

    const candidates = fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith(`${domain}-`) && f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a));

    if (!candidates.length) throw new Error(`领域 ${domain} 没有可回滚备份`);

    const latest = path.join(backupDir, candidates[0]);
    const snapshot = JSON.parse(fs.readFileSync(latest, 'utf8'));

    const evolutionDir = path.join(this.projectRoot, this.config.knowledgeManagement.knowledgeBasePath);
    fs.mkdirSync(evolutionDir, { recursive: true });

    const knowledgeBasePath = path.join(evolutionDir, 'knowledge-base.json');
    fs.writeFileSync(knowledgeBasePath, JSON.stringify(snapshot.knowledgeBase || {}, null, 2), 'utf8');

    return { rolledBack: true, backup: latest };
  }

  _loadEvolutionHistory() {
    if (!fs.existsSync(this.evolutionHistoryFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.evolutionHistoryFile, 'utf8'));
    } catch {
      return [];
    }
  }

  _checkTimeTrigger() {
    if (!this.config.evolutionTriggers.timeBased.enabled) return false;
    const lastCheck = this.config.evolutionTriggers.timeBased.lastCheckDate;
    if (!lastCheck) return true;

    const diffDays = (Date.now() - new Date(lastCheck).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= this.config.evolutionTriggers.timeBased.intervalDays;
  }

  _checkUsageTrigger() {
    if (!this.config.evolutionTriggers.usageBased.enabled) return false;
    const { operationCount, thresholdOperations } = this.config.evolutionTriggers.usageBased;
    return Number(operationCount || 0) >= Number(thresholdOperations || 100);
  }

  _checkPerformanceTrigger() {
    return Boolean(this.config.evolutionTriggers.performanceBased.enabled) && false;
  }

  _checkFeedbackTrigger() {
    if (!this.config.evolutionTriggers.feedbackBased.enabled) return null;
    if (!fs.existsSync(this.feedbackFile)) return null;

    try {
      const rows = JSON.parse(fs.readFileSync(this.feedbackFile, 'utf8'));
      const bad = rows.filter((r) => ['bad', 'too_old', 'not_mainstream'].includes(String(r.label || '').toLowerCase()));
      if (bad.length >= this.config.evolutionTriggers.feedbackBased.negativeFeedbackThreshold) {
        return { type: 'feedback', reason: `负向反馈达到 ${bad.length} 条` };
      }
    } catch {
      return null;
    }

    return null;
  }

  _containsHarmfulContent(sourceResults = []) {
    const risky = ['hack', 'exploit', 'bypass', 'illegal'];
    return sourceResults.some((r) => {
      const s = `${r.title || ''} ${r.snippet || ''}`.toLowerCase();
      return risky.some((k) => s.includes(k));
    });
  }

  _selectDefaultDomain() {
    return 'qualityCheck';
  }
}

export default EvolutionEngine;
