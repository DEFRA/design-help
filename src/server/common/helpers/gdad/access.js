import { backendApi } from '#/server/common/helpers/backend-api.js'

/**
 * GDaD reviewer roles, ported from the prototype's management-access lib:
 * - hod: admin + configured Head of Design email + 'Head of Design' job
 *   title (flag computed at session refresh) — may review everyone
 * - line_manager: admin who is a line manager — may review only people
 *   allocated to them
 * - admin: any other admin — may review only people with no allocation
 * - none: everyone else
 */
export function getGdadReviewerRole(user) {
  if (!user?.isAdmin) {
    return 'none'
  }
  if (user.isHeadOfDesignSuperUser) {
    return 'hod'
  }
  if (user.isLineManager) {
    return 'line_manager'
  }
  return 'admin'
}

export function canAccessGdadReviewSection(user) {
  return getGdadReviewerRole(user) !== 'none'
}

/**
 * View and edit scope are deliberately identical, as in the prototype.
 * `target` is a backend person object.
 */
export function canReviewGdadEvidenceForTarget(user, target) {
  const role = getGdadReviewerRole(user)
  if (role === 'hod') {
    return true
  }
  if (role === 'line_manager') {
    return target.managerId === user.id
  }
  if (role === 'admin') {
    return !target.managerId
  }
  return false
}

/** All people the user may review, with profiles, excluding themselves. */
export async function listReviewablePeople(user) {
  const people = await backendApi.listPeople()
  return people.filter(
    (person) =>
      person.name &&
      person.id !== user.id &&
      canReviewGdadEvidenceForTarget(user, person)
  )
}
