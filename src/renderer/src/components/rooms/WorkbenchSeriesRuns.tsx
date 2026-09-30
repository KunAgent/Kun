import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkbenchLinkEntry } from '@shared/rooms-api'
import { workbenchClient } from './workbench-client'
import { openWorkbenchLinkTarget, workbenchOpenTarget } from './workbench-navigation'

export function WorkbenchSeriesRuns({ roomId, ids }: { roomId: string; ids: string[] }) {
  const { t } = useTranslation('common')
  const [runs, setRuns] = useState<WorkbenchLinkEntry[]>([])
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all(ids.slice(0, 5).map((id) => workbenchClient.get(roomId, id, controller.signal).catch(() => null)))
      .then((items) => { if (!controller.signal.aborted) setRuns(items.filter((item): item is WorkbenchLinkEntry => Boolean(item))) })
    return () => controller.abort()
  }, [roomId, ids])
  if (!runs.length) return null
  return <div className="rooms-workbench-series-runs"><strong>{t('roomsWorkbenchRecentRuns')}</strong>
    {runs.map((run) => <div key={run.id}><span>{new Date(run.createdAt).toLocaleString()} · {t(`roomsWorkbenchStatus_${run.status}`)}</span>
      {workbenchOpenTarget(run) ? <button type="button" onClick={() => void openWorkbenchLinkTarget(run)}>
        {t(run.surface === 'code' ? 'roomsWorkbenchOpenCode' : 'roomsWorkbenchOpenWork')}</button> : null}</div>)}
  </div>
}
