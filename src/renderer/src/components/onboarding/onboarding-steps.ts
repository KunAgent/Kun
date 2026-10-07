export const ONBOARDING_STEPS = ['welcome', 'model', 'permission', 'agents', 'ready'] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]
export type OnboardingDirection = 'forward' | 'backward'
/** The model step first lists providers, then configures the chosen one. */
export type OnboardingModelPhase = 'pick' | 'configure'

export function onboardingStepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step)
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.min(ONBOARDING_STEPS.length - 1, onboardingStepIndex(step) + 1)]
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.max(0, onboardingStepIndex(step) - 1)]
}

export function onboardingDirection(from: OnboardingStep, to: OnboardingStep): OnboardingDirection {
  return onboardingStepIndex(to) >= onboardingStepIndex(from) ? 'forward' : 'backward'
}

/**
 * Steps after the settings save talk to the runtime. Jumping back to an
 * earlier step is always allowed; jumping forward past `permission` needs a
 * completed save, otherwise the runtime would not know the chosen provider.
 */
export function canOpenOnboardingStep(
  target: OnboardingStep,
  current: OnboardingStep,
  saved: boolean
): boolean {
  if (onboardingStepIndex(target) <= onboardingStepIndex(current)) return true
  if (onboardingStepIndex(target) > onboardingStepIndex('permission')) return saved
  return false
}

/** Enter advances only from single-line text fields, never from buttons or textareas. */
export function onboardingEnterAdvances(target: EventTarget | null): boolean {
  if (!target || typeof (target as { tagName?: unknown }).tagName !== 'string') return false
  const element = target as unknown as { tagName: string; type?: string }
  if (element.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'button', 'submit'].includes(String(element.type ?? 'text'))
}
