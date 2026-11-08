import type { TFunction } from 'i18next'
import type { DesktopAccessStatus } from '@shared/remote-desktop'
import type { MobileLink } from './useMobileLink'

export function mobileManagementVisible(link: MobileLink): boolean {
  // Entitlements gate new access, not visibility of existing access and its stop/revoke controls.
  return link.signedIn && Boolean(link.mobileAllowed || link.enabled || link.starting || link.state?.online ||
    link.state?.grants.some(grant => grant.purpose !== 'desktop'))
}

export function mobileRequirement(link: MobileLink, t: TFunction<'common'>): string {
  if (!link.api) return t('remoteCompact.unavailable')
  if (!link.signedIn) return t('remoteCompact.signInRequired')
  if (link.mobileAllowed) return ''
  if (link.membershipState === 'loading') return t('remoteCompact.membershipLoading')
  if (link.membershipState === 'unavailable') return t('remoteCompact.membershipUnknown')
  return t('remoteCompact.membershipRequired')
}

export function desktopSummary(value: DesktopAccessStatus | undefined, t: TFunction<'common'>): string {
  if (!value) return t('remoteCompact.connecting')
  if (!value.supported) return t('remoteCompact.unsupported')
  if (!value.displays.some(display => display.allowed)) return t('remoteCompact.displayUnavailable')
  if (!value.enabled) return t('remoteCompact.desktopOff')
  if (!value.ready) return t('remoteCompact.screenRequired')
  if (value.inputReady === false) return t('remoteCompact.inputRequired')
  if (value.inputReady === undefined) return t('remoteCompact.inputUnknown')
  return t('remoteCompact.desktopReady')
}

export function desktopConsent(scopes: readonly string[] = []): 'control' | 'view' | 'off' {
  return scopes.includes('desktop.view') ? scopes.includes('desktop.control') ? 'control' : 'view' : 'off'
}
