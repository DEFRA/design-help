import { canAccessGdadReviewSection } from '#/server/common/helpers/gdad/access.js'
import { isAccessibilityOnlyRole } from '#/server/common/helpers/gdad/constants.js'

/**
 * Where a signed-in person starts: people with a team to review (and the
 * Head of Design) on My team; people whose job title is not on the GDaD
 * path on Find help; everyone else on their own GDaD evidence.
 */
export function getLandingPath(user) {
  if (canAccessGdadReviewSection(user)) {
    return '/my-team'
  }
  if (isAccessibilityOnlyRole(user?.role)) {
    return '/find-help'
  }
  return '/my-gdad-evidence'
}
