import { useCollaborationStore } from './collaboration-store'
import { MeetingWorkspace } from './MeetingWorkspace'
import { ReceptionEmployeeDetail } from './ReceptionEmployeeDetail'
import { NetworkCollaborationBar } from './NetworkCollaborationBar'

export function CollaborationStage(): React.ReactElement {
  const { snapshot, selection } = useCollaborationStore()
  let content: React.ReactElement

  if (selection?.kind === 'meeting') {
    const meeting = snapshot.meetings.find((item) => item.id === selection.id)
    if (meeting) content = <MeetingWorkspace meeting={meeting} />
    else content = <EmptySelection />
  } else if (selection?.kind === 'employee') {
    const employee = snapshot.employees.find((item) => item.id === selection.id)
    content = employee
      ? <ReceptionEmployeeDetail employee={employee} invocations={snapshot.invocations.filter((item) => item.employeeId === employee.employeeId)} />
      : <EmptySelection />
  } else {
    content = <EmptySelection />
  }

  return <div data-collaboration-stage="true" className="flex h-full min-h-0 flex-col"><NetworkCollaborationBar meetingId={selection?.kind === 'meeting' ? selection.id : undefined} /><div className="min-h-0 flex-1">{content}</div></div>
}

function EmptySelection(): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center bg-ds-main text-[13px] text-ds-muted">
      选择会议或接待数字员工
    </div>
  )
}
