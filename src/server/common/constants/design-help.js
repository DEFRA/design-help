export const AVAILABLE_TAGS = [
  'Design crits',
  'Prototyping question',
  'Mural support',
  'Figma support',
  'Accessibility questions',
  'Feedback on service design artefact',
  'Help with GDaD evidence',
  'Heroku',
  'SOP and admin systems',
  'AI tooling and prompts'
]

export const ROLE_GROUPS = [
  {
    label: 'Interaction design',
    roles: ['Interaction Designer', 'Senior Interaction Designer']
  },
  {
    label: 'Service design',
    roles: [
      'Service Designer',
      'Senior Service Designer',
      'Principal Service Designer'
    ]
  },
  {
    label: 'Leadership',
    roles: ['Head of Design', 'Design Manager', 'Senior Resource Manager']
  },
  {
    label: 'Accessibility',
    roles: [
      'Accessibility Specialist (SEO)',
      'Senior Accessibility Specialist (Grade 7)'
    ]
  }
]

export const ALLOWED_ROLES = ROLE_GROUPS.flatMap((group) => group.roles)

export const AVAILABILITY_STATUSES = ['Busy', 'Some capacity', 'Free to help']

export const PROFESSION_GROUPS = [
  { groupName: 'Service design', match: /service designer/i },
  { groupName: 'Interaction design', match: /interaction designer/i },
  {
    groupName: 'Leadership',
    match: /head of design|design manager|resource manager/i
  },
  { groupName: 'Accessibility', match: /accessibility/i }
]

export const MAX_FREE_TEXT_WORDS = 150

export function countWords(text) {
  return String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export function professionGroupFor(role) {
  const group = PROFESSION_GROUPS.find((entry) => entry.match.test(role ?? ''))
  return group?.groupName ?? 'Other'
}

/** The URL identity for a person: slug when they have one, else the id. */
export function personPath(person) {
  return `/profile/${person.slug ?? person.id}`
}
