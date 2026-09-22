import Boom from '@hapi/boom'

/** Returns a Boom when the signed-in user may not use admin tools. */
export function requireAdmin(request) {
  if (!request.app.user?.isAdmin) {
    return Boom.forbidden('Admin access required')
  }
  return null
}

/** Head of Design super user gate for admin-access and manager tooling. */
export function requireHeadOfDesign(request) {
  const denied = requireAdmin(request)
  if (denied) {
    return denied
  }
  if (!request.app.user.isHeadOfDesignSuperUser) {
    return Boom.forbidden('Head of Design access required')
  }
  return null
}
