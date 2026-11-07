import { canAccessGdadReviewSection } from '#/server/common/helpers/gdad/access.js'

/**
 * Where a signed-in person starts: managers and the Head of Design on My
 * team, everyone else on their own GDaD evidence.
 */
export function getLandingPath(user) {
  return canAccessGdadReviewSection(user) ? '/my-team' : '/my-gdad-evidence'
}
