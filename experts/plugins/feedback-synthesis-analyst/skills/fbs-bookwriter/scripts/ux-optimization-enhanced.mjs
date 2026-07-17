#!/usr/bin/env node

import UX_OPTIMIZATION_ENHANCED from "./lib/ux-optimization-enhanced-config.mjs";
import UxConcurrencyController from "./lib/ux-concurrency-controller.mjs";
import UxProgressReporter from "./lib/ux-progress-reporter.mjs";
import UxMemoryManager from "./lib/ux-memory-manager.mjs";

export { UX_OPTIMIZATION_ENHANCED };

export class EnhancedUXController {
  constructor(config = UX_OPTIMIZATION_ENHANCED) {
    this.config = config;
    this.operationTracker = new Map();
    this.performanceMetrics = {
      averageResponseTime: 0,
      concurrencyEfficiency: 0,
      memoryUsage: 0,
      cacheHitRate: 0,
    };

    this.concurrencyController = new UxConcurrencyController(config);
    this.progressReporter = new UxProgressReporter(config);
    this.memoryManager = new UxMemoryManager(config);

    this.initializeOptimizations();
  }

  initializeOptimizations() {
    this.initializeConcurrencyControl();
    this.initializeProgressFeedback();
    this.initializeTimeoutHandling();
    this.initializeMemoryManagement();
  }

  initializeConcurrencyControl() {
    if (this.config.enhancedConcurrencyControl.intelligentConcurrency.enabled) {
      this.intelligentConcurrency = this.concurrencyController.state;
    }
  }

  initializeProgressFeedback() {
    const progressConfig = this.config.enhancedProgressFeedback;
    if (progressConfig.realtimeProgress.enabled) {
      this.progressRuntime = {
        operations: new Map(),
        updateInterval: progressConfig.realtimeProgress.reportingIntervals.normal,
      };
    }
  }

  initializeTimeoutHandling() {
    if (this.config.enhancedTimeoutHandling.intelligentTimeout.enabled) {
      this.timeoutHandler = {
        timeoutMap: new Map(),
        retryMap: new Map(),
      };
    }
  }

  initializeMemoryManagement() {
    this.gcHandler = this.memoryManager.state;
  }

  async startOperation(operationName, options = {}) {
    const operationId = this.generateOperationId();
    const startTime = Date.now();
    const operation = {
      id: operationId,
      name: operationName,
      startTime,
      options,
      status: "running",
      progress: 0,
      errors: [],
      warnings: [],
    };

    this.operationTracker.set(operationId, operation);
    this.configureOperation(operation);
    this.startProgressReporting(operation);

    return operationId;
  }

  updateProgress(operationId, progress, details = {}) {
    const operation = this.operationTracker.get(operationId);
    if (!operation) return;

    operation.progress = progress;
    operation.details = details;
    if (progress >= 100) this.completeOperation(operationId);
  }

  completeOperation(operationId) {
    const operation = this.operationTracker.get(operationId);
    if (!operation) return;

    const endTime = Date.now();
    operation.status = "completed";
    operation.endTime = endTime;
    operation.duration = endTime - operation.startTime;

    this.stopProgressReporting(operationId);
    this.updatePerformanceMetrics(operation);
  }

  configureOperation(operation) {
    const options = operation.options || {};
    operation.config = operation.config || {};

    if (options.fileSize) {
      operation.config = {
        ...operation.config,
        ...this.configureForFileSize(options.fileSize),
      };
    }

    if (options.type) {
      operation.config = {
        ...operation.config,
        ...this.configureForType(options.type),
      };
    }
  }

  configureForFileSize(fileSize) {
    return this.concurrencyController.configureForFileSize(fileSize);
  }

  configureForType(type) {
    return this.concurrencyController.configureForType(type);
  }

  startProgressReporting(operation) {
    this.progressReporter.start(operation, (op) => this.reportProgress(op));
  }

  stopProgressReporting(operationId) {
    const operation = this.operationTracker.get(operationId);
    if (!operation) return;
    this.progressReporter.stop(operation);
  }

  reportProgress(operation) {
    this.progressReporter.report(operation);
  }

  updatePerformanceMetrics(operation) {
    const totalOperations = this.performanceMetrics.totalOperations || 0;
    const avgResponseTime = this.performanceMetrics.averageResponseTime || 0;

    this.performanceMetrics.averageResponseTime =
      (avgResponseTime * totalOperations + operation.duration) / (totalOperations + 1);
    this.performanceMetrics.totalOperations = totalOperations + 1;
    this.performanceMetrics.concurrencyEfficiency = this.calculateConcurrencyEfficiency();
    this.performanceMetrics.memoryUsage = process.memoryUsage().heapUsed;
  }

  calculateConcurrencyEfficiency() {
    return this.concurrencyController.calculateConcurrencyEfficiency();
  }

  getPerformanceReport() {
    return {
      metrics: this.performanceMetrics,
      targets: this.config.performanceTargets,
      status: this.getStatus(),
    };
  }

  getStatus() {
    const metrics = this.performanceMetrics;
    const targets = this.config.performanceTargets;
    const status = {};

    for (const [key, target] of Object.entries(targets)) {
      const current = metrics[key];
      if (current === undefined) continue;
      if (current <= target) status[key] = "good";
      else if (current <= target * 1.2) status[key] = "warning";
      else status[key] = "critical";
    }

    return status;
  }

  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  triggerGC(type = "incremental") {
    return this.memoryManager.triggerGC(type);
  }

  cleanupOperations(maxAge = 3600000) {
    const now = Date.now();
    for (const [id, operation] of this.operationTracker.entries()) {
      if (operation.status === "completed" && operation.endTime && now - operation.endTime > maxAge) {
        this.operationTracker.delete(id);
      }
    }
  }
}

export default UX_OPTIMIZATION_ENHANCED;
