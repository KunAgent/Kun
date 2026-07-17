#!/usr/bin/env node
/**
 * 智能体基类
 * 
 * 功能:
 * - 智能体生命周期管理
 * - 消息处理
 * - 状态管理
 * - 性能监控
 */

import { getEventBus } from './event-bus.mjs';

export class AgentBase {
  constructor(config = {}) {
    this.agentId = config.agentId || this._generateAgentId();
    this.agentName = config.agentName || 'UnknownAgent';
    this.agentType = config.agentType || 'generic';
    this.capabilities = config.capabilities || [];
    
    this.state = 'idle'; // idle, busy, error
    this.currentTask = null;
    this.taskQueue = [];
    this.maxConcurrentTasks = config.maxConcurrentTasks || 1;
    
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      avgDurationMs: 0,
      totalDurationMs: 0,
      successRate: 1.0
    };
    
    this.eventBus = getEventBus(config.eventBusOptions);
    this._setupEventHandlers();
  }

  /**
   * 启动智能体
   */
  start() {
    this.state = 'idle';
    console.log(`[${this.agentName}] Started`);
    this.publishEvent('agent.started', {
      agentId: this.agentId,
      agentName: this.agentName,
      agentType: this.agentType
    });
  }

  /**
   * 停止智能体
   */
  stop() {
    this.state = 'stopped';
    console.log(`[${this.agentName}] Stopped`);
    this.publishEvent('agent.stopped', {
      agentId: this.agentId,
      agentName: this.agentName
    });
  }

  /**
   * 分配任务
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 任务结果
   */
  async assignTask(task) {
    if (this.state === 'stopped') {
      throw new Error(`${this.agentName} is stopped`);
    }

    // 如果当前忙,加入队列
    if (this.state === 'busy') {
      this.taskQueue.push(task);
      console.log(`[${this.agentName}] Task queued: ${task.taskId}`);
      return this._waitForTaskCompletion(task.taskId);
    }

    return this._executeTask(task);
  }

  /**
   * 处理消息
   * @param {string} topic - 消息主题
   * @param {object} message - 消息对象
   */
  async handleMessage(topic, message) {
    console.log(`[${this.agentName}] Received message: ${topic}`);
    
    try {
      if (topic === 'task.assign') {
        const result = await this.assignTask(message.payload);
        this.eventBus.respond(topic, {
          messageId: message.messageId,
          payload: result
        });
      } else {
        await this.handleCustomMessage(topic, message);
      }
    } catch (error) {
      console.error(`[${this.agentName}] Error handling message:`, error);
      this.publishEvent('agent.error', {
        agentId: this.agentId,
        agentName: this.agentName,
        error: error.message,
        topic,
        message
      });
    }
  }

  /**
   * 自定义消息处理(子类覆盖)
   * @param {string} topic - 消息主题
   * @param {object} message - 消息对象
   */
  async handleCustomMessage(topic, message) {
    console.log(`[${this.agentName}] No custom handler for: ${topic}`);
  }

  /**
   * 发布事件
   * @param {string} topic - 事件主题
   * @param {object} payload - 事件负载
   */
  publishEvent(topic, payload) {
    const message = {
      messageId: this._generateMessageId(),
      fromAgent: this.agentName,
      timestamp: new Date().toISOString(),
      type: topic,
      payload
    };
    this.eventBus.publish(topic, message);
  }

  /**
   * 获取性能指标
   * @returns {object} - 性能指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      state: this.state,
      currentTask: this.currentTask,
      queueLength: this.taskQueue.length
    };
  }

  // ========== 私有方法 ==========

  async _executeTask(task) {
    const startTime = Date.now();
    this.state = 'busy';
    this.currentTask = task;
    
    console.log(`[${this.agentName}] Executing task: ${task.taskId}`);
    
    try {
      // 执行任务(子类覆盖)
      const result = await this.executeTask(task);
      
      const duration = Date.now() - startTime;
      this.metrics.tasksCompleted++;
      this.metrics.totalDurationMs += duration;
      this.metrics.avgDurationMs = 
        this.metrics.totalDurationMs / this.metrics.tasksCompleted;
      this.metrics.successRate = 
        this.metrics.tasksCompleted / (this.metrics.tasksCompleted + this.metrics.tasksFailed);
      
      this.publishEvent('task.complete', {
        taskId: task.taskId,
        result,
        duration,
        agentId: this.agentId
      });
      
      return result;
    } catch (error) {
      this.metrics.tasksFailed++;
      this.metrics.successRate = 
        this.metrics.tasksCompleted / (this.metrics.tasksCompleted + this.metrics.tasksFailed);
      
      this.publishEvent('task.failure', {
        taskId: task.taskId,
        error: error.message,
        agentId: this.agentId
      });
      
      throw error;
    } finally {
      this.state = 'idle';
      this.currentTask = null;
      
      // 处理队列中的下一个任务
      if (this.taskQueue.length > 0) {
        const nextTask = this.taskQueue.shift();
        this._executeTask(nextTask);
      }
    }
  }

  async _waitForTaskCompletion(taskId) {
    return new Promise((resolve) => {
      const checkTask = () => {
        const completedTask = this.completedTasks?.get(taskId);
        if (completedTask) {
          resolve(completedTask);
        } else {
          setTimeout(checkTask, 100);
        }
      };
      checkTask();
    });
  }

  _setupEventHandlers() {
    // 订阅任务分配事件
    this.eventBus.subscribe('task.assign', (message) => {
      this.handleMessage('task.assign', message);
    });
  }

  _generateAgentId() {
    return `${this.agentName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  _generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
