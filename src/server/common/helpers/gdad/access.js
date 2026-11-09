import { backendApi } from '#/server/common/helpers/backend-api.js'

/**
 * GDaD reviewer roles:
 * - hod: Head of Design super user (admin + configured Head of Design email
 *   + 'Head of Design' job title, flag computed at session refresh) — may
 *   see and score everyone, including designers with no manager allocated.
 *   The Head of Design is head of profession and gives every official score.
 * - line_manager: anyone flagged as a line manager, admin or not — may see
 *   (but not score) only people allocated to them
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
 * Who may SEE a person's GDaD evidence, scores and capability level.
 * Viewing and scoring are deliberately different: line managers may see
 * their direct reports so they can plan improvement together, but only the
 * Head of Design scores (see canScoreGdadEvidenceForTarget).
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

/**
 * Who may GIVE or CHANGE official scores: the Head of Design only, for
 * anyone they may see (including the Head of Design self-review special
 * case). Line managers are view-only. Every page that offers scoring and
 * every route that saves scores must check this.
 */
export function canScoreGdadEvidenceForTarget(user, target) {
  return (
    getGdadReviewerRole(user) === 'hod' &&
    canReviewGdadEvidenceForTarget(user, target)
  )
}

/**
 * All people the user may review, with profiles, excluding themselves.
 * Pass `people` if the full list has already been loaded, to save a
 * second call to the backend.
 */
export async function listReviewablePeople(user, people = null) {
  const everyone = people ?? (await backendApi.listPeople())
  return everyone.filter(
    (person) =>
      person.name &&
      person.id !== user.id &&
      canReviewGdadEvidenceForTarget(user, person)
  )
}
