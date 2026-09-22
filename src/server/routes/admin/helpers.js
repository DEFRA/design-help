import { config } from '#/config/config.js'
import { isBootstrapAdminEmail } from '#/server/common/helpers/auth/user-session.js'
import {
  ALLOWED_ROLES,
  AVAILABILITY_STATUSES
} from '#/server/common/constants/design-help.js'

const DEFRA_EMAIL_PATTERN = /^[^@\s]+@defra\.gov\.uk$/i
const ANY_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * Outside production the Defra-domain rule is relaxed so local development
 * can add any well-formed address — mirrors the sign-in controller.
 */
export function isAcceptableAdminEmail(email) {
  return config.get('isProduction')
    ? DEFRA_EMAIL_PATTERN.test(email)
    : ANY_EMAIL_PATTERN.test(email)
}

export function normaliseEmailInput(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

export function normaliseAllowedRole(role) {
  const wanted = String(role ?? '')
    .trim()
    .toLowerCase()
  return ALLOWED_ROLES.find((allowed) => allowed.toLowerCase() === wanted)
}

export function normaliseAvailabilityStatus(status) {
  const wanted = String(status ?? '')
    .trim()
    .toLowerCase()
  return AVAILABILITY_STATUSES.find(
    (allowed) => allowed.toLowerCase() === wanted
  )
}

export function parseTagList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value ? [value] : []
}

/** ?adminMsg= codes rendered on /admin/users, copy ported from the prototype. */
const ADMIN_MESSAGES = {
  'not-defra':
    'Only @defra.gov.uk addresses can be added. Check the address and try again.',
  missing: 'Enter an email address.',
  duplicate: 'That address is already on the allowed list.',
  'admin-granted': 'Admin access was granted.',
  'admin-revoked': 'Admin access was removed.',
  'admin-protected':
    'That admin cannot be removed here (they are set in service configuration).',
  'admin-not-listed':
    'That person must be on the allowed list or have a registered account before you grant admin access.',
  'admin-already': 'That person already has admin access.',
  'admin-no-email': 'No email address for that person.'
}

const ADMIN_SUCCESS_CODES = new Set(['admin-granted', 'admin-revoked'])

export function adminMessageFor(code) {
  const text = ADMIN_MESSAGES[code]
  if (!text) {
    return null
  }
  return { text, isSuccess: ADMIN_SUCCESS_CODES.has(code) }
}

/**
 * The "People and access" table: one row per person. Allow-list-only
 * entries (no name) and people who have never signed in show as pending.
 */
export function buildAdminUserRows(people) {
  const rows = people.map((person) => {
    const email = person.email ? String(person.email).toLowerCase() : null
    const isBootstrapAdmin = Boolean(email && isBootstrapAdminEmail(email))
    return {
      id: person.id,
      email,
      name: person.name || null,
      role: person.role || null,
      hasProfile: Boolean(person.name),
      pendingActivation: Boolean(email && !person.activatedAt),
      isAdmin: Boolean(person.isAdmin) || isBootstrapAdmin,
      isBootstrapAdmin,
      canManageAdminAccess: Boolean(email && !isBootstrapAdmin)
    }
  })

  rows.sort((a, b) => {
    const aKey = (a.name || a.email || '').toLowerCase()
    const bKey = (b.name || b.email || '').toLowerCase()
    return aKey.localeCompare(bKey)
  })

  return rows
}

/**
 * Checkbox values from Identify managers (name="line_manager", value=person
 * id; legacy lm_<id> keys also accepted) — ported from the prototype.
 */
export function parseLineManagerIdsFromBody(body) {
  const selected = new Set()
  if (!body || typeof body !== 'object') {
    return selected
  }

  const raw = body.line_manager
  if (raw != null && raw !== '') {
    const list = Array.isArray(raw) ? raw : [raw]
    for (const id of list) {
      const trimmed = String(id).trim()
      if (trimmed) {
        selected.add(trimmed)
      }
    }
  }

  for (const [key, val] of Object.entries(body)) {
    if (!key.startsWith('lm_')) {
      continue
    }
    if (val === 'yes' || val === 'on' || val === true) {
      selected.add(key.slice(3))
    }
  }

  return selected
}

export const ADMIN_PROFILE_WIZARD_STEPS = [
  'details',
  'about',
  'can-help',
  'development-goals'
]

export function getWizardStep(step) {
  return ADMIN_PROFILE_WIZARD_STEPS.includes(step) ? step : 'details'
}

export function getPreviousStep(step) {
  const idx = ADMIN_PROFILE_WIZARD_STEPS.indexOf(step)
  return idx > 0 ? ADMIN_PROFILE_WIZARD_STEPS[idx - 1] : null
}

export function getNextStep(step) {
  const idx = ADMIN_PROFILE_WIZARD_STEPS.indexOf(step)
  return idx >= 0 && idx < ADMIN_PROFILE_WIZARD_STEPS.length - 1
    ? ADMIN_PROFILE_WIZARD_STEPS[idx + 1]
    : null
}
