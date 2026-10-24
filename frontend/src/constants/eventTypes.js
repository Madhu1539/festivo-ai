import { Cake, HeartHandshake, Users } from 'lucide-react'

/** Supported event categories (§2.4). */
export const EVENT_TYPES = [
  {
    value: 'wedding',
    label: 'Wedding',
    icon: HeartHandshake,
    tagline: 'A celebration with many moving parts',
    description:
      'Venue, catering, decor, photography, styling, invitations and travel — planned around your budget.',
    accent: 'var(--color-chart-5)',
    tint: 'rose',
    examples: ['Venue & seating', 'Catering', 'Photography', 'Decor & flowers'],
  },
  {
    value: 'birthday',
    label: 'Birthday',
    icon: Cake,
    tagline: 'Simple to organize, easy to overspend',
    description:
      'Cake, food, decorations, games and return gifts, sized to your guest count.',
    accent: 'var(--color-chart-2)',
    tint: 'peach',
    examples: ['Cake', 'Food & snacks', 'Decorations', 'Games & activities'],
  },
  {
    value: 'community',
    label: 'Community Event',
    icon: Users,
    tagline: 'Many people, many approvals',
    description:
      'Stage, sound, seating, volunteers, promotion and safety arrangements for a public gathering.',
    accent: 'var(--color-chart-3)',
    tint: 'teal',
    examples: ['Stage & sound', 'Volunteers', 'Seating', 'Safety & access'],
  },
]

/** Tint classes per event type, used by the selectable cards (§7.3). */
export const TINT_CLASSES = {
  rose: {
    card: 'card-rose',
    selected: 'border-rose-600 ring-2 ring-rose-200',
    hover: 'hover:border-rose-200 hover:shadow-[0_8px_22px_rgba(194,63,108,0.12)]',
    icon: 'bg-white text-rose-600 ring-1 ring-rose-200',
    chip: 'border-rose-200 bg-white/80 text-rose-600',
    check: 'border-rose-600 bg-rose-600',
  },
  peach: {
    card: 'card-peach',
    selected: 'border-peach-600 ring-2 ring-peach-200',
    hover: 'hover:border-peach-200 hover:shadow-[0_8px_22px_rgba(194,82,42,0.12)]',
    icon: 'bg-white text-peach-600 ring-1 ring-peach-200',
    chip: 'border-peach-200 bg-white/80 text-peach-600',
    check: 'border-peach-600 bg-peach-600',
  },
  teal: {
    card: 'card-teal',
    selected: 'border-teal-600 ring-2 ring-teal-200',
    hover: 'hover:border-teal-200 hover:shadow-[0_8px_22px_rgba(16,123,127,0.12)]',
    icon: 'bg-white text-teal-600 ring-1 ring-teal-200',
    chip: 'border-teal-200 bg-white/80 text-teal-600',
    check: 'border-teal-600 bg-teal-600',
  },
}

export function tintClasses(eventType) {
  return TINT_CLASSES[EVENT_TYPE_MAP[eventType]?.tint] ?? TINT_CLASSES.rose
}

export const EVENT_TYPE_MAP = Object.fromEntries(
  EVENT_TYPES.map((type) => [type.value, type]),
)

export function eventTypeMeta(value) {
  return EVENT_TYPE_MAP[value] ?? EVENT_TYPES[2]
}

/** Theme options, adapted per event type (§7.4). */
const SHARED_THEMES = [
  'Elegant and pastel',
  'Traditional',
  'Modern and minimal',
  'Colorful and festive',
]

const THEMES_BY_TYPE = {
  wedding: [...SHARED_THEMES, 'Royal and grand', 'Garden and floral'],
  birthday: [...SHARED_THEMES, 'Cartoon and playful', 'Retro and neon'],
  community: [...SHARED_THEMES, 'Cultural and folk', 'Sports and fitness'],
}

export const AI_THEME_OPTION = 'Let AI suggest'

export function themeOptions(eventType) {
  return [...(THEMES_BY_TYPE[eventType] ?? SHARED_THEMES), AI_THEME_OPTION]
}

/** Quick-pick preference chips, adapted per event type (§7.4). */
const SHARED_PREFERENCES = [
  'Budget-friendly',
  'Simple decoration',
  'Photo corner',
  'Vegetarian only',
  'Kid-friendly',
  'Live music',
]

const PREFERENCES_BY_TYPE = {
  wedding: [
    'Budget-friendly',
    'Intimate guest list',
    'Vegetarian only',
    'Live music',
    'Candid photography',
    'Outdoor mandap',
    'Guest transport needed',
  ],
  birthday: [
    'Budget-friendly',
    'Simple decoration',
    'Photo corner',
    'Kid-friendly games',
    'Eggless cake',
    'Return gifts',
    'Themed tableware',
  ],
  community: [
    'Budget-friendly',
    'Volunteer-run',
    'Wheelchair accessible',
    'Free entry',
    'Local performers',
    'Sponsor banners',
    'Waste-free setup',
  ],
}

export function preferenceOptions(eventType) {
  return PREFERENCES_BY_TYPE[eventType] ?? SHARED_PREFERENCES
}

export const VENUE_OPTIONS = [
  { value: 'indoor', label: 'Indoor' },
  { value: 'outdoor', label: 'Outdoor' },
  { value: 'either', label: 'No preference' },
]

export const PRIORITY_STYLES = {
  high: {
    label: 'High priority',
    short: 'High',
    className: 'border border-rose-200 bg-rose-50 text-rose-600',
  },
  medium: {
    label: 'Medium priority',
    short: 'Medium',
    className: 'border border-butter-200 bg-butter-50 text-butter-600',
  },
  low: {
    label: 'Low priority',
    short: 'Low',
    className: 'border border-sky-200 bg-sky-50 text-sky-600',
  },
}

export function priorityStyle(priority) {
  return PRIORITY_STYLES[priority] ?? PRIORITY_STYLES.medium
}
