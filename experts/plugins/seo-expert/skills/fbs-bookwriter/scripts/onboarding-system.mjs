#!/usr/bin/env node

import ONBOARDING_SYSTEM from "./lib/onboarding-config.mjs";
import OnboardingStore from "./lib/onboarding-store.mjs";
import OnboardingProgressService from "./lib/onboarding-progress-service.mjs";

export { ONBOARDING_SYSTEM };

export class OnboardingSystem {
  constructor(config = ONBOARDING_SYSTEM) {
    this.config = config;
    this.store = new OnboardingStore();
    this.progressService = new OnboardingProgressService(config, this.store);
  }

  startLearningPath(stage = "beginner") {
    const stageData = this.progressService.getStage(stage);
    if (!stageData) return { error: "Stage not found" };

    return {
      stage: stageData,
      lessons: stageData.lessons,
      progress: this.getProgress(stage),
    };
  }

  getLesson(lessonId) {
    return this.progressService.getLesson(lessonId);
  }

  completeLesson(lessonId, quizScore = null, practiceResult = null) {
    this.store.markLessonCompleted(lessonId, quizScore);
    if (practiceResult === true) this.store.setPracticeCompleted(true);
    return this.checkProgression();
  }

  getProgress(stage) {
    return this.progressService.getProgress(stage);
  }

  checkProgression() {
    const result = this.progressService.checkProgression();
    if (result.canProgress && result.nextStage) {
      this.store.setCurrentStage(result.nextStage);
    }
    return result;
  }

  calculateAverageQuizScore() {
    return this.progressService.calculateAverageQuizScore();
  }

  getHelp(category = null, query = null) {
    if (category) {
      const categoryFAQ = this.config.helpSystemOptimized.faq.find((f) => f.category === category);
      return categoryFAQ ? categoryFAQ.questions : [];
    }

    if (query) {
      const allQuestions = [];
      for (const categoryItem of this.config.helpSystemOptimized.faq) {
        allQuestions.push(...categoryItem.questions);
      }
      return allQuestions.filter((q) => q.q.includes(query) || q.a.includes(query));
    }

    return this.config.helpSystemOptimized.faq;
  }

  setPreferences(preferences) {
    return this.store.setPreferences(preferences);
  }

  getPreferences() {
    return this.store.getPreferences();
  }

  resetProgress() {
    return this.store.resetProgress();
  }
}

export default ONBOARDING_SYSTEM;
