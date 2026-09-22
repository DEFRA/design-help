export const howItHasBeenBuiltController = {
  handler(_request, h) {
    return h.view('how-it-has-been-built/index', {
      pageTitle: 'How Design help has been built'
    })
  }
}
