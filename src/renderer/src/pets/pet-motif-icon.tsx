import type { ReactElement } from 'react'
import { BookOpen, Bug, Circle, CircleDot, Code2, Coffee, Gift, Heart, Leaf, Lightbulb, Moon, Music, Orbit, Sparkles, Star, Wind } from 'lucide-react'
import type { PetMotif } from './pet-ensemble-catalog'

const ICONS = { book: BookOpen, bug: Bug, code: Code2, coffee: Coffee, gift: Gift, heart: Heart,
  leaf: Leaf, idea: Lightbulb, moon: Moon, music: Music, orbit: Orbit, spark: Sparkles,
  star: Star, wind: Wind, bubble: Circle, ball: CircleDot }

export function PetMotifIcon({ motif }: { motif: PetMotif }): ReactElement {
  const Icon = ICONS[motif]
  return <Icon aria-hidden="true" strokeWidth={1.8} />
}
