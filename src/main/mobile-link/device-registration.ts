import { RemoteApi, RemoteError } from '@kun/remote-protocol'

/** A registration rejection concerns this device; it must not silently create another identity. */
export async function registerMobileHost(api: RemoteApi, name: string, platform: string): Promise<void> {
  try {
    await api.request('/devices', 'POST', { name, platform, role: 'host' })
  } catch (error) {
    if (error instanceof RemoteError && error.status === 403 && error.code === 'forbidden')
      throw new RemoteError('DEVICE_AUTHORIZATION_REQUIRED')
    throw error
  }
}
