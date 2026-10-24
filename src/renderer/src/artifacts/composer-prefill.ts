/** Window event that puts a starter prompt into the Code composer without sending it. */
export const COMPOSER_PREFILL_EVENT = 'kun:composer-prefill'

export type ComposerPrefillDetail = { text: string }
