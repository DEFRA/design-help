import { vi } from 'vitest'

import { catchAll, errorPageContent } from './errors.js'
import { createServer } from '../../server.js'
import { statusCodes } from '../constants/status-codes.js'

describe('#errors', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected Not Found page', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/non-existent-path'
    })

    expect(result).toEqual(
      expect.stringContaining('Page not found | Defra DDTS Design help')
    )
    expect(statusCode).toBe(statusCodes.notFound)
    expect(result).toContain('<h1 class="govuk-heading-xl">Page not found</h1>')
    expect(result).not.toContain('>404<')
    expect(result).toContain(
      '<p class="govuk-body">If you typed the web address, check it is correct.</p>'
    )
  })
})

describe('#catchAll', () => {
  const mockErrorLogger = vi.fn()
  const mockStack = 'Mock error stack'
  const errorPage = 'error/index'
  const mockRequest = (statusCode) => ({
    response: {
      isBoom: true,
      stack: mockStack,
      output: {
        statusCode
      }
    },
    logger: { error: mockErrorLogger }
  })
  const mockToolkitView = vi.fn()
  const mockToolkitCode = vi.fn()
  const mockToolkit = {
    view: mockToolkitView.mockReturnThis(),
    code: mockToolkitCode.mockReturnThis()
  }

  test.each([
    [statusCodes.notFound, 'Page not found'],
    [statusCodes.forbidden, 'You do not have permission to view this page'],
    [statusCodes.unauthorized, 'You need to sign in to view this page'],
    [statusCodes.badRequest, 'Sorry, there is a problem with this request'],
    [statusCodes.imATeapot, 'Sorry, there is a problem with the service']
  ])('Should provide a plain-English page for %s', (statusCode, heading) => {
    catchAll(mockRequest(statusCode), mockToolkit)

    expect(mockErrorLogger).not.toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: heading,
      heading,
      paragraphs: errorPageContent(statusCode).paragraphs
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(statusCode)
  })

  test('Should provide the service problem page and log error for internalServerError', () => {
    catchAll(mockRequest(statusCodes.internalServerError), mockToolkit)

    expect(mockErrorLogger).toHaveBeenCalledWith(mockStack)
    expect(mockToolkitView).toHaveBeenCalledWith(errorPage, {
      pageTitle: 'Sorry, there is a problem with the service',
      heading: 'Sorry, there is a problem with the service',
      paragraphs: ['Try again later.']
    })
    expect(mockToolkitCode).toHaveBeenCalledWith(
      statusCodes.internalServerError
    )
  })
})
