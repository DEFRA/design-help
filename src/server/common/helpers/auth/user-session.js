import { config } from '#/config/config.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'

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
export function buildSessionUser(person) {
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
    isLineManager: Boolean(person.isLineManager)
  }
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

  const refreshed = buildSessionUser(person)
  request.yar.set('user', refreshed)
  return refreshed
}
