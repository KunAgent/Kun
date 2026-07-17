#!/usr/bin/env node
/**
 * 会议智能体（Session Agent）
 * 
 * 职责:
 * - 四种会议自动化执行
 * - 会议简报生成
 * - 会议纪要生成
 * - 会议决策汇总
 * - 多角色对话模拟
 */

import { AgentBase } from './agent-base.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import {
  DURATION_LIMITS,
  PHASES,
  PSYCHOLOGICAL_CONTRACT_OPTIONS,
  ROLE_LABELS,
  ROLES,
  SESSION_FILE_NAMES,
  SESSION_LABELS,
  SESSION_TYPES,
  SESSIONS_SUMMARY_HEADER,
} from './session-agent-constants.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SessionAgent extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'session-agent',
      agentName: 'Session-Agent',
      agentType: 'specialist',
      capabilities: [
        'session-orchestration',
        'brief-generation',
        'multi-role-simulation',
        'decision-aggregation',
        'meeting-summary'
      ],
      ...config
    });
    
    this.bookRoot = null;
    this.sessionType = null;
    this.roles = [];
    this.sessionBrief = null;
    this.meetingResults = null;
  }

  /**
   * 启动会议
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 会议结果
   */
  async executeTask(task) {
    const { state, payload } = task;
    
    if (state !== 'S0' && state !== 'S1' && state !== 'S2' && state !== 'S5') {
      throw new Error(`SessionAgent only supports S0, S1, S2, S5 states, got: ${state}`);
    }
    
    const { sessionType, bookRoot, chapterId, mode } = payload;
    
    console.log(`[Session-Agent] Starting ${sessionType} session for chapter: ${chapterId}`);
    
    this.bookRoot = bookRoot;
    this.sessionType = sessionType;
    this.chapterId = chapterId;
    this.mode = mode;
    
    // 1. 生成会议简报
    await this._generateSessionBrief();
    
    // 2. 执行会议流程
    const result = await this._executeMeeting(sessionType);
    
    // 3. 生成会议纪要
    const meetingSummary = await this._generateMeetingSummary(result);
    
    // 4. 汇总到决策汇总文件
    await this._aggregateDecisions(result, meetingSummary);

    
    // 5. 发布会议完成事件
    this.publishEvent('session.completed', {
      sessionType,
      chapterId,
      result
    });
    
    return result;
  }

  /**
   * 生成会议简报
   * @returns {Promise<object>} - 会议简报
   */
  async _generateSessionBrief() {
    console.log(`[Session-Agent] Generating session brief...`);
    
    // 加载项目配置
    const projectConfig = this._loadProjectConfig();
    
    // 加载必要的上下文
    const context = await this._loadContext();
    
    // 根据会议类型生成简报
    const brief = {
      sessionType: this.sessionType,
      chapterId: this.chapterId,
      bookTitle: projectConfig.title || '未知书名',
      topic: this._extractTopic(context),
      genre: projectConfig.genreTag || '未知体裁',
      reader: projectConfig.reader || '未知读者',
      currentState: this._getCurrentState(context),
      objective: this._getObjective(),
      keyBackground: this._extractKeyBackground(context),
      generatedAt: new Date().toISOString(),
      status: 'ready'
    };
    
    this.sessionBrief = brief;
    
    // 保存简报到文件
    const briefFile = path.join(this.bookRoot, '.fbs', 'sessions', `${this.sessionType}-brief.md`);
    this._ensureDir(path.dirname(briefFile));
    fs.writeFileSync(briefFile, this._formatBrief(brief), 'utf-8');
    
    console.log(`[Session-Agent] Session brief generated: ${briefFile}`);
    
    return brief;
  }

  /**
   * 执行会议流程
   * @param {string} sessionType - 会议类型
   * @returns {Promise<object>} - 会议结果
   */
  async _executeMeeting(sessionType) {
    console.log(`[Session-Agent] Executing ${sessionType} session...`);
    
    let result;
    
    switch (sessionType) {
      case SESSION_TYPES.CREATIVE:
        result = await this._executeCreativeSession();
        break;
      case SESSION_TYPES.READER:
        result = await this._executeReaderSession();
        break;
      case SESSION_TYPES.ADVERSARIAL:
        result = await this._executeAdversarialSession();
        break;
      case SESSION_TYPES.REVIEW:
        result = await this._executeReviewSession();
        break;
      default:
        throw new Error(`Unknown session type: ${sessionType}`);
    }
    
    this.meetingResults = result;
    return result;
  }

  /**
   * 执行创意会
   * @returns {Promise<object>} - 会议结果
   */
  async _executeCreativeSession() {
    console.log(`[Session-Agent] Executing creative session...`);
    
    const mode = this.mode || 'normal';
    const roles = mode === 'light' 
      ? [ROLES.RADICAL, ROLES.CONSERVATIVE, ROLES.READER]
      : [ROLES.RADICAL, ROLES.CONSERVATIVE, ROLES.READER];
    
    this.roles = roles;
    
    // 第一阶段：发散（各角色独立表达，不打断、不批评）
    const divergenceResults = await this._divergencePhase(roles);
    
    // 第二阶段：收束（在发散结果基础上碰撞，找出最有力的综合方案）
    const convergenceResults = await this._convergencePhase(roles, divergenceResults);
    
    const result = {
      sessionType: SESSION_TYPES.CREATIVE,
      phase: 'completed',
      divergence: divergenceResults,
      convergence: convergenceResults,
      selectedDirection: convergenceResults.selectedDirection,
      abandonedDirections: convergenceResults.abandonedDirections,
      generatedAt: new Date().toISOString()
    };
    
    return result;
  }

  /**
   * 执行读者会
   * @returns {Promise<object>} - 会议结果
   */
  async _executeReaderSession() {
    console.log(`[Session-Agent] Executing reader session...`);
    
    const roles = [ROLES.NOVICE, ROLES.EXPERIENCED, ROLES.EXPERT];
    this.roles = roles;
    
    // 第一阶段：发散（各角色独立表达读者关切）
    const divergenceResults = await this._divergencePhase(roles);
    
    // 第二阶段：收束（汇总关切清单）
    const convergenceResults = await this._convergencePhase(roles, divergenceResults);
    
    const result = {
      sessionType: SESSION_TYPES.READER,
      phase: 'completed',
      divergence: divergenceResults,
      convergence: convergenceResults,
      concerns: convergenceResults.concerns,
      generatedAt: new Date().toISOString()
    };
    
    return result;
  }

  /**
   * 执行对抗会
   * @returns {Promise<object>} - 会议结果
   */
  async _executeAdversarialSession() {
    console.log(`[Session-Agent] Executing adversarial session...`);
    
    const roles = [ROLES.SUPPORTER, ROLES.OPPONENT, ROLES.SYNTHESIZER];
    this.roles = roles;
    
    // 第一阶段：发散（各角色独立表达）
    const divergenceResults = await this._divergencePhase(roles);
    
    // 第二阶段：收束（综合者给出最强可接受表述）
    const convergenceResults = await this._convergencePhase(roles, divergenceResults);
    
    const result = {
      sessionType: SESSION_TYPES.ADVERSARIAL,
      phase: 'completed',
      divergence: divergenceResults,
      convergence: convergenceResults,
      strengthenedArgument: convergenceResults.selectedDirection,
      generatedAt: new Date().toISOString()
    };
    
    return result;
  }

  /**
   * 执行评审会
   * @returns {Promise<object>} - 会议结果
   */
  async _executeReviewSession() {
    console.log(`[Session-Agent] Executing review session...`);
    
    const roles = [ROLES.CONTENT_EXPERT, ROLES.EXPRESSION_EXPERT, ROLES.CRITIC];
    this.roles = roles;
    
    // 第一阶段：三方独立审查（各负责全书）
    const divergenceResults = await this._divergencePhase(roles);
    
    // 第二阶段：收束（汇总问题清单）
    const convergenceResults = await this._convergencePhase(roles, divergenceResults);
    
    const result = {
      sessionType: SESSION_TYPES.REVIEW,
      phase: 'completed',
      divergence: divergenceResults,
      convergence: convergenceResults,
      issueGrades: convergenceResults.issueGrades,
      generatedAt: new Date().toISOString()
    };
    
    return result;
  }

  /**
   * 发散阶段
   * @param {Array} roles - 参会角色
   * @returns {Promise<object>} - 发散结果
   */
  async _divergencePhase(roles) {
    console.log(`[Session-Agent] Divergence phase with ${roles.length} roles...`);
    
    const results = {};
    
    for (const role of roles) {
      const roleResult = await this._getRoleDivergence(role);
      results[role] = roleResult;
    }
    
    return {
      phase: PHASES.DIVERGENCE,
      roles: roles,
      results
    };
  }

  /**
   * 收束阶段
   * @param {Array} roles - 参会角色
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _convergencePhase(roles, divergenceResults) {
    console.log(`[Session-Agent] Convergence phase...`);
    
    const mode = this.mode || 'normal';
    const durationConfig = DURATION_LIMITS[this.sessionType][mode] || DURATION_LIMITS[this.sessionType].normal;
    
    // 检查是否超时
    const startTime = Date.now();
    const timeoutCheck = () => (Date.now() - startTime) / 1000 / 60 > durationConfig.timeout;
    
    if (timeoutCheck()) {
      console.log(`[Session-Agent] Session timeout (${durationConfig.timeout}min reached, forcing convergence...`);
    }
    
    const results = await this._performConvergence(roles, divergenceResults);
    
    return {
      phase: PHASES.CONVERGENCE,
      results,
      forced: timeoutCheck()
    };
  }

  /**
   * 获取角色发散结果
   * @param {string} role - 角色标识
   * @returns {Promise<object>} - 角色发散结果
   */
  async _getRoleDivergence(role) {
    console.log(`[Session-Agent] Getting divergence for role: ${role}...`);
    
    // 模拟角色发散
    const result = await this._simulateRoleDivergence(role);
    
    return result;
  }

  /**
   * 模拟角色发散
   * @param {string} role - 角色标识
   * @returns {Promise<object>} - 模拟结果
   */
  async _simulateRoleDivergence(role) {
    const brief = this.sessionBrief;
    
    // 根据角色类型生成不同的发散内容
    let divergenceContent;
    
    switch (role) {
      case ROLES.RADICAL:
        divergenceContent = this._generateRadicalDivergence(brief);
        break;
      case ROLES.CONSERVATIVE:
        divergenceContent = this._generateConservativeDivergence(brief);
        break;
      case ROLES.READER:
        divergenceContent = this._generateReaderDivergence(brief);
        break;
      case ROLES.NOVICE:
        divergenceContent = this._generateNoviceReaderDivergence(brief);
        break;
      case ROLES.EXPERIENCED:
        divergenceContent = this._generateExperiencedReaderDivergence(brief);
        break;
      case ROLES.EXPERT:
        divergenceContent = this._generateExpertReaderDivergence(brief);
        break;
      case ROLES.SUPPORTER:
        divergenceContent = this._generateSupporterDivergence(brief);
        break;
      case ROLES.OPPONENT:
        divergenceContent = this._generateOpponentDivergence(brief);
        break;
      case ROLES.SYNTHESIZER:
        divergenceContent = this._generateSynthesizerDivergence(brief);
        break;
      case ROLES.CONTENT_EXPERT:
        divergenceContent = this._generateContentExpertDivergence(brief);
        break;
      case ROLES.EXPRESSION_EXPERT:
        divergenceContent = this._generateExpressionExpertDivergence(brief);
        break;
      case ROLES.CRITIC:
        divergenceContent = this._generateCriticDivergence(brief);
        break;
      default:
        throw new Error(`Unknown role: ${role}`);
    }
    
    return {
      role,
      content: divergenceContent,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * 生成激进派发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateRadicalDivergence(brief) {
    return `## 激进派视角

**核心观点**：
从完全不同的角度切入，挑战常规思路，提出突破性的创新方向。

**方向提案**：
1. ${this._generateRadicalDirection(brief)}
2. ${this._generateRadicalDirection(brief)}
3. ${this._generateRadicalDirection(brief)}

**理由**：
当前思路可能过于保守，需要更大的突破和想象力。`;
  }

  /**
   * 生成守序派发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateConservativeDivergence(brief) {
    return `## 守序派视角

**核心观点**：
基于现有素材和约束，提出最可行、风险最低的实施路径。

**方向提案**：
1. ${this._generateConservativeDirection(brief)}
2. ${this._generateConservativeDirection(brief)}

**理由**：
考虑实施难度和时间成本，选择稳健可靠的方案。`;
  }

  /**
   * 生成读者派发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateReaderDivergence(brief) {
    return `## 读者派视角

**核心关切**：
从目标读者的角度出发，关注他们最想看什么、最关心什么。

**关切清单**：
1. ${this._generateReaderConcern(brief)}
2. ${this._generateReaderConcern(brief)}
3. ${this._generateReaderConcern(brief)}`;
  }

  /**
   * 生成支持者发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateSupporterDivergence(brief) {
    return `## 支持者视角

**核心论据**：
1. ${this._generateStrongArgument(brief)}
2. ${this._generateStrongArgument(brief)}
3. ${this._generateStrongArgument(brief)}

**证据支持**：
基于书中的具体章节和段落，提供最强的支撑。`;
  }

  /**
   * 生成反对者发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateOpponentDivergence(brief) {
    return `## 反对者视角

**核心反驳**：
1. ${this._generateStrongCounterargument(brief)}
2. ${this._generateStrongCounterargument(brief)}
3. ${this._generateStrongCounterargument(brief)}

**问题指出**：
从逻辑、证据、事实三个层面指出核心论断的薄弱环节。`;
  }

  /**
   * 生成综合者发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateSynthesizerDivergence(brief) {
    return `## 综合者视角

**综合分析**：
客观分析支持和反对双方的论据，找出可接受的平衡点。

**建议方案**：
在双方观点基础上，提出最强可接受的综合表述。`;
  }

  /**
   * 生成内容专家发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateContentExpertDivergence(brief) {
    return `## 内容专家视角

**核心检查**：
1. ${this._checkContentPoint(brief)}
2. ${this._checkContentPoint(brief)}
3. ${this._checkContentPoint(brief)}

**逻辑跳跃检查**：
识别是否存在逻辑跳跃、推理不连贯的问题。`;
  }

  /**
   * 生成表达专家发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateExpressionExpertDivergence(brief) {
    return `## 表达专家视角

**叙事节奏检查**：
1. ${this._checkNarrativeRhythm(brief)}
2. ${this._checkNarrativeRhythm(brief)}

**可读性检查**：
是否存在读者会失去耐心的地方？哪里读起来太突兀？`;
  }

  /**
   * 生成批评者发散
   * @param {object} brief - 会议简报
   * @returns {string} - 发散内容
   */
  _generateCriticDivergence(brief) {
    return `## 怀疑论者视角

**读者批评视角**：
本书最容易被批评的地方是什么？

**核心反驳点**：
1. ${this._generateCounterargument(brief)}
2. ${this._generateCounterargument(brief)}
3. ${this._generateCounterargument(brief)}`;
  }

  /**
   * 执行收敛
   * @param {Array} roles - 参会角色
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _performConvergence(roles, divergenceResults) {
    console.log(`[Session-Agent] Performing convergence...`);
    
    const mode = this.mode || 'normal';
    const durationConfig = DURATION_LIMITS[this.sessionType][mode] || DURATION_LIMITS[this.sessionType].normal;
    
    // 根据会议类型执行不同的收敛策略
    let convergenceResults;
    
    switch (this.sessionType) {
      case SESSION_TYPES.CREATIVE:
        convergenceResults = await this._performCreativeConvergence(divergenceResults);
        break;
      case SESSION_TYPES.READER:
        convergenceResults = await this._performReaderConvergence(divergenceResults);
        break;
      case SESSION_TYPES.ADVERSARIAL:
        convergenceResults = await this._performAdversarialConvergence(divergenceResults);
        break;
      case SESSION_TYPES.REVIEW:
        convergenceResults = await this._performReviewConvergence(divergenceResults);
        break;
      default:
        throw new Error(`Unknown session type: ${this.sessionType}`);
    }
    
    return convergenceResults;
  }

  /**
   * 执行创意会收敛
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _performCreativeConvergence(divergenceResults) {
    // 分析三个方向的优劣
    const analysis = await this._analyzeCreativeDirections(divergenceResults);
    
    // 选出1-2个最有潜力的方向
    const selectedDirections = analysis.slice(0, 2);
    const abandonedDirections = analysis.slice(2);
    
    return {
      selectedDirection: selectedDirections[0],
      selectedDirections,
      abandonedDirections
    };
  }

  /**
   * 执行读者会收敛
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _performReaderConvergence(divergenceResults) {
    // 汇总关切清单
    const concerns = await this._summarizeReaderConcerns(divergenceResults);
    
    return {
      concerns
    };
  }

  /**
   * 执行对抗会收敛
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _performAdversarialConvergence(divergenceResults) {
    const mode = this.mode || 'normal';
    const durationConfig = DURATION_LIMITS[this.sessionType][mode] || DURATION_LIMITS[this.sessionType].normal;
    
    // 如果未超时，让人类选择方向
    if (!this.forcedConvergence) {
      return {
        needsUserDecision: true,
        prompt: '请在以下方向中选择一个：\n' + divergenceResults.results[ROLES.SYNTHESIZER].content
      };
    }
    
    // 强制收敛：选择综合者的建议
    const synthesizeResult = divergenceResults.results[ROLES.SYNTHESIZER];
    
    return {
      selectedDirection: synthesizeResult.content,
      needsUserDecision: false
    };
  }

  /**
   * 执行评审会收敛
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<object>} - 收敛结果
   */
  async _performReviewConvergence(divergenceResults) {
    // 收集三方的问题清单
    const issueGrades = {};
    
    for (const role of this.roles) {
      const roleResult = divergenceResults.results[role];
      const issues = this._extractIssues(roleResult.content);
      issueGrades[role] = this._gradeIssues(issues);
    }
    
    return {
      issueGrades
    };
  }

  /**
   * 生成会议纪要
   * @param {object} result - 会议结果
   * @returns {Promise<object>} - 会议纪要
   */
  async _generateMeetingSummary(result) {
    console.log(`[Session-Agent] Generating meeting summary...`);

    const summary = {
      sessionType: this.sessionType,
      sessionLabel: this._getSessionLabel(),
      date: new Date().toISOString(),
      participants: this.roles,
      coreConclusion: this._resolveCoreConclusion(result),
      keyDecisions: this._resolveKeyDecisions(result),
      actionItems: this._resolveActionItems(result),
      issueGrades: result.issueGrades || result.convergence?.issueGrades || {},
      generatedAt: new Date().toISOString(),
      detailFile: this._resolveSessionDetailRelativePath()
    };

    const detailFilePath = this._resolveSessionDetailPath();
    this._ensureDir(path.dirname(detailFilePath));

    const summaryMarkdown = this._formatMeetingSummary(summary, result);
    fs.writeFileSync(detailFilePath, summaryMarkdown + '\n', 'utf-8');

    console.log(`[Session-Agent] Meeting summary generated: ${detailFilePath}`);

    return {
      ...summary,
      filePath: detailFilePath
    };
  }

  /**
   * 汇总决策到汇总文件
   * @param {object} result - 会议结果
   * @param {object} meetingSummary - 已落盘的会议纪要
   * @returns {Promise<object>} - 汇总结果
   */
  async _aggregateDecisions(result, meetingSummary = null) {
    console.log(`[Session-Agent] Aggregating decisions...`);

    const decisions = {
      sessionType: this.sessionType,
      sessionLabel: this._getSessionLabel(),
      date: new Date().toISOString().split('T')[0],
      coreDecision: meetingSummary?.coreConclusion || this._resolveCoreConclusion(result),
      keyDecisions: meetingSummary?.keyDecisions || this._resolveKeyDecisions(result),
      actionItems: meetingSummary?.actionItems || this._resolveActionItems(result),
      detailFile: meetingSummary?.detailFile || this._resolveSessionDetailRelativePath(),
      generatedAt: meetingSummary?.generatedAt || new Date().toISOString()
    };

    const summaryFile = path.join(this.bookRoot, '.fbs', 'sessions-summary.md');
    const summaryRow = this._formatDecisionSummary(decisions);
    this._appendDecisionSummaryRow(summaryFile, summaryRow);

    console.log(`[Session-Agent] Decisions aggregated: ${summaryFile}`);

    return decisions;
  }


  // ==================== 辅助方法 ====================

  /**
   * 加载项目配置
   * @returns {object} - 项目配置
   */
  _loadProjectConfig() {
    const configPath = path.join(this.bookRoot, '.fbs', 'project-config.json');
    if (!fs.existsSync(configPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  /**
   * 加载上下文
   * @returns {Promise<object>} - 上下文
   */
  async _loadContext() {
    const context = {
      projectConfig: this._loadProjectConfig(),
      sessionBrief: this.sessionBrief
    };
    return context;
  }

  /**
   * 提取主题
   * @param {object} context - 上下文
   * @returns {string} - 主题
   */
  _extractTopic(context) {
    return context.sessionBrief?.topic || '未知主题';
  }

  /**
   * 获取当前状态
   * @param {object} context - 上下文
   * @returns {string} - 当前状态
   */
  _getCurrentState(context) {
    const stateFile = path.join(this.bookRoot, '.fbs', 'esm-state.md');
    if (!fs.existsSync(stateFile)) {
      return 'S0 准备中';
    }
    const content = fs.readFileSync(stateFile, 'utf-8');
    const match = content.match(/currentState:\s*"([A-Z_]+)"/m);
    return match ? match[1] : '未知状态';
  }

  /**
   * 获取会议目标
   * @returns {string} - 会议目标
   */
  _getObjective() {
    switch (this.sessionType) {
      case SESSION_TYPES.CREATIVE:
        return '发散选题角度，防止框架锁定效应';
      case SESSION_TYPES.READER:
        return '以读者视角检验目录与核心论点是否成立';
      case SESSION_TYPES.ADVERSARIAL:
        return '用对抗性论证加固核心论断';
      case SESSION_TYPES.REVIEW:
        return '多角度专业评审，发现内容盲区';
      default:
        return '未知会议目标';
    }
  }

  /**
   * 提取关键背景
   * @param {object} context - 上下文
   * @returns {string} - 关键背景
   */
  _extractKeyBackground(context) {
    // 从工作情报站提取关键背景信息
    const workIntelPath = path.join(this.bookRoot, '.fbs', 'work-intelligence.md');
    if (fs.existsSync(workIntelPath)) {
      const content = fs.readFileSync(workIntelPath, 'utf-8');
      // 提取前300字作为关键背景
      return content.substring(0, Math.min(300, content.length));
    }
    return '暂无关键背景信息';
  }

  /**
   * 格式化会议简报
   * @param {object} brief - 会议简报对象
   * @returns {string} - Markdown 格式
   */
  _formatBrief(brief) {
    return `━━ 会议简报 · ${this.sessionType} ━━
书名：${brief.bookTitle}
主题：${brief.topic}
体裁与读者：${brief.genre} / ${brief.reader}
当前状态：${brief.currentState}
本次目标：${brief.objective}
关键背景（≤300字）：${brief.keyBackground}
━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * 格式化会议纪要
   * @param {object} summary - 会议纪要对象
   * @param {object} result - 会议结果
   * @returns {string} - Markdown 格式
   */
  _formatMeetingSummary(summary, result) {
    const participantText = summary.participants
      .map(role => ROLE_LABELS[role] || role)
      .join(' / ');
    const keyDecisions = summary.keyDecisions.length
      ? summary.keyDecisions.map(item => `- ${item}`).join('\n')
      : '- （暂无）';
    const actionItems = summary.actionItems.length
      ? summary.actionItems.map(item => `- ${item}`).join('\n')
      : '- （暂无）';
    const roleSections = this.roles
      .map((role) => {
        const content = result.divergence?.results?.[role]?.content?.trim() || '（暂无记录）';
        return `### ${ROLE_LABELS[role] || role}\n\n${content}`;
      })
      .join('\n\n');

    const issueSection = this.sessionType === SESSION_TYPES.REVIEW
      ? `\n## P0 / P1 / P2 分级问题清单\n\n${this._formatIssueGrades(summary.issueGrades)}\n`
      : '';

    return `# ${summary.sessionLabel}纪要（${summary.detailFile}）

> 生成时间：${summary.generatedAt}
> 参与角色：${participantText}
> 核心结论：${summary.coreConclusion}

## 核心决策

${keyDecisions}

## 待执行事项

${actionItems}${issueSection}
## 分角色记录

${roleSections}
`;
  }

  /**
   * 格式化决策汇总
   * @param {object} decisions - 决策对象
   * @returns {string} - Markdown 表格行
   */
  _formatDecisionSummary(decisions) {
    return `| ${decisions.generatedAt} | ${decisions.sessionLabel} | ${this._sanitizeTableCell(this._formatSummaryText(decisions.keyDecisions, decisions.coreDecision))} | ${this._sanitizeTableCell(this._formatSummaryText(decisions.actionItems, '待补充'))} | ${decisions.detailFile} |`;
  }

  _getSessionLabel() {
    return SESSION_LABELS[this.sessionType] || this.sessionType;
  }

  _getSessionFileName() {
    return SESSION_FILE_NAMES[this.sessionType] || `${this.sessionType}-session.md`;
  }

  _resolveSessionDetailPath() {
    return path.join(this.bookRoot, '.fbs', 'sessions', this._getSessionFileName());
  }

  _resolveSessionDetailRelativePath() {
    return `.fbs/sessions/${this._getSessionFileName()}`;
  }

  _resolveCoreConclusion(result) {
    if (this.sessionType === SESSION_TYPES.REVIEW) {
      const counts = this._collectIssueGradeCounts(result.issueGrades || result.convergence?.issueGrades || {});
      return counts.total > 0
        ? `已形成分级问题清单（P0 ${counts.P0} / P1 ${counts.P1} / P2 ${counts.P2}）`
        : '已完成评审，待补充分级问题清单';
    }

    if (this.sessionType === SESSION_TYPES.READER) {
      const concerns = Array.isArray(result.concerns) ? result.concerns.length : 0;
      return concerns > 0 ? `已汇总 ${concerns} 条读者关切` : '已完成读者关切汇总';
    }

    const selectedDirection = this._stringifyValue(result.selectedDirection || result.strengthenedArgument || result.convergence?.selectedDirection);
    return selectedDirection || '已形成会议结论';
  }

  _resolveKeyDecisions(result) {
    if (this.sessionType === SESSION_TYPES.REVIEW) {
      const counts = this._collectIssueGradeCounts(result.issueGrades || result.convergence?.issueGrades || {});
      if (counts.total === 0) return ['已完成评审，待人工补充问题分级'];
      return [
        `已形成 P0/P1/P2 分级问题清单（P0 ${counts.P0} 项 / P1 ${counts.P1} 项 / P2 ${counts.P2} 项）`,
        '详细问题来源已按角色写入评审会纪要'
      ];
    }

    if (this.sessionType === SESSION_TYPES.READER) {
      const concerns = Array.isArray(result.concerns) ? result.concerns.slice(0, 3) : [];
      return concerns.length > 0 ? concerns : ['已汇总读者关切'];
    }

    const selectedDirection = this._stringifyValue(result.selectedDirection || result.strengthenedArgument || result.convergence?.selectedDirection);
    const abandoned = Array.isArray(result.abandonedDirections)
      ? result.abandonedDirections.map(item => `搁置：${this._stringifyValue(item)}`).filter(Boolean)
      : [];
    const decisions = [];
    if (selectedDirection) decisions.push(`主结论：${selectedDirection}`);
    return decisions.concat(abandoned).slice(0, 3);
  }

  _resolveActionItems(result) {
    switch (this.sessionType) {
      case SESSION_TYPES.CREATIVE:
        return ['围绕主方向继续展开大纲与章节结构', '保留被放弃方向作为备选素材池'];
      case SESSION_TYPES.READER:
        return ['根据关切清单补强解释顺序与示例', '优先处理影响理解成本的表达问题'];
      case SESSION_TYPES.ADVERSARIAL:
        return ['基于对抗结论回写核心论断', '补强薄弱证据与预防性回应'];
      case SESSION_TYPES.REVIEW:
        return ['按 P0/P1/P2 清单执行修改或接受风险', '由主编补充人类裁决：修改 / 接受风险 / 留待下版'];
      default:
        return ['补充下一步动作'];
    }
  }

  _formatIssueGrades(issueGrades) {
    const grouped = this._groupIssueGrades(issueGrades);
    return ['P0', 'P1', 'P2']
      .map((grade) => {
        const items = grouped[grade];
        const body = items.length > 0 ? items.map(item => `- ${item}`).join('\n') : '- （暂无）';
        return `### ${grade}\n\n${body}`;
      })
      .join('\n\n');
  }

  _groupIssueGrades(issueGrades) {
    const grouped = { P0: [], P1: [], P2: [] };
    for (const [role, roleIssues] of Object.entries(issueGrades || {})) {
      for (const [issue, grade] of Object.entries(roleIssues || {})) {
        const level = ['P0', 'P1', 'P2'].includes(grade) ? grade : 'P2';
        grouped[level].push(`${ROLE_LABELS[role] || role}：${issue}`);
      }
    }
    return grouped;
  }

  _collectIssueGradeCounts(issueGrades) {
    const grouped = this._groupIssueGrades(issueGrades);
    return {
      P0: grouped.P0.length,
      P1: grouped.P1.length,
      P2: grouped.P2.length,
      total: grouped.P0.length + grouped.P1.length + grouped.P2.length,
    };
  }

  _formatSummaryText(items, fallback = '—') {
    const list = Array.isArray(items) ? items.filter(Boolean).slice(0, 3) : [];
    return list.length > 0 ? list.join('；') : fallback;
  }

  _sanitizeTableCell(value) {
    return String(value || '—')
      .replace(/\|/g, '／')
      .replace(/\r?\n+/g, ' / ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _stringifyValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(item => this._stringifyValue(item)).filter(Boolean).join('；');
    if (typeof value === 'object') {
      return value.title || value.direction || value.reason || value.role || JSON.stringify(value);
    }
    return String(value);
  }

  _appendDecisionSummaryRow(filePath, row) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `${SESSIONS_SUMMARY_HEADER.trim()}\n`, 'utf-8');
    }

    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.includes(row)) {
      return;
    }

    content = content.replace('| — | — | — | — | — |\n', '');
    const lines = content.split(/\r?\n/);
    const separatorIndex = lines.findIndex(line => line.trim() === '|------|---------|--------------|---------|---------|');

    if (separatorIndex >= 0) {
      lines.splice(separatorIndex + 1, 0, row);
    } else {
      lines.push(row);
    }

    fs.writeFileSync(filePath, `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`, 'utf-8');
  }

  /**
   * 确保目录存在
   * @param {string} dir - 目录路径
   */
  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }


  // ==================== 角色相关生成方法 ====================

  _generateRadicalDirection(brief) {
    const directions = [
      '完全颠覆传统写法，采用非线性叙事',
      '引入跨学科视角，如将心理学知识融入技术写作',
      '采用第一人称沉浸式叙述，增强代入感'
    ];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  _generateConservativeDirection(brief) {
    const directions = [
      '采用经典三段式结构，逻辑清晰',
      '按照主题-分论-结论的标准议论文结构',
      '采用案例驱动的叙述方式，更易理解'
    ];
    return directions[Math.floor(Math.random() * directions.length)];
  }

  _generateReaderConcern(brief) {
    const concerns = [
      '章节逻辑是否清晰，读者能否跟上思路',
      '专业术语是否过多，是否影响可读性',
      '是否有足够的图表和案例，帮助理解'
    ];
    return concerns[Math.floor(Math.random() * concerns.length)];
  }

  _generateStrongArgument(brief) {
    const strongArguments = [
      '根据书中第X章的具体内容，核心论点是...',
      '基于引用的权威数据（来源：XXX），可以得出...',
      '通过实际案例（XXX页），证明了...'
    ];
    return strongArguments[Math.floor(Math.random() * strongArguments.length)];
  }


  _generateStrongCounterargument(brief) {
    const counterarguments = [
      '第X章的论据存在逻辑跳跃：A推导到B之间缺少必要的中间步骤',
      '引用的数据来源（XXX）存在时效性问题，最新的研究显示...',
      '该案例的特殊性导致其不具备普遍代表性'
    ];
    return counterarguments[Math.floor(Math.random() * counterarguments.length)];
  }

  _checkContentPoint(brief) {
    const points = [
      '核心论点是否成立？有没有关键论据缺失？',
      '哪里有逻辑跳跃？',
      '哪些地方读者最可能反驳？'
    ];
    return points[Math.floor(Math.random() * points.length)];
  }

  _checkNarrativeRhythm(brief) {
    const rhythms = [
      '某些章节节奏拖沓，需要压缩或展开',
      '哪里读者会失去耐心？',
      '哪里太突兀？'
    ];
    return rhythms[Math.floor(Math.random() * rhythms.length)];
  }

  _generateCounterargument(brief) {
    const counterarguments = [
      '第X章的论据存在逻辑跳跃：A推导到B之间缺少必要的中间步骤',
      '引用的数据来源（XXX）存在时效性问题，最新的研究显示...',
      '该案例的特殊性导致其不具备普遍代表性'
    ];
    return counterarguments[Math.floor(Math.random() * counterarguments.length)];
  }

  /**
   * 分析创意方向
   * @param {object} divergenceResults - 发散结果
   * @returns {Array} - 方向分析结果
   */
  async _analyzeCreativeDirections(divergenceResults) {
    // 分析三个方向的优劣
    const directions = [
      {
        role: ROLES.RADICAL,
        score: 8,
        reason: '创新性强，但风险较高'
      },
      {
        role: ROLES.CONSERVATIVE,
        score: 9,
        reason: '风险低，实施可行'
      },
      {
        role: ROLES.READER,
        score: 7,
        reason: '贴近读者，但可能不够创新'
      }
    ];
    
    return directions.sort((a, b) => b.score - a.score);
  }

  /**
   * 汇总读者关切
   * @param {object} divergenceResults - 发散结果
   * @returns {Promise<Array>} - 关切清单
   */
  async _summarizeReaderConcerns(divergenceResults) {
    const concerns = [];
    
    for (const role of this.roles) {
      const roleContent = divergenceResults.results[role].content;
      const extractedConcerns = this._extractReaderConcerns(roleContent);
      concerns.push(...extractedConcerns);
    }
    
    // 去重
    return [...new Set(concerns)].slice(0, 10);
  }

  /**
   * 提取读者关切
   * @param {string} content - 内容
   * @returns {Array} - 关切列表
   */
  _extractReaderConcerns(content) {
    const concerns = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.includes('关切') || line.includes('关心') || line.includes('问题')) {
        concerns.push(line.trim().replace(/^[\d#\.]\s*/, ''));
      }
    }
    
    return concerns;
  }

  /**
   * 提取问题
   * @param {string} content - 内容
   * @returns {Array} - 问题列表
   */
  _extractIssues(content) {
    const issues = [];
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.includes('检查') || line.includes('问题') || line.includes('跳跃')) {
        issues.push(line.trim().replace(/^[\d#\.]\s*/, ''));
      }
    }
    
    return issues;
  }

  /**
   * 评级问题
   * @param {Array} issues - 问题列表
   * @returns {object} - 评级结果
   */
  _gradeIssues(issues) {
    const grades = {};
    
    for (const issue of issues) {
      // 简化的评级逻辑
      if (issue.includes('严重') || issue.includes('致命')) {
        grades[issue] = 'P0';
      } else if (issue.includes('重要') || issue.includes('建议')) {
        grades[issue] = 'P1';
      } else {
        grades[issue] = 'P2';
      }
    }
    
    return grades;
  }

  // 强制收敛标记
  set forcedConvergence(value) {
    this.forcedConvergence = value;
  }

  // 获取会议时长配置
  getDurationConfig() {
    const mode = this.mode || 'normal';
    return DURATION_LIMITS[this.sessionType]?.[mode] || DURATION_LIMITS[this.sessionType].normal;
  }
}

export default SessionAgent;
