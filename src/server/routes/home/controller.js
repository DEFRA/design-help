import { AVAILABLE_TAGS } from '#/server/common/constants/design-help.js'
import { getLandingPath } from '#/server/common/helpers/auth/landing-path.js'

export const homeController = {
  handler(request, h) {
    if (request.app.user) {
      return h.redirect(getLandingPath(request.app.user))
    }
    return h.view('home/index', {
      pageTitle: 'GDaD evidence and help for the design team'
    })
  }
}

export const findHelpController = {
  handler(_request, h) {
    return h.view('home/find-help', {
      pageTitle: 'Find help in the team',
      shortcutTags: AVAILABLE_TAGS
    })
  }
}
