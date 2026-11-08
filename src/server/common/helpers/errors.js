import { statusCodes } from '../constants/status-codes.js'

/*
 * Wording follows the GOV.UK Design System error page patterns: a plain
 * heading that says what went wrong (not the status number) and short
 * paragraphs that say what to do next.
 */
const ERROR_PAGES = {
  [statusCodes.notFound]: {
    heading: 'Page not found',
    paragraphs: [
      'If you typed the web address, check it is correct.',
      'If you pasted the web address, check you copied the entire address.'
    ]
  },
  [statusCodes.forbidden]: {
    heading: 'You do not have permission to view this page',
    paragraphs: [
      'If you think you should have access, speak to your line manager or an administrator of Design help.'
    ]
  },
  [statusCodes.unauthorized]: {
    heading: 'You need to sign in to view this page',
    paragraphs: ['Sign in and try again.']
  },
  [statusCodes.badRequest]: {
    heading: 'Sorry, there is a problem with this request',
    paragraphs: ['Go back and try again.']
  }
}

const SERVICE_PROBLEM_PAGE = {
  heading: 'Sorry, there is a problem with the service',
  paragraphs: ['Try again later.']
}

export function errorPageContent(statusCode) {
  return ERROR_PAGES[statusCode] ?? SERVICE_PROBLEM_PAGE
}

export function catchAll(request, h) {
  const { response } = request

  if (!('isBoom' in response)) {
    return h.continue
  }

  const statusCode = response.output.statusCode
  const { heading, paragraphs } = errorPageContent(statusCode)

  if (statusCode >= statusCodes.internalServerError) {
    request.logger.error(response?.stack)
  }

  return h
    .view('error/index', {
      pageTitle: heading,
      heading,
      paragraphs
    })
    .code(statusCode)
}
