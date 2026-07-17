#!/usr/bin/env node
/**
 * FBS-BookWriter 安全围栏配置
 * 
 * 目的：建立严格的安全边界，防止越权访问、数据泄露和性能问题
 * 
 * 安全原则：
 * 1. 最小权限原则：仅访问必要的项目目录和文件
 * 2. 数据隔离原则：用户数据、系统数据、技能数据严格分离
 * 3. 隐私保护原则：不收集、不传输用户个人信息
 * 4. 可审计原则：所有敏感操作记录日志
 * 5. 防卡顿原则：控制并发、超时、资源使用
 */

export const SECURITY_FENCE = {
  version: '1.0.0',
  lastUpdated: '2026-04-08',
  
  // ========================================
  // 文件系统安全边界
  // ========================================
  filesystem: {
    // 允许访问的目录（白名单模式）
    allowedPaths: {
      projectRoot: true,      // 项目根目录（用户书稿所在）
      fbsArtifacts: true,     // .fbs/ 工件目录
      chapters: true,         // chapters/ 章节目录
      references: true,       // references/ 参考文档目录
      scripts: true,          // scripts/ 脚本目录（仅技能自身）
      assets: true,          // assets/ 资源目录
      dist: true,            // dist/ 输出目录
    },
    
    // 禁止访问的目录（黑名单模式）
    forbiddenPaths: {
      systemRoots: [
        'C:\\Windows',
        'C:\\Program Files',
        'C:\\Program Files (x86)',
        '/etc',
        '/root',
        '/bin',
        '/usr/bin',
        '/sbin',
        '/var',
        '/tmp'
      ],
      userSystem: [
        '~/.ssh',
        '~/.gnupg',
        '~/.aws',
        '~/.config',
        '/etc/passwd',
        '/etc/shadow'
      ],
      otherProjects: [
        // 限制只能访问当前项目目录
      ]
    },
    
    // 文件操作限制
    fileOperations: {
      // 允许的文件扩展名（白名单）
      allowedExtensions: [
        '.md', '.txt', '.json', '.mjs', '.js', '.css', '.html',
        '.jpg', '.jpeg', '.png', '.gif', '.webp'
      ],
      
      // 禁止的文件名模式
      forbiddenPatterns: [
        /password/i,
        /secret/i,
        /key/i,
        /token/i,
        /credential/i,
        /\.env$/i,
        /config\.json$/i,
        /settings\.json$/i
      ],
      
      // 文件大小限制
      maxFileSize: 50 * 1024 * 1024, // 50MB
      chunkSize: 1024 * 1024, // 1MB 分块读取
      
      // 危险操作拦截
      dangerousPatterns: [
        /rm\s+-rf/i,
        /del\s+\//,
        /format\s+c:/i,
        /shred/i,
        /wipe/i
      ]
    },
    
    // 目录遍历防护
    pathTraversal: {
      enabled: true,
      blockPatterns: [
        /\.\./,
        /~\//,
        /\\+/  // Windows 路径规范化
      ],
      maxDepth: 10  // 最多递归10层目录
    }
  },
  
  // ========================================
  // 网络访问安全边界
  // ========================================
  network: {
    // 允许的协议
    allowedProtocols: ['https:', 'http:'],
    
    // 允许的域名（白名单，空表示允许所有）
    allowedDomains: {
      searchEngines: [
        'www.bing.com',
        'www.baidu.com',
        'duckduckgo.com'
      ],
      officialDomains: [
        'fbs-bookwriter.u3w.com',
        'pack.fbs.u3w.com',
        'api.u3w.com'
      ],
      documentation: [
        'github.com',
        'stackoverflow.com',
        'developer.mozilla.org'
      ]
    },
    
    // 禁止的域名（黑名单）
    forbiddenDomains: [
      // 禁止访问恶意域名
    ],
    
    // 网络请求限制
    requestLimits: {
      maxConcurrent: 3,           // 最大并发请求数
      maxRequestsPerMinute: 20,   // 每分钟最大请求数
      timeoutMs: 15000,          // 单次请求超时15秒
      retryDelays: [1000, 2000, 5000], // 重试延迟
      maxRetries: 2              // 最大重试次数
    },
    
    // 数据传输限制
    dataTransfer: {
      maxResponseSize: 10 * 1024 * 1024, // 10MB
      maxRequestBody: 1024 * 1024,        // 1MB
      blockBinary: true,                   // 阻止二进制下载
      allowedMimeTypes: [
        'text/plain',
        'text/html',
        'text/markdown',
        'application/json',
        'application/xml'
      ]
    },
    
    // 隐私保护
    privacy: {
      blockPersonalInfo: true,
      sensitivePatterns: [
        /email/i,
        /phone/i,
        /address/i,
        /credit.?card/i,
        /ssn/i,
        /身份证/i,
        /手机号/i,
        /邮箱/i
      ],
      anonymizeData: true,
      logRequests: true
    }
  },
  
  // ========================================
  // 内存和性能安全边界
  // ========================================
  performance: {
    // 内存限制
    memory: {
      maxHeapSize: 512 * 1024 * 1024, // 512MB
      warningThreshold: 400 * 1024 * 1024, // 400MB
      enableGC: true,
      gcInterval: 60000 // 1分钟GC一次
    },
    
    // 并发控制
    concurrency: {
      maxConcurrentTasks: 5,
      maxParallelReads: 3,
      maxParallelWrites: 1,
      queueSize: 100
    },
    
    // 超时控制
    timeouts: {
      fileRead: 5000,      // 5秒
      fileWrite: 10000,    // 10秒
      networkRequest: 15000, // 15秒
      scriptExecution: 300000 // 5分钟
    },
    
    // 防卡顿措施
    antiLag: {
      enabled: true,
      heartbeatInterval: 30000, // 30秒心跳
      maxIdleTime: 120000,    // 2分钟空闲超时
      progressReporting: true,  // 进度报告
      cancelOnTimeout: true    // 超时自动取消
    }
  },
  
  // ========================================
  // 数据安全和隐私保护
  // ========================================
  dataPrivacy: {
    // 个人信息保护
    personalInfo: {
      enabled: true,
      protectionLevel: 'strict', // strict | moderate | minimal
      blockCollection: true,     // 禁止主动收集
      blockTransmission: true,  // 禁止传输
      blockStorage: false,       // 允许本地存储（用户授权）
      retentionDays: 90         // 数据保留90天
    },
    
    // 数据脱敏
    dataMasking: {
      enabled: true,
      patterns: {
        email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
        phone: /\b\d{11}\b/g,
        idCard: /\b\d{18}\b/g,
        creditCard: /\b\d{16}\b/g
      },
      replacement: '[已脱敏]'
    },
    
    // 数据隔离
    dataIsolation: {
      projectData: true,   // 项目数据隔离
      userData: true,      // 用户数据隔离
      systemData: true,    // 系统数据隔离
      crossProjectAccess: false  // 禁止跨项目访问
    }
  },
  
  // ========================================
  // 审计和日志
  // ========================================
  audit: {
    enabled: true,
    logFile: '.fbs/security-audit.log',
    
    // 审计事件类型
    events: {
      fileAccess: {
        level: 'info',
        enabled: true,
        details: ['path', 'operation', 'result']
      },
      networkRequest: {
        level: 'info',
        enabled: true,
        details: ['url', 'method', 'status']
      },
      securityViolation: {
        level: 'error',
        enabled: true,
        details: ['violationType', 'attempt', 'blocked']
      },
      dataAccess: {
        level: 'info',
        enabled: true,
        details: ['dataType', 'purpose', 'authorized']
      }
    },
    
    // 日志保留
    retention: {
      days: 30,
      maxSize: 10 * 1024 * 1024 // 10MB
    }
  }
};

/**
 * 安全检查器
 */
export class SecurityChecker {
  constructor(fence = SECURITY_FENCE) {
    this.fence = fence;
    this.violations = [];
  }
  
  /**
   * 检查文件路径是否安全
   */
  isPathSafe(filePath) {
    // 检查路径遍历
    for (const pattern of this.fence.filesystem.pathTraversal.blockPatterns) {
      if (pattern.test(filePath)) {
        this.violations.push({
          type: 'pathTraversal',
          path: filePath,
          pattern: pattern.toString()
        });
        return false;
      }
    }
    
    // 检查黑名单路径
    const normalizedPath = filePath.replace(/\\/g, '/');
    for (const forbidden of this.fence.filesystem.forbiddenPaths.systemRoots) {
      if (normalizedPath.startsWith(forbidden.replace(/\\/g, '/'))) {
        this.violations.push({
          type: 'forbiddenPath',
          path: filePath,
          forbiddenPath: forbidden
        });
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * 检查文件名是否安全
   */
  isFileNameSafe(fileName) {
    for (const pattern of this.fence.filesystem.fileOperations.forbiddenPatterns) {
      if (pattern.test(fileName)) {
        this.violations.push({
          type: 'forbiddenFileName',
          fileName: fileName,
          pattern: pattern.toString()
        });
        return false;
      }
    }
    return true;
  }
  
  /**
   * 检查文件大小是否安全
   */
  isFileSizeSafe(size) {
    return size <= this.fence.filesystem.fileOperations.maxFileSize;
  }
  
  /**
   * 检查URL是否安全
   */
  isUrlSafe(url) {
    try {
      const parsed = new URL(url);
      
      // 检查协议
      if (!this.fence.network.allowedProtocols.includes(parsed.protocol)) {
        this.violations.push({
          type: 'forbiddenProtocol',
          url: url,
          protocol: parsed.protocol
        });
        return false;
      }
      
      // 检查黑名单域名（如果配置了）
      // 这里可以添加域名黑名单检查
      
      return true;
    } catch (error) {
      this.violations.push({
        type: 'invalidUrl',
        url: url,
        error: error.message
      });
      return false;
    }
  }
  
  /**
   * 获取违规记录
   */
  getViolations() {
    return this.violations;
  }
  
  /**
   * 清除违规记录
   */
  clearViolations() {
    this.violations = [];
  }
  
  /**
   * 记录审计日志
   */
  logAuditEvent(eventType, details) {
    if (!this.fence.audit.enabled) return;
    
    const eventConfig = this.fence.audit.events[eventType];
    if (!eventConfig || !eventConfig.enabled) return;
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: eventType,
      level: eventConfig.level,
      details: details
    };
    
    // 这里应该写入日志文件
    console.log(`[AUDIT ${eventConfig.level.toUpperCase()}]`, JSON.stringify(logEntry));
  }
}

/**
 * 性能监控器
 */
export class PerformanceMonitor {
  constructor(fence = SECURITY_FENCE) {
    this.fence = fence;
    this.metrics = {
      fileOperations: [],
      networkRequests: [],
      memoryUsage: []
    };
  }
  
  /**
   * 开始性能追踪
   */
  startTracking(operation) {
    const startTime = Date.now();
    return {
      operation,
      startTime,
      end: () => {
        const duration = Date.now() - startTime;
        this.metrics.fileOperations.push({
          operation,
          duration,
          timestamp: new Date().toISOString()
        });
        
        // 检查是否超时
        const timeout = this.fence.performance.timeouts[operation] || 0;
        if (timeout > 0 && duration > timeout) {
          console.warn(`[PERFORMANCE] Operation "${operation}" exceeded timeout: ${duration}ms > ${timeout}ms`);
        }
        
        return duration;
      }
    };
  }
  
  /**
   * 检查内存使用
   */
  checkMemoryUsage() {
    if (typeof process !== 'undefined') {
      const usage = process.memoryUsage();
      const usedMB = usage.heapUsed / (1024 * 1024);
      
      this.metrics.memoryUsage.push({
        heapUsed: usedMB,
        heapTotal: usage.heapTotal / (1024 * 1024),
        timestamp: new Date().toISOString()
      });
      
      // 检查是否超过阈值
      if (usedMB > this.fence.performance.memory.warningThreshold / (1024 * 1024)) {
        console.warn(`[PERFORMANCE] Memory usage high: ${usedMB.toFixed(2)}MB`);
        
        // 触发GC
        if (this.fence.performance.memory.enableGC && typeof global.gc === 'function') {
          global.gc();
        }
      }
      
      return usedMB;
    }
    return 0;
  }
  
  /**
   * 获取性能报告
   */
  getPerformanceReport() {
    const fileOps = this.metrics.fileOperations;
    const avgFileOpTime = fileOps.length > 0 
      ? fileOps.reduce((sum, op) => sum + op.duration, 0) / fileOps.length 
      : 0;
    
    const memoryUsage = this.metrics.memoryUsage;
    const avgMemoryUsage = memoryUsage.length > 0
      ? memoryUsage.reduce((sum, mem) => sum + mem.heapUsed, 0) / memoryUsage.length
      : 0;
    
    return {
      fileOperations: {
        count: fileOps.length,
        averageDuration: avgFileOpTime,
        maxDuration: Math.max(...fileOps.map(op => op.duration), 0)
      },
      memory: {
        averageUsage: avgMemoryUsage,
        maxUsage: Math.max(...memoryUsage.map(mem => mem.heapUsed), 0),
        samples: memoryUsage.length
      },
      timestamp: new Date().toISOString()
    };
  }
}

export default SECURITY_FENCE;
