#!/usr/bin/env node
/**
 * 事件订阅器
 * 
 * 职责:
 * - 统一订阅所有事件
 * - 平衡事件订阅/发布
 * - 提供事件处理钩子
 */

import { getEventBus } from './event-bus.mjs';

export class EventSubscriber {
  constructor(options = {}) {
    this.options = {
      enableLogging: options.enableLogging !== false,
      enableAggregation: options.enableAggregation !== false,
      aggregationInterval: options.aggregationInterval || 1000, // 1秒
      ...options
    };
    
    this.eventBus = getEventBus();
    this.subscribedEvents = new Map(); // eventTopic -> handler
    this.aggregatedEvents = new Map(); // eventTopic -> [events]
    this.aggregationTimer = null;
    
    this.stats = {
      totalReceived: 0,
      totalProcessed: 0,
      eventsByType: {}
    };
    
    this._initialize();
  }

  /**
   * 初始化事件订阅
   */
  _initialize() {
    // 订阅任务事件
    this.subscribe('task.assign', this._handleTaskAssign.bind(this));
    this.subscribe('task.complete', this._handleTaskComplete.bind(this));
    this.subscribe('task.failure', this._handleTaskFailure.bind(this));
    
    // 订阅验证事件
    this.subscribe('validation.result', this._handleValidationResult.bind(this));
    
    // 订阅审计事件
    this.subscribe('audit.result', this._handleAuditResult.bind(this));
    
    // 订阅智能体状态事件
    this.subscribe('agent.started', this._handleAgentStarted.bind(this));
    this.subscribe('agent.stopped', this._handleAgentStopped.bind(this));
    this.subscribe('agent.error', this._handleAgentError.bind(this));
    
    // 订阅阶段完成事件
    this.subscribe('s0.brief.generated', this._handleStageCompleted.bind(this, 'S0'));
    this.subscribe('s1.positioning.generated', this._handleStageCompleted.bind(this, 'S1'));
    this.subscribe('s2.draft.generated', this._handleStageCompleted.bind(this, 'S2'));
    this.subscribe('s3.finalization.generated', this._handleStageCompleted.bind(this, 'S3'));
    this.subscribe('s4.review.completed', this._handleStageCompleted.bind(this, 'S4'));
    this.subscribe('s5.delivery.completed', this._handleStageCompleted.bind(this, 'S5'));
    this.subscribe('s6.transformation.completed', this._handleStageCompleted.bind(this, 'S6'));
    this.subscribe('s6.archive.completed', this._handleStageCompleted.bind(this, 'S6'));
    
    // 订阅工作流事件
    this.subscribe('esm.transition.start', this._handleESMTransitionStart.bind(this));
    this.subscribe('esm.transition.complete', this._handleESMTransitionComplete.bind(this));
    this.subscribe('esm.state.announce', this._handleESMStateAnnounce.bind(this));
    this.subscribe('parallel.workflow.completed', this._handleParallelWorkflowCompleted.bind(this));
    this.subscribe('parallel.workflow.progress', this._handleParallelWorkflowProgress.bind(this));
    this.subscribe('pipeline.started', this._handlePipelineStarted.bind(this));
    this.subscribe('pipeline.stopped', this._handlePipelineStopped.bind(this));
    this.subscribe('monitor.workflow.progress', this._handleMonitorWorkflowProgress.bind(this));
    
    console.log('[EventSubscriber] Initialized with ' + this.subscribedEvents.size + ' event subscriptions');
  }

  /**
   * 订阅事件
   * @param {string} topic - 事件主题
   * @param {function} handler - 处理函数
   */
  subscribe(topic, handler) {
    this.eventBus.subscribe(topic, handler);
    this.subscribedEvents.set(topic, handler);
    
    console.log(`[EventSubscriber] Subscribed to: ${topic}`);
  }

  /**
   * 开始事件聚合
   */
  startAggregation() {
    if (this.aggregationTimer) {
      console.warn('[EventSubscriber] Aggregation already started');
      return;
    }
    
    this.aggregationTimer = setInterval(() => {
      this._processAggregatedEvents();
    }, this.options.aggregationInterval);
    
    console.log('[EventSubscriber] Aggregation started');
  }

  /**
   * 停止事件聚合
   */
  stopAggregation() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    console.log('[EventSubscriber] Aggregation stopped');
  }

  /**
   * 获取统计
   * @returns {object} - 统计信息
   */
  getStats() {
    return {
      ...this.stats,
      subscribedEvents: this.subscribedEvents.size,
      aggregatedEvents: Array.from(this.aggregatedEvents.entries()).reduce((sum, [_, events]) => sum + events.length, 0)
    };
  }

  /**
   * 打印统计
   */
  printStats() {
    const stats = this.getStats();
    
    console.log('\n========== 事件订阅器统计 ==========');
    console.log(`总接收事件: ${stats.totalReceived}`);
    console.log(`总处理事件: ${stats.totalProcessed}`);
    console.log(`订阅事件数: ${stats.subscribedEvents}`);
    console.log(`聚合事件数: ${stats.aggregatedEvents}`);
    
    if (Object.keys(stats.eventsByType).length > 0) {
      console.log('\n按类型统计:');
      for (const [type, count] of Object.entries(stats.eventsByType)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    
    console.log('====================================\n');
  }

  // ========== 事件处理函数 ==========

  _handleTaskAssign(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('task.assign');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Task assigned: ${message.payload.taskId}`);
    }
  }

  _handleTaskComplete(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('task.complete');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Task completed: ${message.payload.taskId} (duration: ${message.payload.duration}ms)`);
    }
  }

  _handleTaskFailure(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('task.failure');
    
    if (this.options.enableLogging) {
      console.error(`[EventSubscriber] Task failed: ${message.payload.taskId} - ${message.payload.error}`);
    }
  }

  _handleValidationResult(message) {
    this.stats.totalReceived++;
    
    // 聚合验证结果
    if (this.options.enableAggregation) {
      const events = this.aggregatedEvents.get('validation.result') || [];
      events.push(message);
      this.aggregatedEvents.set('validation.result', events);
    } else {
      this.stats.totalProcessed++;
    }
    
    this._updateEventTypeStats('validation.result');
  }

  _handleAuditResult(message) {
    this.stats.totalReceived++;
    
    // 聚合审计结果
    if (this.options.enableAggregation) {
      const events = this.aggregatedEvents.get('audit.result') || [];
      events.push(message);
      this.aggregatedEvents.set('audit.result', events);
    } else {
      this.stats.totalProcessed++;
    }
    
    this._updateEventTypeStats('audit.result');
  }

  _handleAgentStarted(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('agent.started');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Agent started: ${message.payload.agentId}`);
    }
  }

  _handleAgentStopped(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('agent.stopped');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Agent stopped: ${message.payload.agentId}`);
    }
  }

  _handleAgentError(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('agent.error');
    
    if (this.options.enableLogging) {
      console.error(`[EventSubscriber] Agent error: ${message.payload.agentId} - ${message.payload.error}`);
    }
  }

  _handleStageCompleted(stage, message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats(`stage.${stage}`);
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Stage ${stage} completed: ${message.payload.chapterId}`);
    }
  }

  _handleESMTransitionStart(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('esm.transition.start');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] ESM transition start: ${message.payload.fromState} -> ${message.payload.targetState}`);
    }
  }

  _handleESMTransitionComplete(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('esm.transition.complete');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] ESM transition complete: ${message.payload.fromState} -> ${message.payload.targetState}`);
    }
  }

  _handleESMStateAnnounce(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('esm.state.announce');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] ESM state: ${message.payload.currentState} (chapter: ${message.payload.chapterId})`);
    }
  }

  _handleParallelWorkflowCompleted(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('parallel.workflow.completed');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Parallel workflow completed: ${message.payload.workflowId}`);
    }
  }

  _handleParallelWorkflowProgress(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('parallel.workflow.progress');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Parallel workflow progress: ${message.payload.progress.toFixed(1)}%`);
    }
  }

  _handlePipelineStarted(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('pipeline.started');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Pipeline started: ${message.payload.pipelineId}`);
    }
  }

  _handlePipelineStopped(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('pipeline.stopped');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Pipeline stopped: ${message.payload.pipelineId}`);
    }
  }

  _handleMonitorWorkflowProgress(message) {
    this.stats.totalReceived++;
    this.stats.totalProcessed++;
    this._updateEventTypeStats('monitor.workflow.progress');
    
    if (this.options.enableLogging) {
      console.log(`[EventSubscriber] Monitor workflow progress: ${message.payload.progress.toFixed(1)}%`);
    }
  }

  // ========== 私有方法 ==========

  _processAggregatedEvents() {
    for (const [eventType, events] of this.aggregatedEvents.entries()) {
      if (events.length === 0) continue;
      
      // 处理聚合的事件
      console.log(`[EventSubscriber] Processing ${events.length} aggregated ${eventType} events`);
      
      // 更新统计
      this.stats.totalProcessed += events.length;
      
      // 清空已处理的事件
      this.aggregatedEvents.set(eventType, []);
    }
  }

  _updateEventTypeStats(eventType) {
    if (!this.stats.eventsByType[eventType]) {
      this.stats.eventsByType[eventType] = 0;
    }
    this.stats.eventsByType[eventType]++;
  }
}
