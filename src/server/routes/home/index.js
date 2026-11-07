import { findHelpController, homeController } from './controller.js'

/**
 * Sets up the home page (signed-out landing, or a redirect to where a
 * signed-in person starts) and the Find help entry page.
 * These routes are registered in src/server/plugins/router.js.
 */
export const home = {
  plugin: {
    name: 'home',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/',
          ...homeController
        },
        {
          method: 'GET',
          path: '/find-help',
          ...findHelpController
        }
      ])
    }
  }
}
