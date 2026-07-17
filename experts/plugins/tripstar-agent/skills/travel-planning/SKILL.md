---
name: travel-planning
slug: travel-planning
version: 1.0.1
homepage: https://clawic.com/skills/travel-planning
description: Plan trips with itineraries, multi-city routing, budget optimization, family logistics, packing lists, and visa timelines. Use when user asks to plan a trip, create a travel itinerary, optimize multi-city routes, manage travel budget, or prepare packing lists.
description_zh: "行程规划：多城市路线、预算优化、打包清单、签证时间表"
description_en: "Plan trips with itineraries, multi-city routing, budget optimization and packing lists"
changelog: Fixed all references to use travel-planning consistently.
allowed-tools: Read,Write
metadata: {"clawdbot":{"emoji":"✈️","requires":{"bins":[]},"os":["linux","darwin","win32"]}}
---

## Setup

On first use, read `setup.md` for onboarding guidelines. Start helping naturally without technical jargon — users can always ask about storage details if curious.

## When to Use

User wants to plan a trip, track travel expenses, organize bookings, coordinate group/family travel, or build packing lists. Agent handles the full travel lifecycle: dreaming, planning, booking, traveling, and documenting.

## Architecture

Memory lives in `~/travel-planning/`. See `memory-template.md` for structure.

```
~/travel-planning/
├── memory.md              # Preferences + travel history summary
├── wishlist/              # Dream destinations
│   └── {destination}.md
├── trips/                 # Active and upcoming trips
│   └── {trip-name}/
│       ├── overview.md
│       ├── itinerary.md
│       ├── bookings.md
│       ├── packing.md
│       ├── budget.md
│       └── travelers.md     # For group/family trips
├── completed/             # Past trips with notes
├── templates/             # Reusable packing lists
└── documents/             # Passport, visa info, insurance
```

## Quick Reference

| Topic | File |
|-------|------|
| Setup process | `setup.md` |
| Memory template | `memory-template.md` |
| Booking timing | `booking-guide.md` |
| Packing templates | `packing-templates.md` |
| Multi-city planning | `multi-city.md` |

## Core Rules

### 1. Check Memory First
Before any trip planning, read `~/travel-planning/memory.md` for:
- Travel style preferences (budget, pace, accommodation type)
- Past trip patterns (average daily spend, packing habits)
- Document status (passport expiry, frequent flyer numbers)
- Family/group composition if applicable

### 2. Trip Lifecycle
| Phase | Action |
|-------|--------|
| Dream | Add to `wishlist/` with why, when, budget estimate |
| Plan | Create trip folder in `trips/` when dates confirmed |
| Book | Track confirmations in trip's bookings.md, update budget |
| Travel | Reference itinerary, log actual expenses |
| Return | Move to `completed/`, document highlights and lessons |

### 3. Booking Timeline Reminders
Proactively remind based on trip dates:
- 90 days out: Complex visas (China, Russia, India), group bookings
- 60 days out: International flights, travel insurance for pre-existing conditions
- 45 days out: Hotels, standard visas, rental cars for groups
- 30 days out: Activities, restaurant reservations, special requests
- 14 days out: Travel insurance (general), kids' documents check
- 7 days out: Bank notifications, packing list finalization, check-in reminders

### 4. Budget Tracking & Optimization
For each trip, track in its budget.md:
```markdown
## Budget — {Trip Name}

### Per-Person Breakdown (for groups)
| Traveler | Share | Notes |
|----------|-------|-------|
| Adult 1 | $X | Organizer |
| Adult 2 | $X | |
| Child | $X | 50% activities |

### Planned
| Category | Estimate | Optimization Applied |
|----------|----------|---------------------|
| Flights | $X | Shoulder season ✓ |
| Hotels | $X | Kitchen saves meals |
| Transport | $X | Off-airport rental |
| Food | $X | ~$Y/day/person |
| Activities | $X | City passes ✓ |
| **Total** | **$X** | **Saved: $Y** |

### Actual (update during/after)
| Category | Spent | vs Planned |
|----------|-------|------------|
```

### 5. Multi-City & Complex Itineraries
For trips with 2+ cities:
- Plan minimum 2 nights per city (avoid one-night stays)
- Group geographically close destinations
- Consider open-jaw flights (fly into A, out of B) — often same price
- Build connection buffers: 4+ hours international, 2+ hours domestic
- Track different currencies and exchange rates per leg

### 6. Family & Group Travel
When traveling with kids or groups:
- Create travelers.md in trip folder with each person's details (dietary, medical, seat prefs)
- Plan kid-friendly activities with energy breaks
- Book accommodations with kitchen access (saves 30%+ on food)
- Check child visa/consent requirements (some countries need notarized letters)
- Pack shared items list to avoid duplication
- Assign roles: navigator, budget tracker, activity planner

### 7. Document Safety (with user consent)
Only store document info if user explicitly shares it:
- Passport expiry dates (for validity warnings)
- Visa requirements per destination
- Travel insurance policy numbers
- Emergency contacts (embassy, bank, family)
- Never store full document images — only reference numbers

## Booking Optimization

### Timing
| Booking | Optimal Window | Why |
|---------|----------------|-----|
| Domestic flights | 6-8 weeks out | Price sweet spot |
| International flights | 3-4 months out | 10-20% savings |
| Hotels | 2-3 months out | Best selection + rates |
| Rental cars | 2-6 weeks out | Prices fluctuate less |
| Group activities | 4-6 weeks out | Availability for large groups |

### Cost Optimization Tactics
| Strategy | Typical Savings | When to Use |
|----------|-----------------|-------------|
| Shoulder season | 30-40% | Flexible dates |
| Off-airport car rental | 30-40% | Any rental |
| Kitchen accommodation | 30%+ food costs | Family trips, 5+ days |
| City passes | 20-40% on activities | 3+ attractions planned |
| Open-jaw flights | $0-100 | Multi-city, different endpoints |
| Tuesday flight booking | 5-15% | Flexible booking day |
| Bundle hotel+flight | 10-20% | Package deals available |

### Group Booking Tips
- Book flights separately for flexibility (one delay shouldn't cancel all)
- Hotels: request adjoining rooms at booking, confirm before arrival
- Activities: ask for group discounts (10+ people often qualify)
- Car rentals: compare 2 cars vs 1 large van (often cheaper + more flexible)

## Itinerary Structure

```markdown
# Day X — {Date} — {Location}

## Morning
- [ ] {Activity} @ {Time}
  - Address: {address}
  - Kid-friendly: ✓/✗
  - Notes: {hours, tickets, tips}

## Afternoon
- [ ] {Activity}

## Evening
- [ ] Dinner @ {Restaurant}
  - Reservation: {time}
  - Confirmation: {number}
  - High chairs available: ✓/✗

## Logistics
- Transport: {how to get there}
- Accommodation: {check-in time if applicable}
- Backup plan: {if weather/energy fails}
```

Keep 2-3 hours buffer daily. Mark must-dos vs nice-to-haves.

## Multi-City Connection Planning

```markdown
## City Connections — {Trip Name}

| From | To | Transport | Duration | Cost | Booked |
|------|-----|-----------|----------|------|--------|
| Paris | Amsterdam | Train | 3h20m | €80 | ✓ |
| Amsterdam | Berlin | Flight | 1h15m | €65 | ✓ |

### Connection Risks
- Paris→Amsterdam: Low (frequent trains, no checkin)
- Amsterdam→Berlin: Medium (need 2h+ at airport)

### Luggage Strategy
- Full luggage: check at origin, pick at final destination
- Day bags: carry essentials for city transitions
```

## Common Traps

- Over-scheduling → leave discovery room (max 3 planned activities/day)
- Forgetting to document after trip → memories fade in days, not months
- Booking without checking visa requirements → some need 90+ days
- Ignoring passport validity → many countries require 6 months beyond trip dates
- Not saving confirmation numbers → create bookings.md immediately
- One-night stays in cities → exhausting, skip or extend
- Ignoring jet lag recovery → plan light first day after long-haul
- Group booking all together → one problem cancels everyone

## Scope

This skill ONLY:
- Manages travel planning in `~/travel-planning/`
- Reads/writes markdown files for trips, budgets, packing
- Reminds about deadlines based on trip dates

This skill NEVER:
- Makes actual bookings (provides info for user to book)
- Accesses email or calendar directly
- Stores payment information
- Reads files outside `~/travel-planning/`

## Related Skills
Install with `clawhub install <slug>` if user confirms:
- `daily-planner` — daily task management
- `plan` — general project planning
- `expenses` — expense tracking

## Feedback

- If useful: `clawhub star travel-planning`
- Stay updated: `clawhub sync`
