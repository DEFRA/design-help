import { AVAILABLE_TAGS } from '#/server/common/constants/design-help.js'

export const homeController = {
  handler(_request, h) {
    return h.view('home/index', {
      pageTitle: 'Find design help',
      shortcutTags: AVAILABLE_TAGS
    })
  }
}
