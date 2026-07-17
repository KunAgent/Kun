export class OnboardingProgressService {
  constructor(config, store) {
    this.config = config;
    this.store = store;
  }

  getStage(stage) {
    return this.config.learningPath.stages.find((s) => s.stage === stage) || null;
  }

  getLesson(lessonId) {
    for (const stage of this.config.learningPath.stages) {
      const lesson = stage.lessons.find((l) => l.id === lessonId);
      if (lesson) return lesson;
    }
    return null;
  }

  getProgress(stage) {
    const stageData = this.getStage(stage);
    if (!stageData) return null;

    const progressState = this.store.getProgressState();
    const completed = stageData.lessons.filter((lesson) =>
      progressState.completedLessons.includes(lesson.id)
    );

    return {
      total: stageData.lessons.length,
      completed: completed.length,
      percentage: (completed.length / stageData.lessons.length) * 100,
    };
  }

  calculateAverageQuizScore() {
    const scores = Object.values(this.store.getProgressState().quizScores);
    if (scores.length === 0) return 0;
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  checkProgression() {
    const progressState = this.store.getProgressState();
    const currentStageData = this.getStage(progressState.currentStage);

    if (!currentStageData) {
      return { canProgress: false, reason: "Current stage not found" };
    }

    const criteria = currentStageData.completionCriteria;
    const progress = this.getProgress(progressState.currentStage);

    if (progress.completed < criteria.requiredLessons) {
      return {
        canProgress: false,
        reason: `Complete ${criteria.requiredLessons} lessons first`,
        required: criteria.requiredLessons,
        completed: progress.completed,
      };
    }

    if (criteria.quizScore) {
      const avgScore = this.calculateAverageQuizScore();
      if (avgScore < criteria.quizScore) {
        return {
          canProgress: false,
          reason: "Quiz score too low",
          required: criteria.quizScore,
          current: avgScore,
        };
      }
    }

    if (criteria.practiceCompleted && !progressState.practiceCompleted) {
      return { canProgress: false, reason: "Practice not completed" };
    }

    const stageIndex = this.config.learningPath.stages.findIndex(
      (s) => s.stage === progressState.currentStage
    );

    if (stageIndex < this.config.learningPath.stages.length - 1) {
      const nextStage = this.config.learningPath.stages[stageIndex + 1];
      return {
        canProgress: true,
        nextStage: nextStage.stage,
        stageName: nextStage.name,
      };
    }

    return {
      canProgress: false,
      reason: "All stages completed",
      completed: true,
    };
  }
}

export default OnboardingProgressService;
