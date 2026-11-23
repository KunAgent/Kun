import type { WorkAnnotation, WorkAnnotationDocument } from '@shared/work-annotations'
import { normalizeWritePath } from './write-path-normalization'

const STORE = 'annotations'
const INDEX = 'byDocument'
let database: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (database) return database
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('kun-work-annotations', 1)
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' })
      store.createIndex(INDEX, ['workspaceRoot', 'filePath'])
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); database = null }
      resolve(db)
    }
  })
  database = opening
  void opening.catch(() => { if (database === opening) database = null })
  return opening
}

export function normalizeAnnotationDocument(doc: WorkAnnotationDocument): WorkAnnotationDocument {
  return { workspaceRoot: normalizeWritePath(doc.workspaceRoot), filePath: normalizeWritePath(doc.filePath) }
}

export function annotationDocumentKey(doc: WorkAnnotationDocument): string {
  const { workspaceRoot, filePath } = normalizeAnnotationDocument(doc)
  return JSON.stringify([workspaceRoot, filePath])
}

export async function listAnnotations(doc: WorkAnnotationDocument): Promise<WorkAnnotation[]> {
  const db = await open()
  const { workspaceRoot, filePath } = normalizeAnnotationDocument(doc)
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).index(INDEX).getAll([workspaceRoot, filePath])
    req.onsuccess = () => resolve((req.result as WorkAnnotation[]).sort((a,b) => a.createdAt.localeCompare(b.createdAt)))
    req.onerror = () => reject(req.error)
  })
}

/** The entire read/modify/write lives in one IndexedDB transaction, including across windows. */
export async function mutateAnnotation(id: string, update: (record?: WorkAnnotation) => WorkAnnotation): Promise<WorkAnnotation> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const read = store.get(id)
    let next: WorkAnnotation
    let failure: unknown
    read.onsuccess = () => {
      try {
        next = update(read.result as WorkAnnotation | undefined)
        if (next !== read.result) store.put(next)
      } catch (error) { failure = error; tx.abort() }
    }
    tx.oncomplete = () => resolve(next)
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not save the annotation.'))
  })
}

export async function moveStoredAnnotations(workspace: string, oldPath: string, newPath: string): Promise<WorkAnnotationDocument[]> {
  const db = await open()
  const root = normalizeWritePath(workspace), previous = normalizeWritePath(oldPath), next = normalizeWritePath(newPath)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const index = tx.objectStore(STORE).index(INDEX)
    const documents = new Map<string, WorkAnnotationDocument>()
    const req = index.openCursor(IDBKeyRange.bound([root, previous], [root, previous + '/\uffff']))
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      const record = cursor.value as WorkAnnotation
      if (record.filePath === previous || record.filePath.startsWith(previous + '/')) {
        const moved = { ...record, filePath: next + record.filePath.slice(previous.length) }
        // Moving outside the cursor range avoids revisiting the updated index entry.
        cursor.update(moved)
        documents.set(record.filePath, { workspaceRoot: root, filePath: record.filePath })
        documents.set(moved.filePath, { workspaceRoot: root, filePath: moved.filePath })
      }
      cursor.continue()
    }
    tx.oncomplete = () => resolve([...documents.values()])
    tx.onabort = () => reject(tx.error ?? new Error('Could not move annotation bindings.'))
  })
}
