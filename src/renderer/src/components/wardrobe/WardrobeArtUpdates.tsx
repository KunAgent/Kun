import { signInToKun } from './wardrobe-account'
import { useState } from 'react'
import './wardrobe-art-updates.css'
import { useArtState } from '../rooms/art-asset-store'
export function WardrobeArtUpdates({ language }: { language: 'zh' | 'en' }) {
  const state = useArtState(), [busy, setBusy] = useState(false)
  const api = window.kunGui?.kunArt
  if (!api) return null
  const zh = language === 'zh'
  const run = async (kind: 'check' | 'rollback') => { setBusy(true); try { await api[kind]() } finally { setBusy(false) } }
  const downloading = state.phase === 'checking' || state.phase === 'downloading'
  if (state.phase === 'signed_out') return <div className="kun-art-updates ds-no-drag"><span>{zh ? '登录后解锁装扮与资源更新' : 'Sign in to unlock outfits and artwork updates'}</span><button type="button" onClick={signInToKun}>{zh ? '登录 Kun' : 'Sign in to Kun'}</button></div>
  return <div className="kun-art-updates ds-no-drag">
    <span role="status" aria-live="polite">{state.phase === 'downloading'
      ? `${zh ? '正在更新美术资源' : 'Updating artwork'} ${state.completed}/${state.total}`
      : state.phase === 'checking' ? (zh ? '正在检查资源更新…' : 'Checking artwork…')
      : state.phase === 'error' ? (zh ? '更新暂不可用，继续使用已有资源' : 'Update unavailable; using saved artwork')
      : state.held ? (zh ? '已回退，自动更新已暂停' : 'Rolled back; automatic updates paused')
      : state.manifest ? (zh ? '美术资源已就绪' : 'Artwork ready') : (zh ? '使用内置美术资源' : 'Using bundled artwork')}</span>
    <button type="button" disabled={busy || downloading} onClick={() => void run('check').catch(() => undefined)}>{zh ? '检查更新' : 'Check for updates'}</button>
    {state.rollbackAvailable && <button type="button" disabled={busy || downloading} onClick={() => void run('rollback').catch(() => undefined)}>{zh ? '回退资源' : 'Roll back artwork'}</button>}
  </div>
}
