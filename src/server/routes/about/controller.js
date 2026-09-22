export const aboutController = {
  handler(_request, h) {
    return h.view('about/index', {
      pageTitle: 'About Design help'
    })
  }
}
