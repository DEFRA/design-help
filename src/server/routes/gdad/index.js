import { gdadReferenceRoutes } from './reference-controller.js'
import { gdadEvidenceRoutes } from './evidence-controller.js'
import { gdadReviewRoutes } from './review-controller.js'

export const gdad = {
  plugin: {
    name: 'gdad',
    register(server) {
      server.route([
        ...gdadReferenceRoutes,
        ...gdadEvidenceRoutes,
        ...gdadReviewRoutes
      ])
    }
  }
}
