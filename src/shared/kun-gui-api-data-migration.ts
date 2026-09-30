import type {
  DataMigrationEstimate,
  DataMigrationExportOptions,
  DataMigrationImportOptions,
  DataMigrationImportPlan,
  DataMigrationInspectionSummary,
  DataMigrationOperationStatus,
  DataMigrationPathPickResult,
  DataMigrationProgress,
  DataMigrationRendererRequest,
  DataMigrationRendererResponse,
  DataMigrationReport,
  DataMigrationWorkspaceConflictStrategy
} from './data-migration'

/** Data migration IPC contract shared by the workbench and its minimal bridge. */
export interface KunGuiDataMigrationApi {
  dataMigration: {
    pickExportPackage: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    pickImportPackage: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    pickDestinationDirectory: (defaultPath?: string) => Promise<DataMigrationPathPickResult>
    estimateExport: (input: Pick<DataMigrationExportOptions,
      'operationId' | 'selectedWorkspaceIds' | 'categories' | 'preset' | 'sensitiveContentAcknowledged'
    >) => Promise<DataMigrationEstimate>
    inspectPackage: (input: { packagePath: string; passphrase?: string }) => Promise<DataMigrationInspectionSummary>
    planImport: (input: {
      operationId: string
      inspectionId: string
      destinationBaseRoot: string
      destinationRoots?: Record<string, string>
      strategies?: Record<string, DataMigrationWorkspaceConflictStrategy>
      skippedWorkspaceIds?: string[]
    }) => Promise<DataMigrationImportPlan>
    startExport: (input: DataMigrationExportOptions) => Promise<{ packagePath: string; report: DataMigrationReport }>
    startImport: (input: DataMigrationImportOptions) => Promise<{ report: DataMigrationReport; refreshRequired: boolean }>
    cancel: (operationId: string) => Promise<DataMigrationOperationStatus>
    recover: (operationId: string, action: 'resume' | 'rollback') => Promise<DataMigrationOperationStatus>
    getStatus: () => Promise<DataMigrationOperationStatus>
    listReports: () => Promise<DataMigrationReport[]>
    getReport: (operationId: string) => Promise<DataMigrationReport>
    deleteReport: (operationId: string) => Promise<void>
    onProgress: (handler: (progress: DataMigrationProgress) => void) => () => void
    onRendererRequest: (handler: (request: DataMigrationRendererRequest) => void) => () => void
    respondRendererRequest: (response: DataMigrationRendererResponse) => Promise<void>
  }
}
