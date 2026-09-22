import { requestsOffersRoutes } from './controller.js'

export const requestsOffers = {
  plugin: {
    name: 'requests-offers',
    register(server) {
      server.route(requestsOffersRoutes)
    }
  }
}
