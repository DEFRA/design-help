import { signInRoutes } from './controller.js'

export const signIn = {
  plugin: {
    name: 'sign-in',
    register(server) {
      server.route(signInRoutes)
    }
  }
}
