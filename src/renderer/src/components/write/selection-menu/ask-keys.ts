export function resolveAskKey(event: {
  key: string; metaKey: boolean; ctrlKey: boolean; isComposing?: boolean; keyCode?: number
}, text: string, mac: boolean): 'edit' | 'chat' | 'clear' | 'blur' | null {
  if (event.isComposing || event.keyCode === 229) return null
  if (event.key === 'Escape') return text ? 'clear' : 'blur'
  if (event.key !== 'Enter' || !text.trim()) return null
  return (mac ? event.metaKey : event.ctrlKey) ? 'chat' : 'edit'
}
