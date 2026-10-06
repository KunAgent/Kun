type Credentials = { apiKey: string; headers?: Record<string, string>; refreshable: boolean }

function accountId(headers: Record<string, string> | undefined): string | undefined {
  return Object.entries(headers ?? {}).find(([name]) => name.toLowerCase() === 'chatgpt-account-id')?.[1]
}

/** A pinned client may refresh its own OAuth account, but cannot borrow a replacement account's key. */
export function providerCredentialLease(
  resolve: (rejectedAccessToken?: string) => Promise<Credentials>,
  initial: { apiKey: string; headers?: Record<string, string> }
): (rejectedAccessToken?: string) => Promise<Credentials> {
  let lease: Credentials | undefined = initial.apiKey
    ? { apiKey: initial.apiKey, headers: initial.headers ? { ...initial.headers } : undefined, refreshable: false }
    : undefined
  return async (rejectedAccessToken) => {
    const current = await resolve(rejectedAccessToken)
    if (!lease) lease = { ...current, headers: current.headers ? { ...current.headers } : undefined }
    const owner = accountId(lease.headers)
    if (owner && accountId(current.headers) === owner) {
      lease = { ...current, headers: current.headers ? { ...current.headers } : undefined }
      return lease
    }
    return { ...lease, refreshable: false }
  }
}
