#!/usr/bin/env node
/**
 * 并发控制器
 * 
 * 功能:
 * - 并发任务调度
 * - 并发度控制
 * - 资源限制管理
 * - 任务超时处理
 */

export class ConcurrencyController {
  constructor(options = {}) {
    this.options = {
      maxConcurrency: options.maxConcurrency || 3,
      maxQueueSize: options.maxQueueSize || 100,
      timeout: options.timeout || 5 * 60 * 1000, // 5分钟
      ...options
    };
    
    this.activeTasks = new Map(); // taskId -> { task, controller, timeout }
    this.taskQueue = [];
    this.isRunning = false;
    
    // 统计信息
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      timeoutTasks: 0,
      avgDuration: 0,
      totalDuration: 0
    };
  }

  /**
   * 添加任务
   * @param {function} taskFn - 任务函数
   * @param {object} options - 任务选项
   * @returns {Promise<any>} - 任务结果
   */
  async addTask(taskFn, options = {}) {
    const taskId = options.taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const task = {
      taskId,
      taskFn,
      priority: options.priority || 'normal',
      timeout: options.timeout || this.options.timeout,
      metadata: options.metadata || {}
    };
    
    this.stats.totalTasks++;
    
    // 检查队列大小
    if (this.taskQueue.length >= this.options.maxQueueSize) {
      throw new Error('Task queue is full');
    }
    
    // 创建Promise
    return new Promise((resolve, reject) => {
      task._resolve = resolve;
      task._reject = reject;
      
      // 添加到队列
      this.taskQueue.push(task);
      console.log(`[ConcurrencyController] Task added: ${taskId} (queue size: ${this.taskQueue.length})`);
      
      // 自动开始处理
      if (this.options.autoStart !== false && !this.isRunning) {
        this.start();
      }
    });
  }

  /**
   * 开始处理任务
   */
  start() {
    if (this.isRunning) {
      console.warn('[ConcurrencyController] Already running');
      return;
    }
    
    this.isRunning = true;
    this._processQueue();
    console.log('[ConcurrencyController] Started');
  }

  /**
   * 停止处理任务
   */
  stop() {
    this.isRunning = false;
    console.log('[ConcurrencyController] Stopped');
  }

  /**
   * 取消任务
   * @param {string} taskId - 任务ID
   * @returns {boolean} - 是否成功取消
   */
  cancelTask(taskId) {
    // 检查活动任务
    const activeTask = this.activeTasks.get(taskId);
    if (activeTask) {
      activeTask.controller.abort();
      this.activeTasks.delete(taskId);
      console.log(`[ConcurrencyController] Task cancelled (active): ${taskId}`);
      return true;
    }
    
    // 检查队列中的任务
    const queueIndex = this.taskQueue.findIndex(t => t.taskId === taskId);
    if (queueIndex !== -1) {
      const task = this.taskQueue.splice(queueIndex, 1)[0];
      task._reject(new Error('Task cancelled'));
      console.log(`[ConcurrencyController] Task cancelled (queued): ${taskId}`);
      return true;
    }
    
    return false;
  }

  /**
   * 获取状态
   * @returns {object} - 控制器状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeTasks: this.activeTasks.size,
      queuedTasks: this.taskQueue.length,
      maxConcurrency: this.options.maxConcurrency,
      utilization: (this.activeTasks.size / this.options.maxConcurrency) * 100,
      stats: { ...this.stats }
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      timeoutTasks: 0,
      avgDuration: 0,
      totalDuration: 0
    };
    console.log('[ConcurrencyController] Stats reset');
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.stop();
    
    // 取消所有活动任务
    this.activeTasks.forEach(({ controller }) => {
      controller.abort();
    });
    this.activeTasks.clear();
    
    // 拒绝所有队列中的任务
    this.taskQueue.forEach(task => {
      task._reject(new Error('ConcurrencyController stopped'));
    });
    this.taskQueue = [];
    
    console.log('[ConcurrencyController] Cleaned up');
  }

  // ========== 私有方法 ==========

  /**
   * 处理队列
   */
  async _processQueue() {
    while (this.isRunning) {
      // 检查并发度
      if (this.activeTasks.size >= this.options.maxConcurrency) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // 检查队列
      if (this.taskQueue.length === 0) {
        if (this.activeTasks.size === 0) {
          // 所有任务完成,停止处理
          console.log('[ConcurrencyController] All tasks completed');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      
      // 取出任务
      const task = this.taskQueue.shift();
      this._executeTask(task);
    }
  }

  /**
   * 执行任务
   */
  async _executeTask(task) {
    const { taskId, taskFn, timeout } = task;
    
    console.log(`[ConcurrencyController] Executing task: ${taskId} (active: ${this.activeTasks.size + 1}/${this.options.maxConcurrency})`);
    
    // 创建AbortController
    const controller = new AbortController();
    const taskTimeout = setTimeout(() => {
      this._handleTimeout(taskId);
    }, timeout);
    
    // 记录活动任务
    this.activeTasks.set(taskId, { task, controller, timeout: taskTimeout });
    
    try {
      // 执行任务
      const startTime = Date.now();
      const result = await taskFn();
      const duration = Date.now() - startTime;
      
      // 清理
      clearTimeout(taskTimeout);
      this.activeTasks.delete(taskId);
      
      // 更新统计
      this.stats.completedTasks++;
      this.stats.totalDuration += duration;
      this.stats.avgDuration = this.stats.totalDuration / this.stats.completedTasks;
      
      // 解析任务
      task._resolve(result);
      
      console.log(`[ConcurrencyController] Task completed: ${taskId} (duration: ${duration}ms)`);
      
    } catch (error) {
      // 清理
      clearTimeout(taskTimeout);
      this.activeTasks.delete(taskId);
      
      // 更新统计
      this.stats.failedTasks++;
      
      // 拒绝任务
      task._reject(error);
      
      console.error(`[ConcurrencyController] Task failed: ${taskId} - ${error.message}`);
    }
  }

  /**
   * 处理超时
   */
  _handleTimeout(taskId) {
    const activeTask = this.activeTasks.get(taskId);
    if (!activeTask) return;
    
    console.warn(`[ConcurrencyController] Task timeout: ${taskId}`);
    
    // 取消任务
    activeTask.controller.abort();
    this.activeTasks.delete(taskId);
    
    // 更新统计
    this.stats.timeoutTasks++;
    this.stats.failedTasks++;
    
    // 拒绝任务
    activeTask.task._reject(new Error('Task timeout'));
  }
}
