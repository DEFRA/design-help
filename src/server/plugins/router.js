import inert from '@hapi/inert'

import { home } from '../routes/home/index.js'
import { about } from '../routes/about/index.js'
import { howItHasBeenBuilt } from '../routes/how-it-has-been-built/index.js'
import { signIn } from '../routes/sign-in/index.js'
import { browse } from '../routes/browse/index.js'
import { profile } from '../routes/profile/index.js'
import { myProfile } from '../routes/my-profile/index.js'
import { requestsOffers } from '../routes/requests-offers/index.js'
import { feedback } from '../routes/feedback/index.js'
import { admin } from '../routes/admin/index.js'
import { gdad } from '../routes/gdad/index.js'
import { health } from '../routes/health/index.js'
import { serveStaticFiles } from './serve-static-files.js'
import { config } from '#/config/config.js'

export const router = {
  plugin: {
    name: 'router',
    async register(server) {
      await server.register([inert])

      // Health-check route. Used by platform to check if service is running, do not remove!
      await server.register([health])

      // Application specific routes, add your own routes here
      await server.register([
        home,
        about,
        howItHasBeenBuilt,
        signIn,
        browse,
        profile,
        myProfile,
        requestsOffers,
        feedback,
        admin,
        gdad
      ])

      // Static assets
      if (!config.get('isProduction') && !config.get('isTest')) {
        await (async () => {
          const createViteServer = (await import('vite')).createServer
          const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'custom'
          })

          await server.register({
            plugin: (await import('@defra/hapi-connect')).default,
            options: {
              path: '/public',
              middleware: [vite.middlewares]
            }
          })
        })()
      } else {
        server.register(serveStaticFiles)
      }
    }
  }
}
