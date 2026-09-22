import { browseController } from './controller.js'

export const browse = {
  plugin: {
    name: 'browse',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/browse',
          ...browseController
        }
      ])
    }
  }
}
