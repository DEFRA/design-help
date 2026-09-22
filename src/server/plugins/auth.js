import crumb from '@hapi/crumb'

import { config } from '#/config/config.js'
import { createMagicLinkStore } from '#/server/common/helpers/auth/magic-link.js'
import { refreshSessionUser } from '#/server/common/helpers/auth/user-session.js'

/**
 * Keep in step with the footer links in layouts/page.njk — those pages must
 * stay reachable without signing in.
 */
const PUBLIC_EXACT = new Set([
  '/',
  '/about',
  '/how-it-has-been-built',
  '/health'
])
const PUBLIC_PREFIX = ['/sign-in', '/feedback', '/gdad-reference', '/public']

export function isAllowedWithoutAuthentication(path) {
  return (
    PUBLIC_EXACT.has(path) ||
    PUBLIC_PREFIX.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`)
    )
  )
}

export const auth = {
  plugin: {
    name: 'auth',
    async register(server) {
      await server.register({
        plugin: crumb,
        options: {
          cookieOptions: {
            isSecure: config.get('session.cookie.secure')
          }
        }
      })

      const magicLinkCache = server.cache({
        cache: config.get('session.cache.name'),
        segment: 'magic-links',
        expiresIn: config.get('auth.magicLinkTtl')
      })
      server.decorate(
        'server',
        'magicLinks',
        createMagicLinkStore(magicLinkCache)
      )

      server.ext('onPreHandler', async (request, h) => {
        // Static assets and the platform health check never need a session
        if (
          request.path === '/health' ||
          request.path === '/favicon.ico' ||
          request.path.startsWith('/public/')
        ) {
          return h.continue
        }

        const user = await refreshSessionUser(request)
        request.app.user = user

        if (!user && !isAllowedWithoutAuthentication(request.path)) {
          return h.redirect('/sign-in').takeover()
        }
        return h.continue
      })
    }
  }
}
