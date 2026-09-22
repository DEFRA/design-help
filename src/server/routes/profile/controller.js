import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'

export const profileController = {
  async handler(request, h) {
    const person = await backendApi.getPerson(request.params.idOrSlug)
    if (!person || !person.name) {
      return Boom.notFound()
    }

    return h.view('profile/index', {
      pageTitle: person.name,
      member: {
        ...person,
        displayEmail: person.email ?? person.contactEmail,
        firstName: String(person.name).split(' ')[0]
      },
      isOwnProfile: person.id === request.app.user?.id
    })
  }
}
