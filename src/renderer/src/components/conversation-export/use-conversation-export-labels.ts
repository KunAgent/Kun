import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConversationExportLabels } from '../../lib/conversation-export'

export function useConversationExportLabels(): ConversationExportLabels {
  const { t } = useTranslation('common')
  return useMemo(() => ({
    exportedAt: t('conversationExportDocumentExportedAt'),
    user: t('conversationExportDocumentUser'),
    assistant: t('conversationExportDocumentAssistant'),
    attachments: t('conversationExportDocumentAttachments'),
    referencedFiles: t('conversationExportDocumentReferencedFiles'),
    generatedFiles: t('conversationExportDocumentGeneratedFiles'),
    sources: t('conversationExportDocumentSources'),
    attachment: t('conversationExportDocumentAttachment'),
    toolCalls: t('exportDialogDocumentToolCalls'),
    reasoning: t('exportDialogDocumentReasoning')
  }), [t])
}
