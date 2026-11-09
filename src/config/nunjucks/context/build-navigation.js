import { canAccessGdadReviewSection } from '#/server/common/helpers/gdad/access.js'
import { isAccessibilityOnlyRole } from '#/server/common/helpers/gdad/constants.js'

function startsWithAny(path, prefixes) {
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  )
}

/**
 * Primary menu for signed-in people (the layout only shows it when someone
 * is signed in). Each item is "current" for its whole section, so a
 * manager's view of a designer still highlights My team.
 */
const ITEMS = [
  {
    text: 'My team',
    href: '/my-team',
    section: ['/my-team', '/review/gdad-evidence'],
    reviewersOnly: true
  },
  {
    text: 'GDaD',
    href: '/my-gdad-evidence',
    section: ['/my-gdad-evidence'],
    gdadPathOnly: true
  },
  {
    text: 'Find help',
    href: '/find-help',
    section: ['/find-help', '/browse', '/offers', '/requests', '/profile']
  },
  {
    text: 'My profile',
    href: '/my-profile',
    section: ['/my-profile', '/add-profile']
  }
]

export function buildNavigation(request, user = null) {
  const path = request?.path ?? ''
  const isReviewer = canAccessGdadReviewSection(user)
  // A missing job title keeps GDaD in the menu, as before
  const onGdadPath = !isAccessibilityOnlyRole(user?.role)
  return ITEMS.filter(
    (item) =>
      (!item.reviewersOnly || isReviewer) && (!item.gdadPathOnly || onGdadPath)
  ).map((item) => {
    const current = startsWithAny(path, item.section)
    return {
      text: item.text,
      href: item.href,
      current,
      // "page" on the item's own page, "true" elsewhere in its section
      ariaCurrent: current ? (path === item.href ? 'page' : 'true') : null
    }
  })
}
