import { FRAMEWORK_BASE } from '#/server/common/helpers/gdad/constants.js'

export const aboutController = {
  handler(_request, h) {
    return h.view('about/index', {
      pageTitle: 'About Design help',
      frameworkUrl: FRAMEWORK_BASE
    })
  }
}
