export class UxProgressReporter {
  constructor(config) {
    this.config = config;
  }

  start(operation, reportFn) {
    const progressConfig = this.config.enhancedProgressFeedback;
    const reportingInterval =
      operation.config?.progressInterval || progressConfig.realtimeProgress.reportingIntervals.normal;

    operation.progressTimer = setInterval(() => reportFn(operation), reportingInterval);
  }

  stop(operation) {
    if (operation?.progressTimer) {
      clearInterval(operation.progressTimer);
      operation.progressTimer = null;
    }
  }

  report(operation) {
    console.log(`[Progress] ${operation.name}: ${operation.progress.toFixed(1)}%`);
    if (operation.details?.currentOperation) {
      console.log(`[Details] ${operation.details.currentOperation}`);
    }
  }
}

export default UxProgressReporter;
