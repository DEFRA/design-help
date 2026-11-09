import { config } from '#/config/config.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { isGdadEvidenceApplicableRole } from '#/server/common/helpers/gdad/constants.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

function parseEmailList(value) {
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
}

export function getBootstrapAdminEmails() {
  return parseEmailList(config.get('auth.adminEmails'))
}

export function getHeadOfDesignEmails() {
  return parseEmailList(config.get('auth.headOfDesignEmails'))
}

export function isBootstrapAdminEmail(email) {
  return getBootstrapAdminEmails().includes(String(email).toLowerCase())
}

/**
 * The session user is a snapshot of the backend person plus derived access
 * flags, refreshed on every guarded request so admin grants, role changes
 * and line-manager updates take effect without re-signing-in.
 */
export function buildSessionUser(person, { hasGdadReports } = {}) {
  const email = person.email
  const isAdmin = Boolean(person.isAdmin) || isBootstrapAdminEmail(email)
  const isHeadOfDesignSuperUser =
    isAdmin &&
    getHeadOfDesignEmails().includes(email) &&
    person.role === 'Head of Design'

  return {
    id: person.id,
    email,
    name: person.name,
    slug: person.slug,
    role: person.role,
    isAdmin,
    isHeadOfDesignSuperUser,
    isLineManager: Boolean(person.isLineManager),
    // Only set for line managers: whether anyone they manage is on the
    // GDaD path. Left out when unknown, which keeps today's behaviour.
    ...(typeof hasGdadReports === 'boolean' ? { hasGdadReports } : {})
  }
}

/**
 * True when a line manager has at least one report whose job title is on
 * the GDaD path; undefined for anyone else, or if the people list cannot
 * be read (so a backend hiccup never hides My team from a real manager).
 * Worked out afresh each time, so a manager who is given a designer later
 * gets My team straight away.
 */
export async function findHasGdadReports(person) {
  if (!person?.isLineManager) {
    return undefined
  }
  try {
    const people = await backendApi.listPeople()
    return (people ?? []).some(
      (report) =>
        report.managerId === person.id &&
        report.id !== person.id &&
        report.name &&
        isGdadEvidenceApplicableRole(report.role)
    )
  } catch (error) {
    logger.error(
      error,
      'Could not check whether a line manager has GDaD reports'
    )
    return undefined
  }
}

/** The session user plus the My team check, for sign-in and each request. */
export async function loadSessionUser(person) {
  return buildSessionUser(person, {
    hasGdadReports: await findHasGdadReports(person)
  })
}

export async function refreshSessionUser(request) {
  let sessionUser
  try {
    sessionUser = request.yar.get('user')
  } catch {
    return null
  }
  if (!sessionUser?.email) {
    return null
  }

  const person = await backendApi.getPersonByEmail(sessionUser.email)
  if (!person || !person.approved) {
    request.yar.clear('user')
    return null
  }

  const refreshed = await loadSessionUser(person)
  request.yar.set('user', refreshed)
  return refreshed
}
