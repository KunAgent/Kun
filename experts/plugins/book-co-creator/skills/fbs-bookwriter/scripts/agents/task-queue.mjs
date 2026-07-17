#!/usr/bin/env node
/**
 * 任务队列
 * 
 * 功能:
 * - 任务入队/出队
 * - 优先级调度
 * - 任务依赖管理
 * - 任务状态跟踪
 */

export class TaskQueue {
  constructor(options = {}) {
    this.options = {
      maxSize: options.maxSize || 1000,
      autoStart: options.autoStart || true,
      ...options
    };
    
    this.queue = [];
    this.pendingTasks = new Map(); // taskId -> task
    this.completedTasks = new Map(); // taskId -> task
    this.failedTasks = new Map(); // taskId -> task
    this.taskDependencies = new Map(); // taskId -> [dependencyTaskIds]
    this.taskDependents = new Map(); // taskId -> [dependentTaskIds]
    
    this.isRunning = false;
    this.processingCount = 0;
  }

  /**
   * 添加任务到队列
   * @param {object} task - 任务对象
   * @returns {Promise<object>} - 任务结果
   */
  async enqueue(task) {
    // 验证任务
    if (!task.taskId) {
      throw new Error('Task must have taskId');
    }
    
    // 检查任务是否已存在
    if (this.pendingTasks.has(task.taskId) || 
        this.completedTasks.has(task.taskId)) {
      throw new Error(`Task already exists: ${task.taskId}`);
    }
    
    // 初始化任务状态
    task.status = 'queued';
    task.enqueuedAt = Date.now();
    task.startedAt = null;
    task.completedAt = null;
    task.priority = task.priority || 'normal'; // low, normal, high, critical
    task.dependencies = task.dependencies || [];
    
    // 处理依赖关系
    if (task.dependencies.length > 0) {
      this.taskDependencies.set(task.taskId, task.dependencies);
      task.dependencies.forEach(depId => {
        const dependents = this.taskDependents.get(depId) || [];
        dependents.push(task.taskId);
        this.taskDependents.set(depId, dependents);
      });
    }
    
    // 检查队列大小
    if (this.queue.length >= this.options.maxSize) {
      throw new Error('Task queue is full');
    }
    
    // 添加到队列
    this.pendingTasks.set(task.taskId, task);
    this._insertSorted(task);
    
    console.log(`[TaskQueue] Task enqueued: ${task.taskId} (priority: ${task.priority})`);
    
    // 自动开始处理
    if (this.options.autoStart && !this.isRunning) {
      this.start();
    }
    
    // 返回Promise,等待任务完成
    return new Promise((resolve, reject) => {
      task._resolve = resolve;
      task._reject = reject;
    });
  }

  /**
   * 从队列取出下一个任务
   * @returns {object|null} - 任务对象
   */
  dequeue() {
    if (this.queue.length === 0) {
      return null;
    }
    
    // 按优先级排序后取出
    const task = this.queue.shift();
    
    // 检查依赖是否满足
    if (task.dependencies.length > 0) {
      const allDependenciesCompleted = task.dependencies.every(
        depId => this.completedTasks.has(depId)
      );
      
      if (!allDependenciesCompleted) {
        // 依赖未满足,放回队列末尾
        this.queue.push(task);
        return null;
      }
    }
    
    // 更新任务状态
    task.status = 'processing';
    task.startedAt = Date.now();
    this.processingCount++;
    
    console.log(`[TaskQueue] Task dequeued: ${task.taskId}`);
    
    return task;
  }

  /**
   * 标记任务完成
   * @param {string} taskId - 任务ID
   * @param {object} result - 任务结果
   */
  completeTask(taskId, result) {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    // 更新任务状态
    task.status = 'completed';
    task.completedAt = Date.now();
    task.result = result;
    task.duration = task.completedAt - task.startedAt;
    
    // 移动到已完成队列
    this.pendingTasks.delete(taskId);
    this.completedTasks.set(taskId, task);
    this.processingCount--;
    
    // 解析任务Promise
    if (task._resolve) {
      task._resolve(result);
    }
    
    console.log(`[TaskQueue] Task completed: ${taskId} (duration: ${task.duration}ms)`);
    
    // 触发依赖任务
    this._triggerDependents(taskId);
  }

  /**
   * 标记任务失败
   * @param {string} taskId - 任务ID
   * @param {Error} error - 错误对象
   */
  failTask(taskId, error) {
    const task = this.pendingTasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    
    // 更新任务状态
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;
    task.duration = task.completedAt - task.startedAt;
    
    // 移动到失败队列
    this.pendingTasks.delete(taskId);
    this.failedTasks.set(taskId, task);
    this.processingCount--;
    
    // 拒绝任务Promise
    if (task._reject) {
      task._reject(error);
    }
    
    console.error(`[TaskQueue] Task failed: ${taskId} - ${error.message}`);
    
    // 标记依赖任务为失败(可选)
    this._failDependents(taskId);
  }

  /**
   * 启动队列处理
   */
  start() {
    if (this.isRunning) {
      console.warn('[TaskQueue] Already running');
      return;
    }
    
    this.isRunning = true;
    console.log('[TaskQueue] Started');
  }

  /**
   * 停止队列处理
   */
  stop() {
    this.isRunning = false;
    console.log('[TaskQueue] Stopped');
  }

  /**
   * 获取队列状态
   * @returns {object} - 队列状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      queueSize: this.queue.length,
      processingCount: this.processingCount,
      pendingCount: this.pendingTasks.size,
      completedCount: this.completedTasks.size,
      failedCount: this.failedTasks.size,
      totalCount: this.pendingTasks.size + this.completedTasks.size + this.failedTasks.size
    };
  }

  /**
   * 获取任务详情
   * @param {string} taskId - 任务ID
   * @returns {object|null} - 任务对象
   */
  getTask(taskId) {
    return this.pendingTasks.get(taskId) || 
           this.completedTasks.get(taskId) || 
           this.failedTasks.get(taskId);
  }

  /**
   * 清理队列
   */
  clear() {
    this.queue = [];
    this.pendingTasks.clear();
    this.completedTasks.clear();
    this.failedTasks.clear();
    this.taskDependencies.clear();
    this.taskDependents.clear();
    this.processingCount = 0;
    console.log('[TaskQueue] Cleared');
  }

  // ========== 私有方法 ==========

  /**
   * 按优先级插入任务
   */
  _insertSorted(task) {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    const priority = priorityOrder[task.priority] || 2;
    
    // 找到插入位置
    let insertIndex = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const existingPriority = priorityOrder[this.queue[i].priority] || 2;
      if (priority < existingPriority) {
        insertIndex = i;
        break;
      }
      insertIndex = i + 1;
    }
    
    this.queue.splice(insertIndex, 0, task);
  }

  /**
   * 触发依赖任务
   */
  _triggerDependents(completedTaskId) {
    const dependents = this.taskDependents.get(completedTaskId);
    if (!dependents) return;
    
    dependents.forEach(dependentId => {
      const task = this.pendingTasks.get(dependentId);
      if (task) {
        console.log(`[TaskQueue] Triggering dependent task: ${dependentId}`);
      }
    });
  }

  /**
   * 标记依赖任务为失败
   */
  _failDependents(failedTaskId) {
    const dependents = this.taskDependents.get(failedTaskId);
    if (!dependents) return;
    
    dependents.forEach(dependentId => {
      const task = this.pendingTasks.get(dependentId);
      if (task) {
        this.failTask(dependentId, new Error(`Dependency failed: ${failedTaskId}`));
      }
    });
  }
}
