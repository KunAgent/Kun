#!/usr/bin/env node
/**
 * 智能记忆核心系统
 * 
 * 架构原则：
 * 1. 千人千面：代码实现的特征与用户个性化数据完全解耦
 * 2. 智能记忆：可重置、可脱钩、有应用边界
 * 3. 整理分析：WorkBuddy升级适应性，里程碑记录
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import {
  dedupeAcceptedSuggestions,
  dedupeForbiddenRecommendations,
  dedupeRejectedSuggestions,
} from './lib/memory-preference-dedupe.mjs';

const HOST_MEMORY_FILE_PATTERN = /_(?:memory|memery)\.md$/i;

function listHostMemoryDirs(workbuddyDir) {
  const candidates = [
    path.join(workbuddyDir, 'memory'),
    path.join(workbuddyDir, 'memery'),
  ];
  const seen = new Set();
  return candidates.filter((dir) => {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

function collectHostMemoryFiles(workbuddyDir) {
  const claimed = new Set();
  return listHostMemoryDirs(workbuddyDir).flatMap((dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((file) => HOST_MEMORY_FILE_PATTERN.test(file))
      .filter((file) => {
        const key = file.toLowerCase().replace(/_(?:memory|memery)\.md$/i, '');
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      })
      .map((file) => ({ dir, file }));
  });
}


/**
 * 智能记忆核心类
 */
export class SmartMemoryCore {

  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.memoryDir = path.join(projectRoot, '.fbs', 'smart-memory');
    this.preferenceProfileFile = path.join(this.memoryDir, 'user-preference-profile.json');
    this.preferenceHistoryDir = path.join(this.memoryDir, 'preference-history');
    this.options = {

      enabled: options.enabled !== false,
      profileIsolation: options.profileIsolation !== false,
      learningRate: options.learningRate || 0.1,
      memoryRetentionDays: options.memoryRetentionDays || 90,
      profileId: options.profileId || this.generateProfileId(),
      ...options
    };
    
    // 初始化记忆结构
    this.memory = {
      version: '2.1.1',
      profileId: this.options.profileId,

      createdAt: new Date().toISOString(),
      lastUpdated: null,
      
      // 用户画像层（解耦的核心）
      userProfile: {
        basicInfo: null,
        workContext: null,
        preferences: null,
        history: null
      },
      
      // 学习层（代码实现的特征）
      learnedFeatures: {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      },
      
      // 应用层（千人千面的实现）
      applicationLayer: {
        enabledFeatures: [],
        disabledFeatures: [],
        featureWeights: {},
        adaptationMode: 'balanced' // conservative, balanced, aggressive
      },

      // 检索画像层（v2.1.1）：只沉淀检索策略经验，不沉淀临时事实
      retrievalProfile: {
        sourceTypePreference: {
          cnAuthority: 0.4,
          officialDocs: 0.3,
          industryMedia: 0.2,
          communitySignals: 0.1
        },
        qualityPriority: {
          latest: 0.3,
          rigor: 0.3,
          actionable: 0.2,
          cnFirst: 0.2
        },
        stableDomains: [],
        effectiveQueryPatterns: [],
        antiPatterns: [],
        lastUpdated: null
      },
      
      // 整理分析层（WorkBuddy适应性）
      organizationLayer: {
        milestones: [],
        workbuddyChanges: [],
        versionCompatibility: {},
        cleanupTasks: []
      },
      
      // 元数据层
      metadata: {
        totalLearningSessions: 0,
        lastReset: null,
        lastDecoupling: null,
        memorySize: 0
      }
    };
    
    this.ensureMemoryDir();
    this.ensurePreferenceProfile();
  }

  /**
   * 生成唯一的用户画像 ID
   */
  generateProfileId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 确保记忆目录存在
   */
  ensureMemoryDir() {
    if (!fs.existsSync(this.memoryDir)) {
      fs.mkdirSync(this.memoryDir, { recursive: true });
    }
    if (!fs.existsSync(this.preferenceHistoryDir)) {
      fs.mkdirSync(this.preferenceHistoryDir, { recursive: true });
    }
  }


  /**
   * 默认用户偏好档案（R-12）
   */
  getDefaultPreferenceProfile() {
    return {
      _schema: 'fbs-user-preference-profile-v1',
      version: '2.1.1',
      updatedAt: new Date().toISOString(),
      writingStyle: {
        tone: 'professional',
        formality: 'medium',
        aiFlavorTolerance: 'low',
        verbosity: 'medium'
      },
      interaction: {
        defaultMode: 'interactive',
        collaboration: 'single_agent',
        recommendationStyle: 'progressive'
      },
      output: {
        showDraftFirst: true,
        preferredFormats: ['markdown']
      },
      memoryPolicy: {
        allowAutoLearning: true,
        requireVisibleHintBeforeApply: true
      },
      learningState: {
        isFrozen: false,
        frozenAt: null,
        freezeReason: '',
        lastRollbackAt: null,
        lastRollbackSource: null
      },
      acceptedSuggestions: [],
      rejectedSuggestions: [],
      forbiddenRecommendations: [],
      feedbackSignals: {
        acceptCount: 0,
        rejectCount: 0
      }

    };
  }

  /**
   * 确保偏好档案存在
   */
  ensurePreferenceProfile() {
    if (fs.existsSync(this.preferenceProfileFile)) {
      return;
    }

    const profile = this.getDefaultPreferenceProfile();
    fs.writeFileSync(this.preferenceProfileFile, JSON.stringify(profile, null, 2), 'utf8');
  }

  /**
   * 读取偏好档案
   */
  loadPreferenceProfile() {
    this.ensurePreferenceProfile();

    try {
      const raw = fs.readFileSync(this.preferenceProfileFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      const fallback = this.getDefaultPreferenceProfile();
      fs.writeFileSync(this.preferenceProfileFile, JSON.stringify(fallback, null, 2), 'utf8');
      return fallback;
    }
  }

  /**
   * 保存偏好档案
   */
  savePreferenceProfile(profile) {
    const merged = {
      ...this.getDefaultPreferenceProfile(),
      ...profile,
      writingStyle: {
        ...this.getDefaultPreferenceProfile().writingStyle,
        ...(profile?.writingStyle || {})
      },
      interaction: {
        ...this.getDefaultPreferenceProfile().interaction,
        ...(profile?.interaction || {})
      },
      output: {
        ...this.getDefaultPreferenceProfile().output,
        ...(profile?.output || {})
      },
      memoryPolicy: {
        ...this.getDefaultPreferenceProfile().memoryPolicy,
        ...(profile?.memoryPolicy || {})
      },
      rejectedSuggestions: Array.isArray(profile?.rejectedSuggestions) ? profile.rejectedSuggestions : [],
      forbiddenRecommendations: Array.isArray(profile?.forbiddenRecommendations) ? profile.forbiddenRecommendations : [],
      feedbackSignals: {
        ...this.getDefaultPreferenceProfile().feedbackSignals,
        ...(profile?.feedbackSignals || {})
      },
      updatedAt: new Date().toISOString()
    };

    merged.forbiddenRecommendations = dedupeForbiddenRecommendations(merged.forbiddenRecommendations);
    merged.rejectedSuggestions = dedupeRejectedSuggestions(merged.rejectedSuggestions);
    merged.acceptedSuggestions = dedupeAcceptedSuggestions(merged.acceptedSuggestions || []);

    fs.writeFileSync(this.preferenceProfileFile, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }

  /**
   * ================================
   * 千人千面架构：用户数据与代码特征解耦
   * ================================
   */

  /**
   * 用户画像层：只存储用户原始数据
   */
  updateUserProfile(profileData) {
    if (!this.options.profileIsolation) return;
    
    this.memory.userProfile = {
      ...this.memory.userProfile,
      ...profileData,
      updatedAt: new Date().toISOString()
    };
    
    this.saveMemory();
  }

  /**
   * 更新用户偏好档案（R-12）
   */
  updateUserPreferenceProfile(profileDelta = {}) {
    const current = this.loadPreferenceProfile();

    const merged = this.savePreferenceProfile({
      ...current,
      ...profileDelta,
      writingStyle: {
        ...(current.writingStyle || {}),
        ...(profileDelta.writingStyle || {})
      },
      interaction: {
        ...(current.interaction || {}),
        ...(profileDelta.interaction || {})
      },
      output: {
        ...(current.output || {}),
        ...(profileDelta.output || {})
      },
      memoryPolicy: {
        ...(current.memoryPolicy || {}),
        ...(profileDelta.memoryPolicy || {})
      }
    });

    this.memory.userProfile = {
      ...this.memory.userProfile,
      preferences: {
        mode: merged.interaction?.defaultMode || null,
        collaboration: merged.interaction?.collaboration || null,
        output: merged.output?.showDraftFirst ? 'show_first' : 'direct_write',
        tone: merged.writingStyle?.tone || null,
        updatedAt: merged.updatedAt
      },
      updatedAt: new Date().toISOString()
    };

    this.saveMemory();

    return {
      success: true,
      profile: merged
    };
  }

  /**
   * 记录拒绝建议（用于后续偏好学习）
   */
  recordRejectedSuggestion(suggestion, reason = '') {
    const profile = this.loadPreferenceProfile();
    const next = {
      ...profile,
      rejectedSuggestions: [...(profile.rejectedSuggestions || [])]
    };

    if (suggestion) {
      next.rejectedSuggestions.unshift({
        suggestion,
        reason,
        timestamp: new Date().toISOString()
      });
    }

    next.rejectedSuggestions = next.rejectedSuggestions.slice(0, 200);
    next.feedbackSignals = {
      ...(profile.feedbackSignals || {}),
      rejectCount: (profile.feedbackSignals?.rejectCount || 0) + 1
    };

    const saved = this.savePreferenceProfile(next);

    return {
      success: true,
      profile: saved
    };
  }

  /**
   * 添加禁推建议项（例如：以后不要推荐X）
   */
  addForbiddenRecommendation(item) {
    const text = String(item || '').trim();
    if (!text) {
      return {
        success: false,
        message: '禁推项不能为空'
      };
    }

    const profile = this.loadPreferenceProfile();
    const set = new Set([...(profile.forbiddenRecommendations || []), text]);
    const saved = this.savePreferenceProfile({
      ...profile,
      forbiddenRecommendations: [...set]
    });

    return {
      success: true,
      profile: saved
    };
  }

  /**
   * 将偏好档案摘要同步到主记忆，方便跨模块读取当前偏好状态
   */
  syncPreferenceSummaryToMemory(profile) {
    this.memory.userProfile = {
      ...this.memory.userProfile,
      preferences: {
        mode: profile?.interaction?.defaultMode || null,
        collaboration: profile?.interaction?.collaboration || null,
        output: profile?.output?.showDraftFirst ? 'show_first' : 'direct_write',
        tone: profile?.writingStyle?.tone || null,
        learningFrozen: Boolean(profile?.learningState?.isFrozen),
        updatedAt: profile?.updatedAt || new Date().toISOString()
      },
      updatedAt: new Date().toISOString()
    };

    this.saveMemory();
  }

  sanitizePreferenceSnapshotLabel(label = 'manual') {
    const normalized = String(label || 'manual')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
      .replace(/\s+/g, '-');
    return normalized || 'manual';
  }

  createPreferenceSnapshot(label = 'manual', extra = {}) {
    this.ensureMemoryDir();
    fs.mkdirSync(this.preferenceHistoryDir, { recursive: true });
    const displayLabel = String(label || 'manual').trim() || 'manual';

    const safeLabel = this.sanitizePreferenceSnapshotLabel(displayLabel);
    const createdAt = new Date().toISOString();
    const snapshotId = `${createdAt.replace(/[:.]/g, '-')}-${safeLabel}`;
    const snapshotPath = path.join(this.preferenceHistoryDir, `${snapshotId}.json`);
    const snapshot = {
      snapshotId,
      label: displayLabel,
      createdAt,
      reason: extra.reason || '',
      profile: this.loadPreferenceProfile()
    };

    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');

    return {
      success: true,
      snapshotId,
      snapshotPath,
      createdAt
    };
  }

  listPreferenceSnapshots(options = {}) {
    this.ensureMemoryDir();
    const limit = Number(options.limit || 20);
    if (!fs.existsSync(this.preferenceHistoryDir)) {
      return [];
    }

    return fs.readdirSync(this.preferenceHistoryDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const fullPath = path.join(this.preferenceHistoryDir, file);
        try {
          const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          return {
            snapshotId: raw.snapshotId || file.replace(/\.json$/, ''),
            label: raw.label || 'manual',
            createdAt: raw.createdAt || fs.statSync(fullPath).mtime.toISOString(),
            reason: raw.reason || '',
            frozen: Boolean(raw.profile?.learningState?.isFrozen)
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  }

  resolvePreferenceSnapshotFile(snapshotId) {
    if (!snapshotId || !fs.existsSync(this.preferenceHistoryDir)) {
      return null;
    }

    const normalized = String(snapshotId).trim().replace(/\.json$/i, '');
    const candidates = fs.readdirSync(this.preferenceHistoryDir)
      .filter((file) => file.endsWith('.json'))
      .sort();

    const exact = candidates.find((file) => file.replace(/\.json$/i, '') === normalized);
    if (exact) {
      return path.join(this.preferenceHistoryDir, exact);
    }

    const partial = candidates.find((file) => file.replace(/\.json$/i, '').startsWith(normalized));
    return partial ? path.join(this.preferenceHistoryDir, partial) : null;
  }

  recordAcceptedSuggestion(suggestion, reason = '') {
    const profile = this.loadPreferenceProfile();
    const next = {
      ...profile,
      acceptedSuggestions: [...(profile.acceptedSuggestions || [])]
    };

    if (suggestion) {
      next.acceptedSuggestions.unshift({
        suggestion,
        reason,
        timestamp: new Date().toISOString()
      });
    }

    next.acceptedSuggestions = next.acceptedSuggestions.slice(0, 200);
    next.feedbackSignals = {
      ...(profile.feedbackSignals || {}),
      acceptCount: (profile.feedbackSignals?.acceptCount || 0) + 1
    };

    const saved = this.savePreferenceProfile(next);
    this.syncPreferenceSummaryToMemory(saved);

    return {
      success: true,
      profile: saved
    };
  }

  freezePreferenceLearning(reason = '') {
    const snapshot = this.createPreferenceSnapshot('before-freeze', { reason });
    const profile = this.loadPreferenceProfile();
    const saved = this.savePreferenceProfile({
      ...profile,
      memoryPolicy: {
        ...(profile.memoryPolicy || {}),
        allowAutoLearning: false
      },
      learningState: {
        ...(profile.learningState || {}),
        isFrozen: true,
        frozenAt: new Date().toISOString(),
        freezeReason: reason || profile.learningState?.freezeReason || ''
      }
    });

    this.syncPreferenceSummaryToMemory(saved);

    return {
      success: true,
      snapshotId: snapshot.snapshotId,
      profile: saved
    };
  }

  unfreezePreferenceLearning(reason = '') {
    const snapshot = this.createPreferenceSnapshot('before-unfreeze', { reason });
    const profile = this.loadPreferenceProfile();
    const saved = this.savePreferenceProfile({
      ...profile,
      memoryPolicy: {
        ...(profile.memoryPolicy || {}),
        allowAutoLearning: true
      },
      learningState: {
        ...(profile.learningState || {}),
        isFrozen: false,
        frozenAt: null,
        freezeReason: ''
      }
    });

    this.syncPreferenceSummaryToMemory(saved);

    return {
      success: true,
      snapshotId: snapshot.snapshotId,
      reason,
      profile: saved
    };
  }

  rollbackPreferenceProfile(snapshotId) {
    const snapshotFile = this.resolvePreferenceSnapshotFile(snapshotId);
    if (!snapshotFile) {
      return {
        success: false,
        message: `未找到偏好快照: ${snapshotId}`
      };
    }

    const snapshotRaw = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    const backup = this.createPreferenceSnapshot('before-rollback', {
      reason: `rollback:${snapshotRaw.snapshotId || snapshotId}`
    });
    const sourceProfile = snapshotRaw.profile || snapshotRaw;
    const saved = this.savePreferenceProfile({
      ...sourceProfile,
      learningState: {
        ...(sourceProfile.learningState || {}),
        lastRollbackAt: new Date().toISOString(),
        lastRollbackSource: snapshotRaw.snapshotId || snapshotId
      }
    });

    this.syncPreferenceSummaryToMemory(saved);

    return {
      success: true,
      restoredFrom: snapshotRaw.snapshotId || snapshotId,
      backupSnapshotId: backup.snapshotId,
      profile: saved
    };
  }

  /**
   * 学习层：存储代码实现的学习特征
   */
  updateLearnedFeatures(features) {

    this.memory.learnedFeatures = {
      ...this.memory.learnedFeatures,
      ...features,
      updatedAt: new Date().toISOString()
    };
    
    this.saveMemory();
  }

  /**
   * 更新检索画像（仅策略经验）
   */
  updateRetrievalProfile(profileDelta = {}) {
    const current = this.memory.retrievalProfile || {};

    this.memory.retrievalProfile = {
      ...current,
      ...profileDelta,
      sourceTypePreference: {
        ...(current.sourceTypePreference || {}),
        ...(profileDelta.sourceTypePreference || {})
      },
      qualityPriority: {
        ...(current.qualityPriority || {}),
        ...(profileDelta.qualityPriority || {})
      },
      stableDomains: [...new Set([...(current.stableDomains || []), ...(profileDelta.stableDomains || [])])],
      effectiveQueryPatterns: [...new Set([...(current.effectiveQueryPatterns || []), ...(profileDelta.effectiveQueryPatterns || [])])],
      antiPatterns: [...new Set([...(current.antiPatterns || []), ...(profileDelta.antiPatterns || [])])],
      lastUpdated: new Date().toISOString()
    };

    this.saveMemory();

    return {
      success: true,
      profile: this.memory.retrievalProfile
    };
  }

  /**
   * 分层写回：短期态 / 项目态 / 长期能力态
   */
  routeMemoryWriteback({ layer, payload, filePath }) {
    const now = new Date().toISOString();
    const targetLayer = String(layer || '').toLowerCase();

    if (targetLayer === 'shortterm') {
      return {
        accepted: true,
        routedTo: 'session-state',
        note: '短期态不写入长期记忆',
        timestamp: now
      };
    }

    if (targetLayer === 'project') {
      return {
        accepted: true,
        routedTo: 'project-memory',
        filePath: filePath || '.fbs/search-ledger.jsonl',
        timestamp: now
      };
    }

    if (targetLayer === 'longterm') {
      const strategyPayload = payload || {};
      const merged = {
        stableDomains: Array.isArray(strategyPayload.stableDomains) ? strategyPayload.stableDomains : [],
        effectiveQueryPatterns: Array.isArray(strategyPayload.effectiveQueryPatterns) ? strategyPayload.effectiveQueryPatterns : [],
        antiPatterns: Array.isArray(strategyPayload.antiPatterns) ? strategyPayload.antiPatterns : []
      };
      this.updateRetrievalProfile(merged);
      return {
        accepted: true,
        routedTo: 'retrieval-profile',
        timestamp: now
      };
    }

    return {
      accepted: false,
      routedTo: 'unknown',
      timestamp: now
    };
  }

  /**
   * 应用层：千人千面的实现
   * 这是代码根据特征进行适配的地方，与用户数据无关
   */
  adaptContent(content, context = {}) {
    if (!this.options.enabled) return content;
    
    let adapted = content;
    const adaptationLog = [];
    
    // 获取应用配置
    const appConfig = this.memory.applicationLayer;
    
    // 1. 词汇适配（基于学习特征）
    if (appConfig.enabledFeatures.includes('vocabulary')) {
      const adaptedContent = this.applyVocabularyAdaptation(
        content,
        this.memory.learnedFeatures.vocabulary,
        appConfig.featureWeights.vocabulary || 1.0
      );
      adapted = adaptedContent.content;
      adaptationLog.push(...adaptedContent.logs);
    }
    
    // 2. 句式适配
    if (appConfig.enabledFeatures.includes('sentenceStructure')) {
      const adaptedContent = this.applySentenceAdaptation(
        content,
        this.memory.learnedFeatures.sentenceStructure,
        appConfig.featureWeights.sentenceStructure || 1.0
      );
      adapted = adaptedContent.content;
      adaptationLog.push(...adaptedContent.logs);
    }
    
    // 3. 语气适配
    if (appConfig.enabledFeatures.includes('tone')) {
      const adaptedContent = this.applyToneAdaptation(
        content,
        this.memory.learnedFeatures.tone,
        appConfig.featureWeights.tone || 1.0
      );
      adapted = adaptedContent.content;
      adaptationLog.push(...adaptedContent.logs);
    }
    
    // 4. 格式适配
    if (appConfig.enabledFeatures.includes('formatting')) {
      const adaptedContent = this.applyFormattingAdaptation(
        content,
        this.memory.learnedFeatures.formatting,
        appConfig.featureWeights.formatting || 1.0
      );
      adapted = adaptedContent.content;
      adaptationLog.push(...adaptedContent.logs);
    }
    
    return {
      content: adapted,
      logs: adaptationLog,
      adaptationMode: appConfig.adaptationMode
    };
  }

  /**
   * 词汇适配（代码实现）
   */
  applyVocabularyAdaptation(content, vocabularyFeatures, weight) {
    if (!vocabularyFeatures || Object.keys(vocabularyFeatures).length === 0) {
      return { content, logs: [] };
    }
    
    let adapted = content;
    const logs = [];
    let adaptationCount = 0;
    const maxAdaptations = Math.floor(20 * weight); // 最多替换20个词
    
    // 替换高频词为用户偏好词汇
    const { highFreqWords, preferredPhrases } = vocabularyFeatures;
    const topWords = Object.entries(highFreqWords || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([word]) => word);
    
    topWords.forEach(word => {
      if (adaptationCount >= maxAdaptations) return;
      if (preferredPhrases && preferredPhrases[word]) {
        adapted = adapted.split(word).join(preferredPhrases[word]);
        adaptationCount++;
        logs.push(`词汇替换: "${word}" → "${preferredPhrases[word]}"`);
      }
    });
    
    return { content: adapted, logs };
  }

  /**
   * 句式适配（代码实现）
   */
  applySentenceAdaptation(content, structureFeatures, weight) {
    if (!structureFeatures || !structureFeatures.avgLength) {
      return { content, logs: [] };
    }
    
    const targetLength = structureFeatures.avgLength;
    const logs = [];
    
    // 句长调整（代码实现）
    const sentences = content.split(/([。！？.!?])/);
    const adapted = [];
    let currentSentence = '';
    let adjustmentCount = 0;
    const maxAdjustments = Math.floor(10 * weight);
    
    for (let i = 0; i < sentences.length; i++) {
      const part = sentences[i];
      
      if (part.match(/[。！？.!?]/)) {
        currentSentence += part;
        
        if (currentSentence.length > targetLength * 1.5 && adjustmentCount < maxAdjustments) {
          const splitParts = this.splitLongSentence(currentSentence, targetLength);
          adapted.push(...splitParts);
          adjustmentCount++;
          logs.push(`句长调整: ${currentSentence.length}字 → ${splitParts.map(p => p.length).join('+')}字`);
        } else {
          adapted.push(currentSentence);
        }
        
        currentSentence = '';
      } else {
        currentSentence += part;
      }
    }
    
    if (currentSentence.trim().length > 0) {
      adapted.push(currentSentence);
    }
    
    return { content: adapted.join(''), logs };
  }


  /**
   * 拆分长句
   */
  splitLongSentence(sentence, targetLength) {
    const connectors = ['，', '；', '：', '。'];
    
    for (const connector of connectors) {
      if (sentence.includes(connector)) {
        const parts = sentence.split(connector);
        if (parts.length > 1) {
          return parts.join(connector + '\n');
        }
      }
    }
    
    return sentence;
  }

  /**
   * 语气适配（代码实现）
   */
  applyToneAdaptation(content, toneFeatures, weight) {
    if (!toneFeatures) {
      return { content, logs: [] };
    }
    
    let adapted = content;
    const logs = [];
    const { sentiment, formality, intensity } = toneFeatures;
    
    // 正式度调整
    if (formality === 'formal') {
      adapted = adapted
        .replace(/吧/g, '')
        .replace(/呢/g, '')
        .replace(/啊/g, '');
      logs.push(`语气调整：去除口语化表达`);
    } else if (formality === 'casual') {
      // 可以添加适当的语气词（但不强制）
    }
    
    // 强度调整
    if (intensity === 'low') {
      adapted = adapted.replace(/[！！]/g, '。');
      logs.push(`语气调整：降低强度`);
    }
    
    return { content: adapted, logs };
  }

  /**
   * 格式适配（代码实现）
   */
  applyFormattingAdaptation(content, formattingFeatures, weight) {
    if (!formattingFeatures) {
      return { content, logs: [] };
    }
    
    let adapted = content;
    const logs = [];
    const { paragraphStyle, headingStyle, listStyle } = formattingFeatures;
    
    // 段落风格调整
    if (paragraphStyle === 'indented') {
      adapted = adapted.replace(/^([^#\-\*])/gm, '  $1');
      logs.push(`格式调整：添加缩进`);
    }
    
    return { content: adapted, logs };
  }

  /**
   * ================================
   * 智能记忆：重置、脱钩、应用边界
   * ================================
   */

  /**
   * 重置智能记忆
   */
  resetMemory(options = {}) {
    const resetType = options.resetType || 'soft'; // soft, hard, full
    
    if (resetType === 'soft') {
      // 软重置：清空学习特征，保留用户画像
      this.memory.learnedFeatures = {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      };
      
      this.memory.metadata.lastReset = {
        type: 'soft',
        timestamp: new Date().toISOString(),
        reason: options.reason || '用户请求'
      };
      
    } else if (resetType === 'hard') {
      // 硬重置：清空学习特征，重置应用层
      this.resetMemory({ resetType: 'soft', ...options });
      
      this.memory.applicationLayer = {
        enabledFeatures: [],
        disabledFeatures: [],
        featureWeights: {},
        adaptationMode: 'balanced'
      };
      
    } else if (resetType === 'full') {
      // 完全重置：清空所有数据
      this.memory.userProfile = {
        basicInfo: null,
        workContext: null,
        preferences: null,
        history: null
      };

      this.savePreferenceProfile(this.getDefaultPreferenceProfile());
      
      this.resetMemory({ resetType: 'hard', ...options });
    }
    
    this.saveMemory();
    
    return {
      success: true,
      resetType,
      timestamp: this.memory.metadata.lastReset.timestamp
    };
  }

  /**
   * 与个性脱钩
   */
  decoupleProfile(options = {}) {
    const decouplingType = options.type || 'temporary'; // temporary, permanent
    
    if (decouplingType === 'temporary') {
      // 临时脱钩：暂时禁用所有个性化适配
      this.memory.applicationLayer.disabledFeatures = [
        'vocabulary',
        'sentenceStructure',
        'tone',
        'formatting',
        'rhetorical'
      ];
      
      this.memory.applicationLayer.enabledFeatures = [];
      
      this.memory.metadata.lastDecoupling = {
        type: 'temporary',
        timestamp: new Date().toISOString(),
        reason: options.reason || '用户请求',
        autoRestore: options.autoRestoreAfter || 1 // 小时后自动恢复
      };
      
    } else if (decouplingType === 'permanent') {
      // 永久脱钩：删除所有学习特征
      this.memory.learnedFeatures = {
        vocabulary: {},
        sentenceStructure: {},
        tone: {},
        formatting: {},
        rhetorical: {}
      };
      
      this.memory.metadata.lastDecoupling = {
        type: 'permanent',
        timestamp: new Date().toISOString(),
        reason: options.reason || '用户请求'
      };
    }
    
    this.saveMemory();
    
    return {
      success: true,
      decouplingType,
      timestamp: this.memory.metadata.lastDecoupling.timestamp,
      isCoupled: decouplingType === 'permanent' ? false : true
    };
  }

  /**
   * 检查应用边界
   */
  checkApplicationBoundary(content, context = {}) {
    const boundaries = {
      maxAdaptationIntensity: 0.5, // 最大适配强度
      minAdaptationFrequency: 0.1, // 最小适配频率
      maxMemorySize: 10 * 1024 * 1024, // 10MB
      protectedContentTypes: ['code', 'technical', 'legal'], // 保护的内容类型
    };
    
    const warnings = [];
    const errors = [];
    
    // 检查适配强度
    const adaptationIntensity = this.calculateAdaptationIntensity(content, context);
    if (adaptationIntensity > boundaries.maxAdaptationIntensity) {
      warnings.push(`适配强度过高 (${adaptationIntensity.toFixed(2)} > ${boundaries.maxAdaptationIntensity})，建议降低个性化程度`);
    }
    
    // 检查记忆大小
    const memorySize = JSON.stringify(this.memory).length;
    if (memorySize > boundaries.maxMemorySize) {
      warnings.push(`记忆数据过大 (${(memorySize / 1024 / 1024).toFixed(2)}MB > 10MB)，建议清理旧数据`);
    }
    
    // 检查内容类型保护
    if (context.contentType && boundaries.protectedContentTypes.includes(context.contentType)) {
      warnings.push(`内容类型 "${context.contentType}" 受保护，自动降低适配强度`);
    }
    
    return {
      withinBoundaries: errors.length === 0,
      warnings,
      errors,
      adaptationIntensity
    };
  }

  /**
   * 计算适配强度
   */
  calculateAdaptationIntensity(content, context) {
    let intensity = 0;
    
    // 基于启用的特征数量
    const enabledCount = this.memory.applicationLayer.enabledFeatures.length;
    const totalFeatures = 5;
    intensity += (enabledCount / totalFeatures) * 0.3;
    
    // 基于特征权重
    const weights = this.memory.applicationLayer.featureWeights || {};
    const avgWeight = Object.values(weights).reduce((a, b) => a + b, 0) / Object.keys(weights).length;
    intensity += avgWeight * 0.4;
    
    // 基于适配模式
    const modeIntensity = {
      'conservative': 0.2,
      'balanced': 0.5,
      'aggressive': 0.8
    };
    intensity += modeIntensity[this.memory.applicationLayer.adaptationMode] || 0.5;
    
    return Math.min(intensity, 1.0);
  }

  /**
   * ================================
   * 智能记忆整理：WorkBuddy升级适应性
   * ================================
   */

  /**
   * 分析WorkBuddy环境变化
   */
  analyzeWorkbuddyChanges(workbuddyDir) {
    const analysis = {
      timestamp: new Date().toISOString(),
      changes: [],
      impactAssessment: null,
      actionRequired: null
    };
    
    // 分析 USER.md 变化
    const userPath = path.join(workbuddyDir, 'USER.md');
    if (fs.existsSync(userPath)) {
      const currentContent = fs.readFileSync(userPath, 'utf8');
      const previousHash = this.memory.organizationLayer.workbuddyChanges.find(c => c.file === 'USER.md')?.hash || '';
      const currentHash = crypto.createHash('md5').update(currentContent).digest('hex');
      
      if (previousHash !== currentHash) {
        analysis.changes.push({
          file: 'USER.md',
          type: 'modified',
          previousHash,
          currentHash,
          impact: 'high'
        });
      }
    }
    
    // 分析 IDENTITY.md 变化
    const identityPath = path.join(workbuddyDir, 'IDENTITY.md');
    if (fs.existsSync(identityPath)) {
      const currentContent = fs.readFileSync(identityPath, 'utf8');
      const previousHash = this.memory.organizationLayer.workbuddyChanges.find(c => c.file === 'IDENTITY.md')?.hash || '';
      const currentHash = crypto.createHash('md5').update(currentContent).digest('hex');
      
      if (previousHash !== currentHash) {
        analysis.changes.push({
          file: 'IDENTITY.md',
          type: 'modified',
          previousHash,
          currentHash,
          impact: 'high'
        });
      }
    }
    
    // 分析宿主记忆目录变化（优先 memory/，兼容 legacy memery/）
    const hostMemoryFiles = collectHostMemoryFiles(workbuddyDir);
    const previousFileCount = this.memory.organizationLayer.workbuddyChanges.find(c => c.type === 'host-memory' || c.type === 'memery')?.count || 0;
    const existingDirs = listHostMemoryDirs(workbuddyDir).filter((dir) => fs.existsSync(dir));

    if (hostMemoryFiles.length !== previousFileCount) {
      analysis.changes.push({
        type: 'host-memory',
        previousCount: previousFileCount,
        currentCount: hostMemoryFiles.length,
        directories: existingDirs.map((dir) => path.basename(dir)),
        impact: 'medium'
      });
    }

    
    // 影响评估
    if (analysis.changes.length > 0) {
      analysis.impactAssessment = {
        highImpactChanges: analysis.changes.filter(c => c.impact === 'high').length,
        mediumImpactChanges: analysis.changes.filter(c => c.impact === 'medium').length,
        totalChanges: analysis.changes.length,
        recommendation: this.generateAdaptationRecommendation(analysis.changes)
      };
    }
    
    return analysis;
  }

  /**
   * 生成适配建议
   */
  generateAdaptationRecommendation(changes) {
    const recommendations = [];
    
    if (changes.some(c => c.file === 'USER.md' && c.type === 'modified')) {
      recommendations.push({
        type: 'relearn_profile',
        priority: 'high',
        description: '用户画像文件已更新，建议重新学习用户特征',
        action: 'execute_relearn_profile'
      });
    }
    
    if (changes.some(c => c.type === 'memery' && Math.abs(c.currentCount - c.previousCount) > 2)) {
      recommendations.push({
        type: 'memory_cleanup',
        priority: 'medium',
        description: '记忆文件数量显著变化，建议清理旧记忆',
        action: 'execute_memory_cleanup'
      });
    }
    
    return recommendations;
  }

  /**
   * 创建里程碑
   */
  createMilestone(milestoneData) {
    const milestone = {
      id: this.generateMilestoneId(),
      timestamp: new Date().toISOString(),
      ...milestoneData,
      status: 'completed'
    };
    
    this.memory.organizationLayer.milestones.push(milestone);
    this.saveMemory();
    
    return milestone;
  }

  /**
   * 生成里程碑 ID
   */
  generateMilestoneId() {
    const timestamp = Date.now().toString(36);
    return `ms-${timestamp}`;
  }

  /**
   * 清理旧数据
   */
  cleanupOldData(options = {}) {
    const cleanupTasks = [];
    
    // 清理过期的记忆
    const retentionDays = options.retentionDays || this.options.memoryRetentionDays;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    const milestones = this.memory.organizationLayer.milestones;
    const expiredMilestones = milestones.filter(m => new Date(m.timestamp) < cutoffDate);
    
    if (expiredMilestones.length > 0) {
      this.memory.organizationLayer.milestones = milestones.filter(m => new Date(m.timestamp) >= cutoffDate);
      cleanupTasks.push({
        type: 'expired_milestones',
        count: expiredMilestones.length,
        action: 'removed'
      });
    }
    
    // 清理 WorkBuddy 变化记录
    const maxWorkbuddyChanges = 100;
    if (this.memory.organizationLayer.workbuddyChanges.length > maxWorkbuddyChanges) {
      const removed = this.memory.organizationLayer.workbuddyChanges.splice(maxWorkbuddyChanges);
      cleanupTasks.push({
        type: 'old_workbuddy_changes',
        count: removed.length,
        action: 'removed'
      });
    }
    
    this.saveMemory();
    
    return {
      success: true,
      tasks: cleanupTasks,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 保存记忆
   */
  saveMemory() {
    this.memory.lastUpdated = new Date().toISOString();
    this.memory.metadata.memorySize = JSON.stringify(this.memory).length;
    
    const memoryFile = path.join(this.memoryDir, 'memory.json');
    fs.writeFileSync(
      memoryFile,
      JSON.stringify(this.memory, null, 2),
      'utf8'
    );
  }

  /**
   * 加载记忆
   */
  loadMemory() {
    const memoryFile = path.join(this.memoryDir, 'memory.json');
    
    if (!fs.existsSync(memoryFile)) {
      return null;
    }
    
    const content = fs.readFileSync(memoryFile, 'utf8');
    this.memory = JSON.parse(content);
    
    return this.memory;
  }

  /**
   * 导出记忆报告
   */
  exportReport(outputPath) {
    const report = {
      version: '2.1.1',
      exportedAt: new Date().toISOString(),

      profileId: this.memory.profileId,
      summary: {
        userProfile: this.memory.userProfile,
        userPreferenceProfile: this.loadPreferenceProfile(),
        learnedFeatures: this.memory.learnedFeatures,
        applicationLayer: this.memory.applicationLayer,
        retrievalProfile: this.memory.retrievalProfile,
        organizationLayer: this.memory.organizationLayer,
        metadata: this.memory.metadata
      },
      recommendations: this.generateMemoryRecommendations()
    };
    
    fs.writeFileSync(
      outputPath,
      JSON.stringify(report, null, 2),
      'utf8'
    );
    
    return {
      success: true,
      outputPath
    };
  }

  /**
   * 生成记忆建议
   */
  generateMemoryRecommendations() {
    const recommendations = [];
    
    // 检查脱钩状态
    if (this.memory.metadata.lastDecoupling) {
      if (this.memory.metadata.lastDecoupling.type === 'temporary') {
        recommendations.push({
          type: 'decoupling_warning',
          priority: 'medium',
          message: '当前处于临时脱钩状态，个性化适配已禁用'
        });
      }
    }
    
    // 检查重置状态
    if (this.memory.metadata.lastReset) {
      const daysSinceReset = (Date.now() - new Date(this.memory.metadata.lastReset.timestamp).getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceReset > 30) {
        recommendations.push({
          type: 'relearn_recommendation',
          priority: 'low',
          message: '上次重置已超过30天，建议重新开始学习'
        });
      }
    }
    
    // 检查记忆健康度
    if (this.memory.metadata.memorySize > 5 * 1024 * 1024) {
      recommendations.push({
        type: 'memory_cleanup',
        priority: 'medium',
        message: '记忆数据较大，建议执行清理操作'
      });
    }
    
    return recommendations;
  }
}

/**
 * CLI 入口
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {

  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help')) {
    console.log(`
智能记忆核心系统

用法:
  node smart-memory-core.mjs <action> <project-root> [options]

动作:
  reset             重置智能记忆
  decouple          与个性脱钩
  check-boundary    检查应用边界
  analyze-wb        分析 WorkBuddy 变化
  create-milestone  创建里程碑
  cleanup           清理旧数据
  export            导出记忆报告
  update-retrieval  更新检索画像
  writeback         执行分层写回路由
  preference-show   查看用户偏好档案
  preference-update 更新用户偏好档案
  preference-reject 记录被拒绝的建议
  preference-ban    添加禁推建议项

参数:
  project-root      项目根目录

选项:
  --reset-type          重置类型: soft, hard, full (默认: soft)
  --decouple-type       脱钩类型: temporary, permanent (默认: temporary)
  --workbuddy-dir       WorkBuddy 目录 (用于 analyze-wb)
  --retention-days      记忆保留天数 (默认: 90)
  --output              输出文件路径 (用于 export)
  --profile-id          用户画像 ID
  --layer               写回层级: shortTerm/project/longTerm
  --stable-domains      逗号分隔域名列表（用于 update-retrieval）
  --query-patterns      逗号分隔query模式（用于 update-retrieval）
  --anti-patterns       逗号分隔反模式（用于 update-retrieval）
  --quality-priority    JSON字符串（用于 update-retrieval）
  --source-preference   JSON字符串（用于 update-retrieval）
  --payload             JSON字符串（用于 writeback）
  --preference-json     JSON字符串（用于 preference-update）
  --suggestion          建议文本（用于 preference-reject）
  --ban-item            禁推项文本（用于 preference-ban）
  --help                显示帮助信息

示例:
  # 重置智能记忆（软重置）
  node smart-memory-core.mjs reset ./my-book --reset-type soft

  # 更新检索画像
  node smart-memory-core.mjs update-retrieval ./my-book --stable-domains gov.cn,people.com.cn --query-patterns "相对时效词+站点限定"

  # 执行分层写回
  node smart-memory-core.mjs writeback ./my-book --layer longTerm --payload "{\"stableDomains\":[\"gov.cn\"]}"

  # 更新用户偏好档案
  node smart-memory-core.mjs preference-update ./my-book --preference-json "{\"writingStyle\":{\"tone\":\"严谨\"}}"

  # 记录拒绝建议
  node smart-memory-core.mjs preference-reject ./my-book --suggestion "推荐轻松口吻" --reason "需要更专业"
    `);
    process.exit(0);
  }
  
  const action = args[0];
  const projectRoot = args[1];
  const options = parseArgs(args.slice(2));
  
  try {
    const core = new SmartMemoryCore(projectRoot, options);
    
    switch (action) {
      case 'reset':
        const resetResult = core.resetMemory(options);
        console.log('记忆重置完成:', resetResult.resetType);
        console.log('时间:', resetResult.timestamp);
        break;
        
      case 'decouple':
        const decoupleResult = core.decoupleProfile({
          ...options,
          type: options.decoupleType || options.type || 'temporary'
        });
        console.log('脱钩完成:', decoupleResult.decouplingType);
        console.log('时间:', decoupleResult.timestamp);
        console.log('是否耦合:', decoupleResult.isCoupled ? '是' : '否');
        break;
        
      case 'check-boundary':
        const boundaryResult = core.checkApplicationBoundary('', options);
        console.log('应用边界检查:');
        console.log('  边界内:', boundaryResult.withinBoundaries ? '是' : '否');
        console.log('  适配强度:', boundaryResult.adaptationIntensity.toFixed(2));
        console.log('  警告数:', boundaryResult.warnings.length);
        if (boundaryResult.warnings.length > 0) {
          boundaryResult.warnings.forEach(w => console.log(`    - ${w}`));
        }
        break;
        
      case 'analyze-wb':
        if (!options.workbuddyDir) {
          console.error('错误: 请提供 WorkBuddy 目录 (--workbuddy-dir)');
          process.exit(1);
        }
        const analysisResult = core.analyzeWorkbuddyChanges(options.workbuddyDir);
        console.log('WorkBuddy 变化分析:');
        console.log('  检测到的变化:', analysisResult.changes.length);
        analysisResult.changes.forEach(c => {
          if (c.file) {
            console.log(`    - 文件: ${c.file}, 类型: ${c.type}, 影响: ${c.impact}`);
          } else if (c.type === 'host-memory' || c.type === 'memery') {
            const dirs = Array.isArray(c.directories) && c.directories.length > 0 ? ` (${c.directories.join(' / ')})` : '';
            console.log(`    - 宿主记忆文件${dirs}: ${c.previousCount} → ${c.currentCount}, 影响: ${c.impact}`);
          }

        });
        if (analysisResult.impactAssessment) {
          console.log('  影响评估:', analysisResult.impactAssessment.totalChanges, '个变化');
          console.log('  高影响:', analysisResult.impactAssessment.highImpactChanges, '个');
          console.log('  中影响:', analysisResult.impactAssessment.mediumImpactChanges, '个');
        }
        break;
        
      case 'create-milestone':
        const milestone = core.createMilestone({
          type: options.type || 'manual',
          description: options.description || '用户创建的里程碑'
        });
        console.log('里程碑已创建:', milestone.id);
        console.log('时间:', milestone.timestamp);
        break;
        
      case 'cleanup':
        const cleanupResult = core.cleanupOldData(options);
        console.log('清理完成:', cleanupResult.tasks.length, '个任务');
        cleanupResult.tasks.forEach(t => {
          console.log(`  - ${t.type}: ${t.action} ${t.count}项`);
        });
        break;
        
      case 'export':
        const outputPath = options.output || './memory-report.json';
        const exportResult = core.exportReport(outputPath);
        console.log('记忆报告已导出:', exportResult.outputPath);
        console.log('建议数量:', core.generateMemoryRecommendations().length, '个');
        break;

      case 'update-retrieval': {
        const profileDelta = {
          stableDomains: options.stableDomains,
          effectiveQueryPatterns: options.queryPatterns,
          antiPatterns: options.antiPatterns,
          qualityPriority: options.qualityPriority || {},
          sourceTypePreference: options.sourcePreference || {}
        };
        const profileResult = core.updateRetrievalProfile(profileDelta);
        console.log('检索画像已更新');
        console.log('稳定域名数:', profileResult.profile.stableDomains.length);
        break;
      }

      case 'writeback': {
        const writebackResult = core.routeMemoryWriteback({
          layer: options.layer,
          payload: options.payload,
          filePath: options.output
        });
        console.log('写回路由结果:', writebackResult.routedTo);
        console.log('accepted:', writebackResult.accepted ? 'yes' : 'no');
        break;
      }

      case 'preference-show': {
        const profile = core.loadPreferenceProfile();
        console.log(JSON.stringify(profile, null, 2));
        break;
      }

      case 'preference-update': {
        const updateResult = core.updateUserPreferenceProfile(options.preferenceJson || {});
        console.log('偏好档案已更新');
        console.log('更新时间:', updateResult.profile.updatedAt);
        break;
      }

      case 'preference-accept': {
        if (!options.suggestion) {
          console.error('错误: 请提供 --suggestion');
          process.exit(1);
        }
        const acceptResult = core.recordAcceptedSuggestion(options.suggestion, options.reason || '');
        console.log('已记录接受建议');
        console.log('累计接受次数:', acceptResult.profile.feedbackSignals?.acceptCount || 0);
        break;
      }

      case 'preference-reject': {
        if (!options.suggestion) {
          console.error('错误: 请提供 --suggestion');
          process.exit(1);
        }
        const rejectResult = core.recordRejectedSuggestion(options.suggestion, options.reason || '');
        console.log('已记录拒绝建议');
        console.log('累计拒绝次数:', rejectResult.profile.feedbackSignals?.rejectCount || 0);
        break;
      }

      case 'preference-ban': {
        if (!options.banItem) {
          console.error('错误: 请提供 --ban-item');
          process.exit(1);
        }
        const banResult = core.addForbiddenRecommendation(options.banItem);
        if (!banResult.success) {
          console.error('错误:', banResult.message || '添加禁推项失败');
          process.exit(1);
        }
        console.log('已添加禁推项');
        console.log('禁推项数量:', banResult.profile.forbiddenRecommendations.length);
        break;
      }

      case 'preference-freeze': {
        const freezeResult = core.freezePreferenceLearning(options.reason || '');
        console.log('偏好自动学习已冻结');
        console.log('冻结快照:', freezeResult.snapshotId);
        break;
      }

      case 'preference-unfreeze': {
        const unfreezeResult = core.unfreezePreferenceLearning(options.reason || '');
        console.log('偏好自动学习已恢复');
        console.log('恢复前快照:', unfreezeResult.snapshotId);
        break;
      }

      case 'preference-history': {
        const history = core.listPreferenceSnapshots({ limit: options.limit || 20 });
        console.log(JSON.stringify(history, null, 2));
        break;
      }

      case 'preference-rollback': {
        if (!options.snapshotId) {
          console.error('错误: 请提供 --snapshot-id');
          process.exit(1);
        }
        const rollbackResult = core.rollbackPreferenceProfile(options.snapshotId);
        if (!rollbackResult.success) {
          console.error('错误:', rollbackResult.message || '偏好回滚失败');
          process.exit(1);
        }
        console.log('偏好档案已回滚');
        console.log('恢复来源:', rollbackResult.restoredFrom);
        console.log('回滚前备份:', rollbackResult.backupSnapshotId);
        break;
      }


      default:
        console.error('未知动作:', action);
        process.exit(1);
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * 解析命令行参数
 */
function parseArgs(args) {
  const options = {
    resetType: 'soft',
    decoupleType: 'temporary',
    workbuddyDir: null,
    retentionDays: 90,
    output: null,
    profileId: null,
    reason: null,
    autoRestoreAfter: 1,
    type: null,
    description: null,
    layer: 'project',
    payload: {},
    stableDomains: [],
    queryPatterns: [],
    antiPatterns: [],
    qualityPriority: null,
    sourcePreference: null,
    preferenceJson: null,
    suggestion: null,
    banItem: null
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--reset-type' && args[i + 1]) {
      options.resetType = args[++i];
    } else if (arg === '--decouple-type' && args[i + 1]) {
      options.decoupleType = args[++i];
    } else if (arg === '--workbuddy-dir' && args[i + 1]) {
      options.workbuddyDir = args[++i];
    } else if (arg === '--retention-days' && args[i + 1]) {
      options.retentionDays = parseInt(args[++i], 10);
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--profile-id' && args[i + 1]) {
      options.profileId = args[++i];
    } else if (arg === '--reason' && args[i + 1]) {
      options.reason = args[++i];
    } else if (arg === '--auto-restore-after' && args[i + 1]) {
      options.autoRestoreAfter = parseInt(args[++i], 10);
    } else if (arg === '--type' && args[i + 1]) {
      options.type = args[++i];
    } else if (arg === '--description' && args[i + 1]) {
      options.description = args[++i];
    } else if (arg === '--layer' && args[i + 1]) {
      options.layer = args[++i];
    } else if (arg === '--stable-domains' && args[i + 1]) {
      options.stableDomains = String(args[++i]).split(',').map((v) => v.trim()).filter(Boolean);
    } else if (arg === '--query-patterns' && args[i + 1]) {
      options.queryPatterns = String(args[++i]).split(',').map((v) => v.trim()).filter(Boolean);
    } else if (arg === '--anti-patterns' && args[i + 1]) {
      options.antiPatterns = String(args[++i]).split(',').map((v) => v.trim()).filter(Boolean);
    } else if (arg === '--quality-priority' && args[i + 1]) {
      try {
        options.qualityPriority = JSON.parse(args[++i]);
      } catch {
        options.qualityPriority = null;
      }
    } else if (arg === '--source-preference' && args[i + 1]) {
      try {
        options.sourcePreference = JSON.parse(args[++i]);
      } catch {
        options.sourcePreference = null;
      }
    } else if (arg === '--payload' && args[i + 1]) {
      try {
        options.payload = JSON.parse(args[++i]);
      } catch {
        options.payload = {};
      }
    } else if (arg === '--preference-json' && args[i + 1]) {
      try {
        options.preferenceJson = JSON.parse(args[++i]);
      } catch {
        options.preferenceJson = null;
      }
    } else if (arg === '--suggestion' && args[i + 1]) {
      options.suggestion = args[++i];
    } else if (arg === '--ban-item' && args[i + 1]) {
      options.banItem = args[++i];
    } else if (arg === '--snapshot-id' && args[i + 1]) {
      options.snapshotId = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10) || 20;
    }

  }
  
  return options;
}
