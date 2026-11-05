import type { ReactElement } from 'react'
import { petBrand, petBrandBadgeLayout } from './pet-brand'
import './pet-brand-badge.css'

type Props = { petId: string | null | undefined; width: number; row?: number; column?: number }

export function PetBrandBadge({ petId, width, row, column }: Props): ReactElement | null {
  const brand = petBrand(petId)
  if (!brand) return null
  const layout = petBrandBadgeLayout(width, row, column)
  const iconUrl = `url(${JSON.stringify(brand.icon)})`
  return (
    <span className="pet-brand-badge" aria-hidden="true" title={brand.name} data-brand={brand.name}
      style={{ width: layout.size, height: layout.size, left: layout.left, top: layout.top }}>
      {brand.color ? <span className="pet-brand-mark" style={{ background: brand.color,
        maskImage: iconUrl, WebkitMaskImage: iconUrl }} />
        : <img className="pet-brand-mark" src={brand.icon} alt="" draggable={false} />}
    </span>
  )
}
