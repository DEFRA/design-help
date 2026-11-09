import { backendApi } from '#/server/common/helpers/backend-api.js'

/**
 * GDaD reviewer roles:
 * - hod: Head of Design super user (admin + configured Head of Design email
 *   + 'Head of Design' job title, flag computed at session refresh) — may
 *   review everyone, including designers with no manager allocated
 * - line_manager: anyone flagged as a line manager, admin or not — may
 *   review only people allocated to them
 * - none: everyone else, including admins who are neither of the above
 */
export function getGdadReviewerRole(user) {
  if (!user) {
    return 'none'
  }
  if (user.isHeadOfDesignSuperUser) {
    return 'hod'
  }
  if (user.isLineManager) {
    return 'line_manager'
  }
  return 'none'
}

/**
 * Who gets My team: the Head of Design, and line managers with at least one
 * report on the GDaD path. A line manager who only manages people outside
 * the GDaD path (for example accessibility specialists) has nothing to
 * review, so gets no My team. `hasGdadReports` is worked out when the
 * session is refreshed; if it is missing we keep the old behaviour and
 * let the line manager in.
 */
export function canAccessGdadReviewSection(user) {
  const role = getGdadReviewerRole(user)
  if (role === 'hod') {
    return true
  }
  return role === 'line_manager' && user.hasGdadReports !== false
}

/**
 * View and edit scope are deliberately identical, as in the prototype.
 * `target` is a backend person object.
 */
export function canReviewGdadEvidenceForTarget(user, target) {
  const role = getGdadReviewerRole(user)
  if (role === 'hod') {
    // Includes the Head of Design self-review special case
    return true
  }
  if (role !== 'line_manager' || target?.id === user.id) {
    return false
  }
  return Boolean(target?.managerId) && target.managerId === user.id
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
