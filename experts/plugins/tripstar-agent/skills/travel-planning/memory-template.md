# Memory Template — Travel Planning

Create `~/travel-planning/memory.md` with this structure:

```markdown
# Travel Planning Memory

## Status
status: ongoing
version: 1.0.0
last: YYYY-MM-DD
integration: pending | done | declined

## Travel Style
<!-- Learn these naturally, don't ask directly -->
<!-- Examples: spontaneous, detailed planner, budget-conscious, luxury, solo, couple, family -->

## Preferences
<!-- Accommodation type, pace, food preferences, activity level -->

## Documents (only if user shares explicitly)
<!-- Ask before storing sensitive info: "Want me to track your passport expiry?" -->
passport_expiry: YYYY-MM-DD
frequent_flyer: [programs]
travel_insurance: [provider]

## Patterns
<!-- Emerge from past trips -->
<!-- Examples: typically spends $X/day in Europe, always overpacks, prefers morning flights -->

## Wishlist Summary
<!-- Quick reference of destinations in wishlist/ -->
- Japan (spring, cherry blossoms)
- Iceland (summer, northern lights)

## Upcoming
<!-- Quick reference of trips in trips/ -->
- Paris 2024 (May 15-22)

---
*Updated: YYYY-MM-DD*
```

## Status Values

| Value | Meaning | Behavior |
|-------|---------|----------|
| `ongoing` | Still learning preferences | Gather context from trip planning |
| `complete` | Has solid profile | Work with established preferences |
| `paused` | User said "not now" | Don't ask, work with what you have |
| `never_ask` | User said stop | Never ask for more context |

## Wishlist Entry Template

Create `~/travel-planning/wishlist/{destination}.md`:

```markdown
# {Destination}

## Why
<!-- What draws them here -->

## Best Time
<!-- Season, events, weather -->

## Duration
<!-- Ideal trip length -->

## Highlights
<!-- Must-see, must-do -->

## Budget Estimate
<!-- Rough per-person estimate -->

## Notes
<!-- Visa needs, booking tips, etc. -->
```

## Trip Folder Template

Create `~/travel-planning/trips/{trip-name}/overview.md`:

```markdown
# {Trip Name}

## Dates
{Start} - {End}

## Travelers
{Who's going}

## Purpose
{Vacation, anniversary, business + leisure, etc.}

## Accommodation
{Where staying, confirmation}

## Transport
{Flights, rental, trains}

## Status
planning | booked | traveling | completed
```

## Key Principles

- **No config keys visible** — use natural language descriptions
- **Learn from trips** — each trip teaches preferences
- **Update `last`** on every interaction
- **Wishlist is aspirational** — no pressure to commit dates
- **Completed trips** are reference — what worked, what didn't
