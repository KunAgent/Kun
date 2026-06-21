export type LarkDocumentStatus =
  | 'enabled'
  | 'disabled'
  | 'config_required'
  | 'auth_required'
  | 'rate_limited'
  | 'error'

export type LarkCliInstallResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      cliPath: string
      version?: string | null
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: 'disabled' | 'error'
      message: string
    }

export type LarkCliConfigurePayload = {
  appId: string
  appSecret: string
  domain?: 'feishu' | 'lark' | string
}

export type LarkCliConfigureResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentAuthStartResult =
  | {
      ok: true
      source: 'lark'
      status: 'auth_required'
      verificationUrl: string
      deviceCode: string
      userCode?: string | null
      interval?: number | null
      expireIn?: number | null
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentAuthCompletePayload = {
  deviceCode: string
}

export type LarkDocumentAuthCompleteResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentListItem = {
  id: string
  source: 'lark'
  title: string
  url: string
  token: string
  extension: string
  larkType?: string | null
  ownerName?: string | null
  updatedAt?: string | null
  createdAt?: string | null
  openedAt?: string | null
  matchedBy?: string[]
}

export type LarkImportedDocumentRecord = {
  path: string
  metadataPath: string
  title: string
  url: string
  token: string
  documentId?: string | null
  revisionId?: string | number | null
  importedAt?: string | null
  updatedAt?: string | null
}

export type LarkImportedDocumentsPayload = {
  workspaceRoot: string
}

export type LarkImportedDocumentsResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      documents: LarkImportedDocumentRecord[]
      message?: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentListPayload = {
  query?: string
  pageSize?: number
  maxPages?: number
  editedSince?: string
  openedSince?: string
  wide?: boolean
}

export type LarkDocumentListResult = {
  ok: true
  source: 'lark'
  status: LarkDocumentStatus
  documents: LarkDocumentListItem[]
  message?: string
}

export type LarkDocumentImportPayload = {
  workspaceRoot: string
  document: LarkDocumentListItem
  limit?: number
}

export type LarkDocumentImportResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      path: string
      metadataPath: string
      title: string
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentImportMetadata = {
  source: 'lark'
  importedAt?: string
  document: {
    id: string
    title: string
    url: string
    token: string
    documentId?: string | null
    extension: string
    ownerName?: string | null
    updatedAt?: string | null
    createdAt?: string | null
    openedAt?: string | null
    revisionId?: string | number | null
  }
  sync?: {
    mode?: 'local-cache'
    remoteWriteBack?: 'manual'
    lastPushedAt?: string | null
    lastPushedMode?: LarkDocumentUpdateMode | null
    lastPushedRevisionId?: string | number | null
    lastCreatedDocument?: LarkDocumentRemoteRecord | null
  }
}

export type LarkDocumentMetadataPayload = {
  workspaceRoot: string
  path: string
}

export type LarkDocumentMetadataResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      path: string
      metadataPath: string
      metadata: LarkDocumentImportMetadata | null
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentUpdateMode = 'overwrite' | 'create'

export type LarkDocumentRemoteRecord = {
  id: string
  title: string
  url: string
  token: string
  documentId?: string | null
  extension: string
  revisionId?: string | number | null
  createdAt?: string | null
}

export type LarkDocumentUpdatePayload = {
  workspaceRoot: string
  path: string
  content: string
  mode?: LarkDocumentUpdateMode
  title?: string
}

export type LarkDocumentUpdateResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      mode: LarkDocumentUpdateMode
      message: string
      revisionId?: string | number | null
      document?: LarkDocumentRemoteRecord | null
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentRefreshPayload = {
  workspaceRoot: string
  path: string
  limit?: number
}

export type LarkDocumentRefreshResult =
  | {
      ok: true
      source: 'lark'
      status: 'enabled'
      path: string
      metadataPath: string
      title: string
      content: string
      revisionId?: string | number | null
      message: string
    }
  | {
      ok: false
      source: 'lark'
      status: LarkDocumentStatus
      message: string
    }

export type LarkDocumentDetail = {
  id: string
  source: 'lark'
  title: string
  url: string
  token: string
  extension: string
  ownerName?: string | null
  updatedAt?: string | null
  createdAt?: string | null
  openedAt?: string | null
  content: string
  contentFormat: 'markdown'
  truncated: boolean
  documentId?: string | null
  revisionId?: string | number | null
}
