/**
 * U3: shutdown协议细化 (P0)
 * 
 * 功能:
 * - STOP信号处理
 * - 30s超时强制终止
 * - 进度保存
 * - shutdown_response确认
 */

import EventEmitter from 'events';

/**
 * Shutdown协议处理器
 */
export class ShutdownProtocol extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.timeout = options.timeout || 30000; // 默认30s超时
    this.pendingResponses = new Map();
    this.activeWriters = new Set();
    this.shutdownStates = new Map();
    
    console.log(`🛑 [U3-P0] Shutdown协议初始化完成 (超时: ${this.timeout}ms)`);
  }

  /**
   * 注册writer
   * @param {string} writerId - Writer ID
   */
  registerWriter(writerId) {
    this.activeWriters.add(writerId);
    this.shutdownStates.set(writerId, {
      status: 'active',
      registeredAt: Date.now()
    });
    
    console.log(`📝 [U3-P0] Writer已注册: ${writerId}`);
  }

  /**
   * 注销writer
   * @param {string} writerId - Writer ID
   */
  unregisterWriter(writerId) {
    this.activeWriters.delete(writerId);
    this.shutdownStates.delete(writerId);
    
    console.log(`📝 [U3-P0] Writer已注销: ${writerId}`);
  }

  /**
   * 请求关闭单个writer
   * @param {string} writerId - Writer ID
   * @param {string} reason - 关闭原因
   * @returns {Promise<Object>}
   */
  async requestShutdown(writerId, reason = 'User requested shutdown') {
    const requestId = `shutdown_${Date.now()}_${writerId}`;
    
    console.log(`\n🛑 [U3-P0] 请求关闭 writer ${writerId}`);
    console.log(`   Request ID: ${requestId}`);
    console.log(`   原因: ${reason}`);
    
    // 检查writer是否已注册
    if (!this.activeWriters.has(writerId)) {
      console.warn(`⚠️ [U3-P0] Writer ${writerId} 未注册`);
      return {
        status: 'not_found',
        writerId,
        timestamp: Date.now()
      };
    }
    
    // 发送STOP信号
    const stopMessage = {
      type: 'STOP',
      requestId,
      timestamp: Date.now(),
      reason
    };
    
    console.log(`   发送STOP信号...`);
    this.emit('send', writerId, stopMessage);
    
    // 更新writer状态
    this.shutdownStates.set(writerId, {
      status: 'stopping',
      requestId,
      stopSentAt: Date.now(),
      reason
    });
    
    // 等待shutdown_response
    console.log(`   等待shutdown_response...`);
    
    const response = await Promise.race([
      this.waitForResponse(requestId),
      this.timeoutAfter(this.timeout, writerId, requestId)
    ]);
    
    if (!response) {
      console.error(`⏱️ [U3-P0] Writer ${writerId} 超时未响应 (${this.timeout}ms)`);
      return this.forceTerminate(writerId);
    }
    
    console.log(`✅ [U3-P0] Writer ${writerId} 已确认关闭`);
    
    // 更新writer状态
    this.shutdownStates.set(writerId, {
      status: 'stopped',
      requestId,
      stoppedAt: Date.now(),
      response
    });
    
    this.unregisterWriter(writerId);
    
    return response;
  }

  /**
   * 等待响应
   * @param {string} requestId - 请求ID
   * @returns {Promise<Object>}
   */
  async waitForResponse(requestId) {
    return new Promise((resolve) => {
      this.pendingResponses.set(requestId, resolve);
    });
  }

  /**
   * 超时处理
   * @param {number} ms - 超时毫秒
   * @param {string} writerId - Writer ID
   * @param {string} requestId - 请求ID
   * @returns {Promise<null>}
   */
  async timeoutAfter(ms, writerId, requestId) {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.warn(`⏱️ [U3-P0] 请求超时: ${requestId}`);
        resolve(null);
      }, ms);
    });
  }

  /**
   * 强制终止writer
   * @param {string} writerId - Writer ID
   * @returns {Promise<Object>}
   */
  async forceTerminate(writerId) {
    console.log(`🔨 [U3-P0] 强制终止 writer ${writerId}`);
    
    // 发送TERM信号
    const termMessage = {
      type: 'TERM',
      timestamp: Date.now(),
      reason: 'Timeout - force terminate'
    };
    
    this.emit('terminate', writerId, termMessage);
    
    // 更新writer状态
    this.shutdownStates.set(writerId, {
      status: 'terminated',
      terminatedAt: Date.now(),
      reason: 'timeout'
    });
    
    this.unregisterWriter(writerId);
    
    return {
      status: 'terminated',
      writerId,
      timestamp: Date.now(),
      reason: 'timeout'
    };
  }

  /**
   * 处理shutdown响应
   * @param {string} requestId - 请求ID
   * @param {Object} response - 响应内容
   */
  handleResponse(requestId, response) {
    const resolve = this.pendingResponses.get(requestId);
    
    if (resolve) {
      console.log(`📥 [U3-P0] 收到shutdown_response: ${requestId}`);
      this.pendingResponses.delete(requestId);
      resolve(response);
    } else {
      console.warn(`⚠️ [U3-P0] 未知请求ID: ${requestId}`);
    }
  }

  /**
   * 请求关闭所有writer
   * @param {string} reason - 关闭原因
 * @returns {Promise<Array>}
   */
  async shutdownAll(reason = 'User requested shutdown') {
    console.log(`\n🛑 [U3-P0] 请求关闭所有 writers (${this.activeWriters.size})`);
    console.log(`   原因: ${reason}`);
    
    if (this.activeWriters.size === 0) {
      console.log('✅ [U3-P0] 无活跃writer');
      return [];
    }
    
    const writerIds = Array.from(this.activeWriters);
    
    // 并行发送shutdown请求
    const shutdownPromises = writerIds.map(writerId =>
      this.requestShutdown(writerId, reason)
    );
    
    const results = await Promise.all(shutdownPromises);
    
    console.log(`\n✅ [U3-P0] 所有 writers 已关闭 (${results.length})`);
    
    // 输出摘要
    console.log('\n📊 [U3-P0] Shutdown摘要:');
    for (const result of results) {
      const statusIcon = result.status === 'stopped' ? '✅' : 
                        result.status === 'terminated' ? '🔨' : '⚠️';
      console.log(`   ${statusIcon} Writer ${result.writerId}: ${result.status}`);
    }
    
    return results;
  }

  /**
   * 获取writer状态
   * @param {string} writerId - Writer ID
 * @returns {Object|null}
   */
  getWriterState(writerId) {
    return this.shutdownStates.get(writerId) || null;
  }

  /**
   * 获取所有writer状态
   * @returns {Array}
   */
  getAllWriterStates() {
    return Array.from(this.shutdownStates.entries()).map(([writerId, state]) => ({
      writerId,
      ...state
    }));
  }

  /**
   * 获取活跃writer数量
   * @returns {number}
   */
  getActiveWriterCount() {
    return this.activeWriters.size;
  }

  /**
   * 清理所有状态
   */
  cleanup() {
    console.log('🧹 [U3-P0] 清理Shutdown协议状态...');
    
    this.pendingResponses.clear();
    this.activeWriters.clear();
    this.shutdownStates.clear();
    
    this.removeAllListeners();
    
    console.log('✅ [U3-P0] 清理完成');
  }
}

/**
 * Writer端STOP信号处理器
 */
export class WriterShutdownHandler {
  constructor(writerId) {
    this.writerId = writerId;
    this.generationActive = true;
    this.currentProgress = null;
    this.savedChapters = [];
  }

  /**
   * 处理STOP信号
   * @param {Object} stopMessage - STOP消息
   * @param {Function} sendResponse - 发送响应函数
   */
  async handleStop(stopMessage, sendResponse) {
    console.log(`\n🛑 [Writer-${this.writerId}] 收到STOP信号`);
    console.log(`   Request ID: ${stopMessage.requestId}`);
    console.log(`   原因: ${stopMessage.reason}`);
    
    // 1. 立即停止生成
    this.generationActive = false;
    console.log('   → 停止生成');
    
    // 2. 保存当前进度
    await this.saveCurrentProgress();
    console.log('   → 保存进度');
    
    // 3. 返回shutdown_response
    const response = {
      type: 'shutdown_response',
      requestId: stopMessage.requestId,
      status: 'stopped',
      writerId: this.writerId,
      timestamp: Date.now(),
      savedChapters: this.savedChapters,
      currentProgress: this.currentProgress
    };
    
    console.log('   → 发送shutdown_response');
    sendResponse(response);
    
    console.log(`✅ [Writer-${this.writerId}] 已确认关闭`);
  }

  /**
   * 保存当前进度
   * @returns {Promise<void>}
   */
  async saveCurrentProgress() {
    // 实现具体的进度保存逻辑
    console.log(`   💾 [Writer-${this.writerId}] 保存进度: ${JSON.stringify(this.currentProgress)}`);
    
    // 这里应该实现实际的文件保存逻辑
    // 例如: await fs.writeFile('.fbs/progress.json', JSON.stringify(this.currentProgress));
  }

  /**
   * 更新当前进度
   * @param {Object} progress - 进度信息
   */
  updateProgress(progress) {
    this.currentProgress = progress;
  }

  /**
   * 记录已完成章节
   * @param {string} chapter - 章节信息
   */
  recordSavedChapter(chapter) {
    this.savedChapters.push(chapter);
  }

  /**
   * 检查是否应该停止
   * @returns {boolean}
   */
  shouldStop() {
    return !this.generationActive;
  }
}

// CLI入口
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('========================================');
  console.log('U3: shutdown协议细化 (P0)');
  console.log('========================================\n');
  
  // 示例: 创建ShutdownProtocol实例
  const shutdownProtocol = new ShutdownProtocol({ timeout: 30000 });
  
  // 注册writer
  shutdownProtocol.registerWriter('writer-A');
  shutdownProtocol.registerWriter('writer-B');
  
  console.log(`\n活跃writer数量: ${shutdownProtocol.getActiveWriterCount()}`);
  
  // 模拟关闭所有writer
  shutdownProtocol.shutdownAll('测试关闭')
    .then((results) => {
      console.log('\n✅ U3 完成');
      console.log('Shutdown结果:', results);
      shutdownProtocol.cleanup();
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ U3 失败:', error.message);
      process.exit(1);
    });
}

export default ShutdownProtocol;
