export class OnboardingStore {
  constructor() {
    this.userProgress = {
      currentStage: "beginner",
      completedLessons: [],
      quizScores: {},
      practiceCompleted: false,
    };
    this.userPreferences = {};
  }

  getProgressState() {
    return this.userProgress;
  }

  markLessonCompleted(lessonId, quizScore = null) {
    if (!this.userProgress.completedLessons.includes(lessonId)) {
      this.userProgress.completedLessons.push(lessonId);
    }
    if (quizScore !== null) {
      this.userProgress.quizScores[lessonId] = quizScore;
    }
  }

  setCurrentStage(stage) {
    this.userProgress.currentStage = stage;
  }

  setPracticeCompleted(value = true) {
    this.userProgress.practiceCompleted = !!value;
  }

  resetProgress() {
    this.userProgress = {
      currentStage: "beginner",
      completedLessons: [],
      quizScores: {},
      practiceCompleted: false,
    };
    return { success: true, message: "Progress reset" };
  }

  setPreferences(preferences) {
    this.userPreferences = {
      ...this.userPreferences,
      ...preferences,
    };
    return { success: true, preferences: this.userPreferences };
  }

  getPreferences() {
    return this.userPreferences;
  }
}

export default OnboardingStore;
