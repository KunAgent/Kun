#!/usr/bin/env node
/**
 * ESM 编排器
 * 
 * 职责:
 * - ESM状态机管理
 * - 流程控制
 * - 任务编排
 * - 智能体协调
 */

import { AgentBase } from './agent-base.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ESM状态定义
const ESM_STATES = {
  S_READY: 'S_READY',
  S0: 'S0',
  S1: 'S1',
  S2: 'S2',
  S3: 'S3',
  S4: 'S4',
  S5: 'S5',
  S6: 'S6',
  S_END: 'S_END'
};

// ESM状态转换规则
const ESM_TRANSITIONS = {
  [ESM_STATES.S_READY]: [ESM_STATES.S0],
  [ESM_STATES.S0]: [ESM_STATES.S1],
  [ESM_STATES.S1]: [ESM_STATES.S2],
  [ESM_STATES.S2]: [ESM_STATES.S3, ESM_STATES.S1],
  [ESM_STATES.S3]: [ESM_STATES.S4],
  [ESM_STATES.S4]: [ESM_STATES.S5],
  [ESM_STATES.S5]: [ESM_STATES.S6],
  [ESM_STATES.S6]: [ESM_STATES.S_END]
};

// 阶段与智能体映射
const STAGE_AGENT_MAPPING = {
  [ESM_STATES.S0]: 'Research-Agent',
  [ESM_STATES.S1]: 'Writing-Agent',
  [ESM_STATES.S2]: 'Writing-Agent',
  [ESM_STATES.S3]: 'Writing-Agent',
  [ESM_STATES.S4]: 'Review-Agent',
  [ESM_STATES.S5]: 'Audit-Agent',
  [ESM_STATES.S6]: 'Deploy-Agent'
};

export class ESMOrchestrator extends AgentBase {
  constructor(config = {}) {
    super({
      agentId: 'esm-orchestrator',
      agentName: 'ESM-Orchestrator',
      agentType: 'orchestrator',
      capabilities: [
        'esm-state-management',
        'flow-control',
        'task-orchestration',
        'agent-coordination'
      ],
      ...config
    });
    
    this.currentState = ESM_STATES.S_READY;
    this.chapterContexts = new Map(); // chapterId -> context
    this.pendingTransitions = new Map(); // chapterId -> transition info
    this.transitionHistory = [];
  }

  /**
   * 启动工作流
   * @param {object} request - 请求对象
   * @returns {Promise<object>} - 工作流结果
   */
  async startWorkflow(request) {
    const { chapterId, bookRoot, mode = 'parallel_writing' } = request;
    
    console.log(`[ESM-Orchestrator] Starting workflow for chapter: ${chapterId}`);
    
    // 初始化章节上下文
    this._initChapterContext(chapterId, bookRoot, mode);
    
    // 触发S0阶段
    await this.transitionTo(chapterId, ESM_STATES.S0, request);
    
    return {
      success: true,
      chapterId,
      currentState: this.currentState
    };
  }

  /**
   * 状态转换
   * @param {string} chapterId - 章节ID
   * @param {string} targetState - 目标状态
   * @param {object} payload - 转换负载
   */
  async transitionTo(chapterId, targetState, payload = {}) {
    const context = this.chapterContexts.get(chapterId);
    if (!context) {
      throw new Error(`Chapter context not found: ${chapterId}`);
    }
    
    const fromState = context.currentState;
    
    // 验证转换合法性
    if (!this._isValidTransition(fromState, targetState)) {
      throw new Error(`Invalid transition: ${fromState} -> ${targetState}`);
    }
    
    console.log(`[ESM-Orchestrator] Transition: ${fromState} -> ${targetState} (chapter: ${chapterId})`);
    
    // 记录转换信息
    this.pendingTransitions.set(chapterId, {
      fromState,
      targetState,
      payload,
      startTime: Date.now()
    });
    
    // 执行状态转换前钩子
    await this._beforeTransition(chapterId, fromState, targetState, payload);
    
    // 执行状态转换
    await this._executeTransition(chapterId, fromState, targetState, payload);
    
    // 更新上下文
    context.currentState = targetState;
    context.stateHistory.push({
      state: targetState,
      timestamp: Date.now()
    });
    
    // 执行状态转换后钩子
    await this._afterTransition(chapterId, fromState, targetState, payload);
    
    // 记录转换历史
    this.transitionHistory.push({
      chapterId,
      fromState,
      targetState,
      timestamp: Date.now()
    });
    
    // 发布转换完成事件
    this.publishEvent('esm.transition.complete', {
      chapterId,
      fromState,
      targetState,
      payload
    });
    
    // 清理待处理转换
    this.pendingTransitions.delete(chapterId);
    
    // 自动触发下一个状态(如果有)
    const nextState = this._getNextState(targetState);
    if (nextState) {
      await this.transitionTo(chapterId, nextState, payload);
    }
  }

  /**
   * 获取当前状态
   * @param {string} chapterId - 章节ID
   * @returns {string} - 当前状态
   */
  getCurrentState(chapterId) {
    const context = this.chapterContexts.get(chapterId);
    return context ? context.currentState : null;
  }

  /**
   * 获取状态历史
   * @param {string} chapterId - 章节ID
   * @returns {array} - 状态历史
   */
  getStateHistory(chapterId) {
    const context = this.chapterContexts.get(chapterId);
    return context ? context.stateHistory : [];
  }

  // ========== 私有方法 ==========

  _initChapterContext(chapterId, bookRoot, mode) {
    this.chapterContexts.set(chapterId, {
      chapterId,
      bookRoot,
      mode,
      currentState: ESM_STATES.S_READY,
      stateHistory: [ESM_STATES.S_READY],
      startTime: Date.now()
    });
  }

  _isValidTransition(fromState, targetState) {
    const validTransitions = ESM_TRANSITIONS[fromState] || [];
    return validTransitions.includes(targetState);
  }

  _getNextState(currentState) {
    const transitions = ESM_TRANSITIONS[currentState];
    // 默认返回第一个有效转换
    return transitions && transitions.length > 0 ? transitions[0] : null;
  }

  async _beforeTransition(chapterId, fromState, targetState, payload) {
    console.log(`[ESM-Orchestrator] Before transition: ${fromState} -> ${targetState}`);
    
    // 发布转换开始事件
    this.publishEvent('esm.transition.start', {
      chapterId,
      fromState,
      targetState,
      payload
    });
    
    // 调用状态切换验证
    await this._validateTransition(chapterId, fromState, targetState, payload);
  }

  async _executeTransition(chapterId, fromState, targetState, payload) {
    console.log(`[ESM-Orchestrator] Executing transition: ${fromState} -> ${targetState}`);
    
    // 根据目标状态分配任务给对应的智能体
    const agentName = STAGE_AGENT_MAPPING[targetState];
    if (agentName) {
      await this._assignTaskToAgent(chapterId, targetState, agentName, payload);
    }
  }

  async _afterTransition(chapterId, fromState, targetState, payload) {
    console.log(`[ESM-Orchestrator] After transition: ${fromState} -> ${targetState}`);
    
    // 记录ESM状态转换
    await this._recordESMTransition(chapterId, fromState, targetState, payload);
    
    // 发布状态切换宣告
    this.publishEvent('esm.state.announce', {
      chapterId,
      currentState: targetState,
      fromState
    });
  }

  async _validateTransition(chapterId, fromState, targetState, payload) {
    // 这里可以调用验证工具,如 audit-state-transition.mjs
    // 暂时跳过,后续集成
    console.log(`[ESM-Orchestrator] Validating transition: ${fromState} -> ${targetState}`);
  }

  async _assignTaskToAgent(chapterId, state, agentName, payload) {
    const task = {
      taskId: `task-${chapterId}-${state}-${Date.now()}`,
      chapterId,
      state,
      agentName,
      payload: {
        ...payload,
        bookRoot: this.chapterContexts.get(chapterId).bookRoot,
        mode: this.chapterContexts.get(chapterId).mode
      }
    };
    
    console.log(`[ESM-Orchestrator] Assigning task to ${agentName}: ${task.taskId}`);
    
    // 发布任务分配事件
    this.publishEvent('task.assign', task);
    
    // 等待任务完成(通过事件监听)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.eventBus.unsubscribe('task.complete', taskCompleteHandler);
        reject(new Error(`Task timeout: ${task.taskId}`));
      }, 5 * 60 * 1000); // 5分钟超时
      
      const taskCompleteHandler = (message) => {
        if (message.payload.taskId === task.taskId) {
          clearTimeout(timeout);
          this.eventBus.unsubscribe('task.complete', taskCompleteHandler);
          console.log(`[ESM-Orchestrator] Task completed: ${task.taskId}`);
          resolve(message.payload.result);
        }
      };
      
      this.eventBus.subscribe('task.complete', taskCompleteHandler);
    });
  }

  async _recordESMTransition(chapterId, fromState, targetState, payload) {
    // 这里可以调用 fbs-record-esm-transition.mjs 记录状态转换
    // 暂时跳过,后续集成
    console.log(`[ESM-Orchestrator] Recording transition: ${fromState} -> ${targetState}`);
  }

  /**
   * 执行任务(覆盖基类方法)
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 任务结果
   */
  async executeTask(task) {
    throw new Error('ESM-Orchestrator does not execute tasks directly');
  }
}
