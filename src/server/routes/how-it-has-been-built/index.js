import { howItHasBeenBuiltController } from './controller.js'

export const howItHasBeenBuilt = {
  plugin: {
    name: 'how-it-has-been-built',
    register(server) {
      server.route([
        {
          method: 'GET',
          path: '/how-it-has-been-built',
          ...howItHasBeenBuiltController
        }
      ])
    }
  }
}
