import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'

/**
 * Actions for terminal turn runtime errors. The Continue prompt differs by
 * error code: output truncation asks the model to resume with smaller pieces,
 * while restart interrupts ask it to verify state and finish the original task.
 */
export function useTurnRuntimeErrorActions(): {
  continueInterruptedTask: (code?: string) => void
  openProviderSettings: () => void
} {
  const { t } = useTranslation('common')
  const sendMessage = useChatStore((s) => s.sendMessage)
  const openSettings = useChatStore((s) => s.openSettings)
  return {
    continueInterruptedTask: (code) => {
      void sendMessage(
        t(
          code === 'output_truncated'
            ? 'continueTruncatedTaskPrompt'
            : 'continueInterruptedTaskPrompt'
        )
      )
    },
    openProviderSettings: () => openSettings('providers')
  }
}
