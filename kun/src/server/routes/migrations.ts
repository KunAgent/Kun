import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { RuntimeMigrationExportCreateRequest } from '../../contracts/migrations.js'
import {
  RuntimeMigrationService,
  RuntimeMigrationSnapshotError
} from '../../services/runtime-migration-service.js'
import {
  RuntimeMigrationImportService,
  parseRuntimeMigrationImportRequest
} from '../../services/runtime-migration-import-service.js'
import { readJsonBody } from '../read-json-body.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function createMigrationExport(
  service: RuntimeMigrationService | undefined,
  request: Request
): Promise<JsonResponse | Response> {
  if (!service) return ERRORS.unavailable('runtime migration service is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = RuntimeMigrationExportCreateRequest.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid migration export request', parsed.error.issues)
  try {
    return jsonResponse({ snapshot: await service.createExport(parsed.data) }, 201)
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

export async function streamMigrationExport(
  service: RuntimeMigrationService | undefined,
  snapshotId: string
): Promise<JsonResponse | Response> {
  if (!service) return ERRORS.unavailable('runtime migration service is unavailable')
  try {
    const { snapshot, filePath } = await service.getExport(snapshotId)
    const nodeStream = createReadStream(filePath)
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 200,
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-length': String(snapshot.byteSize),
        'x-kun-snapshot-sha256': snapshot.sha256,
        'cache-control': 'no-store'
      }
    })
  } catch (error) {
    return migrationErrorResponse(error)
  }
}

export async function releaseMigrationExport(
  service: RuntimeMigrationService | undefined,
  snapshotId: string
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration service is unavailable')
  const released = await service.releaseExport(snapshotId)
  return released ? jsonResponse({ released: true }) : ERRORS.notFound(`migration export snapshot not found: ${snapshotId}`)
}

export async function preflightMigrationImport(
  service: RuntimeMigrationImportService | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration import service is unavailable')
  try {
    const parsed = await parseRuntimeMigrationImportRequest(request)
    return jsonResponse({ preflight: await service.preflight(parsed.control, parsed.records) }, 201)
  } catch (error) {
    return ERRORS.validation(error instanceof Error ? error.message : 'invalid runtime migration import')
  }
}

export async function commitMigrationImport(
  service: RuntimeMigrationImportService | undefined,
  importId: string
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration import service is unavailable')
  try {
    return jsonResponse({ result: await service.commit(importId) })
  } catch (error) {
    return migrationImportError(error)
  }
}

export async function verifyMigrationImport(
  service: RuntimeMigrationImportService | undefined,
  importId: string
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration import service is unavailable')
  try {
    return jsonResponse({ result: await service.verify(importId) })
  } catch (error) {
    return migrationImportError(error)
  }
}

export async function rollbackMigrationImport(
  service: RuntimeMigrationImportService | undefined,
  importId: string
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration import service is unavailable')
  try {
    return jsonResponse({ result: await service.rollback(importId) })
  } catch (error) {
    return migrationImportError(error)
  }
}

export async function releaseMigrationImport(
  service: RuntimeMigrationImportService | undefined,
  importId: string
): Promise<JsonResponse> {
  if (!service) return ERRORS.unavailable('runtime migration import service is unavailable')
  try {
    const released = await service.release(importId)
    return released ? jsonResponse({ released: true }) : ERRORS.notFound(`runtime migration import not found: ${importId}`)
  } catch (error) {
    return migrationImportError(error)
  }
}

function migrationErrorResponse(error: unknown): JsonResponse {
  if (error instanceof RuntimeMigrationSnapshotError) {
    if (error.code === 'not_found' || error.code === 'expired') return ERRORS.notFound(error.message)
    if (
      error.code === 'running_thread' ||
      error.code === 'snapshot_changed' ||
      error.code === 'malformed_history'
    ) return ERRORS.conflict(error.message)
  }
  return ERRORS.internal(error instanceof Error ? error.message : 'runtime migration failed')
}

function migrationImportError(error: unknown): JsonResponse {
  const message = error instanceof Error ? error.message : 'runtime migration import failed'
  if (/not found/i.test(message)) return ERRORS.notFound(message)
  if (/already|maintenance|not committed|rolled back/i.test(message)) return ERRORS.conflict(message)
  return ERRORS.internal(message)
}
