import os from 'node:os'

type LanCandidate = {
  address: string
  name: string
  order: number
}

function parseIpv4Parts(address: string): number[] | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  const numbers = parts.map((part) => Number(part))
  return numbers.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? numbers
    : null
}

/** Private/common LAN ranges score highest so the shown URL is usually right. */
function ipv4NetworkScore(address: string): number {
  const parts = parseIpv4Parts(address)
  if (!parts) return 0
  const [a, b] = parts
  if (a === 192 && b === 168) return 400
  if (a === 10) return 380
  if (a === 172 && b >= 16 && b <= 31) return 360
  if (a === 169 && b === 254) return 40
  return 200
}

/** Physical interfaces beat VPN/bridge/virtual adapters for the primary URL. */
function interfaceNameScore(name: string): number {
  const normalized = name.toLowerCase()
  if (/(utun|tailscale|wireguard|wg|tun|tap|vpn|zerotier|hamachi)/.test(normalized)) return -100
  if (/(vbox|vmware|vmnet|parallels|docker|veth|br-|bridge|hyper-v|virtualbox|loopback|pseudo)/.test(normalized)) return -60
  if (/(en0|en1|eth0|wlan|wifi|wi-fi|ethernet|local area)/.test(normalized)) return 60
  return 0
}

export function lanIpv4Addresses(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): LanCandidate[] {
  const candidates: LanCandidate[] = []
  let order = 0
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (!entry || entry.internal) continue
      if (entry.family !== 'IPv4') continue
      if (!entry.address) continue
      const parts = parseIpv4Parts(entry.address)
      if (!parts) continue
      const [first] = parts
      if (first === 0 || first === 127 || first >= 224) continue
      candidates.push({ address: entry.address, name, order: order++ })
    }
  }
  return candidates
}

export function lanUrlsForPort(
  port: number,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()
): string[] {
  const seen = new Set<string>()
  return lanIpv4Addresses(interfaces)
    .sort(
      (left, right) =>
        ipv4NetworkScore(right.address) + interfaceNameScore(right.name) -
          (ipv4NetworkScore(left.address) + interfaceNameScore(left.name)) ||
        left.order - right.order
    )
    .map((candidate) => `http://${candidate.address}:${port}`)
    .filter((url) => {
      if (seen.has(url)) return false
      seen.add(url)
      return true
    })
}
