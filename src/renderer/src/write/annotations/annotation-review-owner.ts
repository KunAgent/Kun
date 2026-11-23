import { create } from 'zustand'

export const useAnnotationReviewOwner = create<{ key: string | null }>(() => ({ key: null }))
