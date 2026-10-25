import type { ReactElement } from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const STEPS = ['assistantStepChoose', 'assistantStepPrompt', 'assistantStepApprove'] as const

/** Choose → send the prompt → compare codes and allow. */
export function AssistantSteps({ current }: { current: 1 | 2 | 3 }): ReactElement {
  const { t } = useTranslation('common')
  return <ol aria-label={t('assistantStepsLabel')} className="flex flex-wrap items-center gap-2 text-[12.5px] text-ds-muted">
    {STEPS.map((key, index) => {
      const step = index + 1
      const done = step < current
      return <li key={key} className="flex items-center gap-2" aria-current={step === current ? 'step' : undefined}>
        {index ? <span aria-hidden="true" className="h-px w-5 bg-ds-border" /> : null}
        <span className={`flex items-center gap-1.5 ${done ? 'text-emerald-600 dark:text-emerald-400' : step === current ? 'font-semibold text-ds-ink' : ''}`}>
          {done ? <Check size={15} strokeWidth={2.6} aria-hidden="true" />
            : <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${step === current ? 'bg-accent text-white' : 'border border-ds-border'}`}>{step}</span>}
          {t(key)}
        </span>
      </li>
    })}
  </ol>
}
