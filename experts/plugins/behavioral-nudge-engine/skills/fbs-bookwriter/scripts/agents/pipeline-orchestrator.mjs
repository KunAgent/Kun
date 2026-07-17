#!/usr/bin/env node
/**
 * 流水线编排器
 * 
 * 职责:
 * - 管理流水线生命周期
 * - 协调各阶段调度
 * - 监控流水线健康
 * - 处理异常和恢复
 */

import { getEventBus } from './event-bus.mjs';
import { AgentPool } from './agent-pool.mjs';
import { LoadBalancer } from './load-balancer.mjs';
import { FailureRecovery } from './failure-recovery.mjs';
import { ResearchAgent } from './research-agent.mjs';
import { WritingAgent } from './writing-agent.mjs';
import { ReviewAgent } from './review-agent.mjs';
import { DeployAgent } from './deploy-agent.mjs';

// 流水线阶段定义
const PIPELINE_STAGES = [
  { name: 'S0', agentType: 'research', AgentClass: ResearchAgent },
  { name: 'S1', agentType: 'writing', AgentClass: WritingAgent },
  { name: 'S2', agentType: 'writing', AgentClass: WritingAgent },
  { name: 'S3', agentType: 'writing', AgentClass: WritingAgent },
  { name: 'S4', agentType: 'review', AgentClass: ReviewAgent },
  { name: 'S5', agentType: 'deploy', AgentClass: DeployAgent },
  { name: 'S6', agentType: 'deploy', AgentClass: DeployAgent }
];

export class PipelineOrchestrator {
  constructor(options = {}) {
    this.options = {
      maxConcurrencyPerStage: options.maxConcurrencyPerStage || 2,
      queueSize: options.queueSize || 100,
      ...options
    };
    
    this.eventBus = getEventBus();
    this.stages = new Map(); // stageName -> { queue, concurrency, activeTasks }
    this.agentPools = new Map(); // agentType -> AgentPool
    this.loadBalancers = new Map(); // stageName -> LoadBalancer
    this.failureRecovery = new FailureRecovery();
    
    this.inputQueue = [];
    this.outputQueue = [];
    this.isRunning = false;
    this.pipelineId = `pipeline-${Date.now()}`;
    
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgThroughput: 0,
      startTime: null,
      endTime: null
    };
    
    this._initializePipeline();
    this._setupEventHandlers();
  }

  /**
   * 初始化流水线
   */
  _initializePipeline() {
    // 初始化各阶段
    for (const stage of PIPELINE_STAGES) {
      // 创建智能体池
      if (!this.agentPools.has(stage.agentType)) {
        const pool = new AgentPool({
          poolSize: this.options.maxConcurrencyPerStage
        });
        
        pool.initializePool({
          agentType: stage.agentType,
          AgentClass: stage.AgentClass,
          options: { eventBus: this.eventBus }
        });
        
        this.agentPools.set(stage.agentType, pool);
      }
      
      // 创建负载均衡器
      const loadBalancer = new LoadBalancer({
        strategy: 'least-connections',
        agentPool: this.agentPools.get(stage.agentType)
      });
      
      this.loadBalancers.set(stage.name, loadBalancer);
      
      // 初始化阶段
      this.stages.set(stage.name, {
        name: stage.name,
        agentType: stage.agentType,
        queue: [],
        concurrency: 0,
        maxConcurrency: this.options.maxConcurrencyPerStage,
        activeTasks: new Map(),
        completedTasks: 0,
        failedTasks: 0
      });
    }
    
    console.log(`[PipelineOrchestrator] Pipeline initialized with ${PIPELINE_STAGES.length} stages`);
  }

  /**
   * 启动流水线
   */
  start() {
    if (this.isRunning) {
      console.warn('[PipelineOrchestrator] Already running');
      return;
    }
    
    this.isRunning = true;
    this.stats.startTime = Date.now();
    
    // 启动各阶段处理器
    this._startStageProcessors();
    
    console.log('[PipelineOrchestrator] Started');
    this.publishEvent('pipeline.started', {
      pipelineId: this.pipelineId,
      stages: Array.from(this.stages.keys())
    });
  }

  /**
   * 停止流水线
   */
  stop() {
    this.isRunning = false;
    this.stats.endTime = Date.now();
    
    // 停止各阶段
    for (const [stageName, stage] of this.stages) {
      // 取消所有活动任务
      stage.activeTasks.forEach(task => {
        task.abort();
      });
      stage.activeTasks.clear();
    }
    
    console.log('[PipelineOrchestrator] Stopped');
    this.publishEvent('pipeline.stopped', {
      pipelineId: this.pipelineId,
      stats: this.stats
    });
  }

  /**
   * 提交任务
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 任务结果
   */
  async submitTask(task) {
    if (!this.isRunning) {
      throw new Error('Pipeline is not running');
    }
    
    // 检查队列大小
    if (this.inputQueue.length >= this.options.queueSize) {
      throw new Error('Input queue is full');
    }
    
    // 创建任务上下文
    const taskContext = {
      taskId: task.taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      payload: task,
      currentStage: 'S0',
      startTime: Date.now(),
      endTime: null,
      status: 'queued',
      error: null,
      results: {}
    };
    
    // 添加到输入队列
    this.inputQueue.push(taskContext);
    this.stats.totalTasks++;
    
    console.log(`[PipelineOrchestrator] Task submitted: ${taskContext.taskId}`);
    
    // 返回Promise
    return new Promise((resolve, reject) => {
      taskContext._resolve = resolve;
      taskContext._reject = reject;
    });
  }

  /**
   * 获取流水线状态
   * @returns {object} - 流水线状态
   */
  getStatus() {
    return {
      pipelineId: this.pipelineId,
      isRunning: this.isRunning,
      inputQueue: this.inputQueue.length,
      outputQueue: this.outputQueue.length,
      stages: Array.from(this.stages.values()).map(stage => ({
        name: stage.name,
        queueLength: stage.queue.length,
        concurrency: stage.concurrency,
        activeTasks: stage.activeTasks.size,
        completedTasks: stage.completedTasks,
        failedTasks: stage.failedTasks
      })),
      stats: { ...this.stats },
      throughput: this._calculateThroughput()
    };
  }

  /**
   * 打印流水线状态
   */
  printStatus() {
    const status = this.getStatus();
    
    console.log('\n========== 流水线状态 ==========');
    console.log(`流水线ID: ${status.pipelineId}`);
    console.log(`状态: ${status.isRunning ? '运行中' : '已停止'}`);
    console.log(`输入队列: ${status.inputQueue}`);
    console.log(`输出队列: ${status.outputQueue}`);
    console.log(`吞吐量: ${status.throughput.toFixed(2)} 任务/秒`);
    
    console.log('\n各阶段状态:');
    status.stages.forEach(stage => {
      const utilization = (stage.concurrency / stage.activeTasks) * 100 || 0;
      console.log(`  ${stage.name}: 队列${stage.queueLength} 并发${stage.concurrency} 活动${stage.activeTasks} 完成${stage.completedTasks} 失败${stage.failedTasks}`);
    });
    
    console.log('\n统计:');
    console.log(`  总任务: ${status.stats.totalTasks}`);
    console.log(`  已完成: ${status.stats.completedTasks}`);
    console.log(`  已失败: ${status.stats.failedTasks}`);
    
    console.log('================================\n');
  }

  // ========== 私有方法 ==========

  /**
   * 启动阶段处理器
   */
  _startStageProcessors() {
    for (const stageName of this.stages.keys()) {
      this._processStage(stageName);
    }
  }

  /**
   * 处理阶段
   */
  async _processStage(stageName) {
    while (this.isRunning) {
      try {
        const stage = this.stages.get(stageName);
        
        // 检查并发度
        if (stage.concurrency >= stage.maxConcurrency) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        
        // 获取下一个任务
        let task = null;
        
        if (stageName === 'S0') {
          // S0从输入队列获取
          task = this.inputQueue.shift();
        } else {
          // 其他阶段从队列获取
          task = stage.queue.shift();
        }
        
        if (!task) {
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        
        // 执行任务
        await this._executeTask(stageName, task);
        
      } catch (error) {
        console.error(`[PipelineOrchestrator] Stage processor error (${stageName}):`, error.message);
      }
    }
  }

  /**
   * 执行任务
   */
  async _executeTask(stageName, task) {
    const stage = this.stages.get(stageName);
    const loadBalancer = this.loadBalancers.get(stageName);
    
    // 增加并发度
    stage.concurrency++;
    
    // 更新任务状态
    task.currentStage = stageName;
    task.status = 'processing';
    
    console.log(`[PipelineOrchestrator] Executing ${stageName} for task: ${task.taskId}`);
    
    try {
      // 获取智能体
      const { agent, release } = await loadBalancer.acquire();
      
      // 记录活动任务
      const abortController = new AbortController();
      stage.activeTasks.set(task.taskId, {
        agent,
        release,
        abort: () => abortController.abort()
      });
      
      // 执行任务
      const result = await agent.executeTask({
        taskId: task.taskId,
        state: stageName,
        payload: {
          ...task.payload,
          ...task.results
        }
      });
      
      // 释放智能体
      release();
      stage.activeTasks.delete(task.taskId);
      
      // 保存结果
      task.results[stageName] = result;
      stage.completedTasks++;
      
      // 判断是否完成
      if (stageName === 'S6') {
        // 流水线完成
        task.status = 'completed';
        task.endTime = Date.now();
        this.outputQueue.push(task);
        this.stats.completedTasks++;
        
        if (task._resolve) {
          task._resolve(task);
        }
        
      } else {
        // 移动到下一阶段
        const nextStageName = this._getNextStage(stageName);
        const nextStage = this.stages.get(nextStageName);
        nextStage.queue.push(task);
      }
      
    } catch (error) {
      // 任务失败
      stage.failedTasks++;
      task.status = 'failed';
      task.error = error.message;
      this.stats.failedTasks++;
      
      // 故障恢复
      const shouldRetry = await this.failureRecovery.handleFailure(task, error);
      
      if (shouldRetry) {
        // 重试:放回当前阶段队列
        stage.queue.push(task);
        console.log(`[PipelineOrchestrator] Task retry: ${task.taskId}`);
      } else {
        // 失败:移动到输出队列
        task.endTime = Date.now();
        this.outputQueue.push(task);
        
        if (task._reject) {
          task._reject(error);
        }
        
        console.error(`[PipelineOrchestrator] Task failed: ${task.taskId} - ${error.message}`);
      }
      
      // 清理活动任务
      stage.activeTasks.delete(task.taskId);
      
    } finally {
      stage.concurrency--;
    }
  }

  /**
   * 获取下一阶段
   */
  _getNextStage(currentStageName) {
    const currentIndex = PIPELINE_STAGES.findIndex(s => s.name === currentStageName);
    if (currentIndex === -1 || currentIndex >= PIPELINE_STAGES.length - 1) {
      return null;
    }
    return PIPELINE_STAGES[currentIndex + 1].name;
  }

  /**
   * 计算吞吐量
   */
  _calculateThroughput() {
    const duration = this.stats.endTime 
      ? this.stats.endTime - this.stats.startTime 
      : Date.now() - this.stats.startTime;
    
    if (duration === 0) return 0;
    
    return this.stats.completedTasks / (duration / 1000);
  }

  /**
   * 设置事件处理器
   */
  _setupEventHandlers() {
    // 监听任务完成事件
    this.eventBus.subscribe('task.complete', (message) => {
      console.log(`[PipelineOrchestrator] Task completed: ${message.payload.taskId}`);
    });
    
    // 监听任务失败事件
    this.eventBus.subscribe('task.failure', (message) => {
      console.error(`[PipelineOrchestrator] Task failed: ${message.payload.taskId}`);
    });
  }

  /**
   * 发布事件
   */
  publishEvent(topic, payload) {
    const message = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      fromAgent: 'PipelineOrchestrator',
      timestamp: new Date().toISOString(),
      type: topic,
      payload
    };
    this.eventBus.publish(topic, message);
  }
}
