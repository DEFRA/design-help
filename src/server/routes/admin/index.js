import { usersRoutes } from './users-controller.js'
import { profileRoutes } from './profile-controller.js'
import { managersRoutes } from './managers-controller.js'

export const admin = {
  plugin: {
    name: 'admin',
    register(server) {
      server.route([...usersRoutes, ...profileRoutes, ...managersRoutes])
    }
  }
}
