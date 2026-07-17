export class UxConcurrencyController {
  constructor(config) {
    this.config = config;
    this.state = {
      currentConcurrency: 0,
      maxConcurrency: 5,
      activeTasks: new Map(),
      taskQueue: [],
    };
  }

  configureForFileSize(fileSize) {
    const isLargeFile = fileSize > 5 * 1024 * 1024;
    return {
      isLargeFile,
      chunkSize: isLargeFile ? 1024 * 1024 : 64 * 1024,
      concurrency: isLargeFile ? 1 : 3,
      progressInterval: isLargeFile ? 2000 : 1000,
    };
  }

  configureForType(type) {
    const typeConfig =
      this.config.enhancedConcurrencyControl.intelligentConcurrency.adaptiveConcurrency.taskBasedAdjustment;
    return typeConfig[type] || typeConfig.mixed;
  }

  calculateConcurrencyEfficiency() {
    const maxPossible =
      this.config.enhancedConcurrencyControl.intelligentConcurrency.adaptiveConcurrency.maxConcurrency || 5;
    const actual = this.state.currentConcurrency || 0;
    return Math.min(1.0, actual / maxPossible);
  }
}

export default UxConcurrencyController;
