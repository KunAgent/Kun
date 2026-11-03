import { AgentImportPreviewRequest, AgentImportCommitRequest } from '../../contracts/agent-profile-import.js'
export { ImportedProfile, AgentImportDocument } from '../../contracts/agent-profile-import.js'
export const AgentImportParams = {
  'agent.import.preview': AgentImportPreviewRequest,
  'agent.import.commit': AgentImportCommitRequest
} as const
