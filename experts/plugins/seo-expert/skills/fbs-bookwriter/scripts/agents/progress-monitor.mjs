#!/usr/bin/env node
/**
 * 进度监控器
 * 
 * 功能:
 * - 工作流进度监控
 * - 智能体性能监控
 * - 资源使用监控
 * - 实时报告生成
 */

import { getEventBus } from './event-bus.mjs';

export class ProgressMonitor {
  constructor(options = {}) {
    this.options = {
      reportInterval: options.reportInterval || 5000, // 5秒
      enableAutoReport: options.enableAutoReport !== false,
      ...options
    };
    
    this.eventBus = getEventBus();
    this.workflows = new Map();
    this.agentMetrics = new Map();
    this.resourceMetrics = {
      cpu: 0,
      memory: 0,
      activeTasks: 0,
      queuedTasks: 0
    };
    
    this.reportTimer = null;
    this._setupEventHandlers();
  }

  /**
   * 启动监控
   */
  start() {
    console.log('[ProgressMonitor] Started');
    
    if (this.options.enableAutoReport) {
      this._startAutoReport();
    }
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = null;
    }
    
    console.log('[ProgressMonitor] Stopped');
  }

  /**
   * 注册工作流
   * @param {object} workflow - 工作流对象
   */
  registerWorkflow(workflow) {
    this.workflows.set(workflow.workflowId, {
      ...workflow,
      stages: {},
      startTime: Date.now(),
      endTime: null,
      progress: 0
    });
    
    console.log(`[ProgressMonitor] Workflow registered: ${workflow.workflowId}`);
  }

  /**
   * 更新工作流进度
   * @param {string} workflowId - 工作流ID
   * @param {object} update - 更新数据
   */
  updateWorkflowProgress(workflowId, update) {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      console.warn(`[ProgressMonitor] Workflow not found: ${workflowId}`);
      return;
    }
    
    // 更新工作流数据
    Object.assign(workflow, update);
    
    // 计算进度
    if (workflow.chapters) {
      const total = workflow.chapters.length;
      const completed = workflow.chapters.filter(ch => ch.status === 'completed').length;
      workflow.progress = (completed / total) * 100;
    }
    
    // 发布进度更新事件
    this.publishEvent('monitor.workflow.progress', {
      workflowId,
      progress: workflow.progress,
      workflow
    });
  }

  /**
   * 记录智能体指标
   * @param {string} agentId - 智能体ID
   * @param {object} metrics - 指标数据
   */
  recordAgentMetrics(agentId, metrics) {
    const existing = this.agentMetrics.get(agentId) || {
      tasksCompleted: 0,
      tasksFailed: 0,
      avgDuration: 0,
      totalDuration: 0
    };
    
    existing.tasksCompleted += metrics.tasksCompleted || 0;
    existing.tasksFailed += metrics.tasksFailed || 0;
    existing.totalDuration += metrics.totalDuration || 0;
    
    if (existing.tasksCompleted > 0) {
      existing.avgDuration = existing.totalDuration / existing.tasksCompleted;
    }
    
    this.agentMetrics.set(agentId, existing);
  }

  /**
   * 更新资源指标
   * @param {object} metrics - 指标数据
   */
  updateResourceMetrics(metrics) {
    Object.assign(this.resourceMetrics, metrics);
  }

  /**
   * 生成进度报告
   * @returns {object} - 进度报告
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      workflows: this._generateWorkflowReport(),
      agents: this._generateAgentReport(),
      resources: { ...this.resourceMetrics },
      summary: this._generateSummary()
    };
    
    return report;
  }

  /**
   * 打印进度报告
   */
  printReport() {
    const report = this.generateReport();
    
    console.log('\n========== 进度报告 ==========');
    console.log(`时间: ${report.timestamp}`);
    console.log(`\n工作流:`);
    
    report.workflows.forEach(wf => {
      const status = wf.status === 'completed' ? '✅' : 
                     wf.status === 'failed' ? '❌' : '⏳';
      console.log(`  ${status} ${wf.workflowId}: ${wf.progress.toFixed(1)}% (${wf.chapters?.total || 0} 章节)`);
    });
    
    console.log(`\n智能体:`);
    
    report.agents.forEach(agent => {
      console.log(`  ${agent.agentId}: 完成 ${agent.tasksCompleted}, 失败 ${agent.tasksFailed}, 平均耗时 ${agent.avgDuration.toFixed(0)}ms`);
    });
    
    console.log(`\n资源:`);
    console.log(`  活动任务: ${report.resources.activeTasks}`);
    console.log(`  队列任务: ${report.resources.queuedTasks}`);
    
    console.log(`\n总结:`);
    console.log(`  总工作流: ${report.summary.totalWorkflows}`);
    console.log(`  已完成: ${report.summary.completedWorkflows}`);
    console.log(`  进行中: ${report.summary.activeWorkflows}`);
    console.log(`  总体进度: ${report.summary.overallProgress.toFixed(1)}%`);
    
    console.log('============================\n');
  }

  // ========== 私有方法 ==========

  _setupEventHandlers() {
    // 监听任务完成事件
    this.eventBus.subscribe('task.complete', (message) => {
      const { agentId } = message.payload;
      this.recordAgentMetrics(agentId, {
        tasksCompleted: 1,
        totalDuration: message.payload.duration
      });
    });
    
    // 监听任务失败事件
    this.eventBus.subscribe('task.failure', (message) => {
      const { agentId } = message.payload;
      this.recordAgentMetrics(agentId, {
        tasksFailed: 1
      });
    });
    
    // 监听工作流完成事件
    this.eventBus.subscribe('parallel.workflow.completed', (message) => {
      const { workflowId, workflowResult } = message.payload;
      this.updateWorkflowProgress(workflowId, {
        status: workflowResult.status,
        endTime: Date.now(),
        progress: 100
      });
    });
    
    // 监听并行工作流进度事件
    this.eventBus.subscribe('parallel.workflow.progress', (message) => {
      this.updateResourceMetrics({
        activeTasks: message.payload.activeTasks || 0,
        queuedTasks: message.payload.queuedTasks || 0
      });
    });
  }

  _startAutoReport() {
    this.reportTimer = setInterval(() => {
      this.printReport();
    }, this.options.reportInterval);
  }

  _generateWorkflowReport() {
    return Array.from(this.workflows.values()).map(wf => ({
      workflowId: wf.workflowId,
      status: wf.status,
      progress: wf.progress,
      startTime: wf.startTime,
      endTime: wf.endTime,
      duration: wf.endTime ? wf.endTime - wf.startTime : null,
      chapters: {
        total: wf.chapters?.length || 0,
        completed: wf.chapters?.filter(ch => ch.status === 'completed').length || 0,
        failed: wf.chapters?.filter(ch => ch.status === 'failed').length || 0
      }
    }));
  }

  _generateAgentReport() {
    return Array.from(this.agentMetrics.entries()).map(([agentId, metrics]) => ({
      agentId,
      ...metrics
    }));
  }

  _generateSummary() {
    const workflows = Array.from(this.workflows.values());
    const totalWorkflows = workflows.length;
    const completedWorkflows = workflows.filter(wf => wf.status === 'completed').length;
    const activeWorkflows = workflows.filter(wf => wf.status === 'running').length;
    const overallProgress = workflows.reduce((sum, wf) => sum + wf.progress, 0) / (totalWorkflows || 1);
    
    return {
      totalWorkflows,
      completedWorkflows,
      activeWorkflows,
      overallProgress
    };
  }

  publishEvent(topic, payload) {
    const message = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fromAgent: 'ProgressMonitor',
      timestamp: new Date().toISOString(),
      type: topic,
      payload
    };
    this.eventBus.publish(topic, message);
  }
}
