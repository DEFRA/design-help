import { myProfileRoutes } from './controller.js'

export const myProfile = {
  plugin: {
    name: 'my-profile',
    register(server) {
      server.route(myProfileRoutes)
    }
  }
}
