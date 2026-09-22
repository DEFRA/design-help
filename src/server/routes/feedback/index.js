import { feedbackRoutes } from './controller.js'

export const feedback = {
  plugin: {
    name: 'feedback',
    register(server) {
      server.route(feedbackRoutes)
    }
  }
}
