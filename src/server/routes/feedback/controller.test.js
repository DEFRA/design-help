import { createServer } from '#/server/server.js'

/*
 * Feedback form errors. Nothing is sent: the form fails validation before
 * any email would go out.
 */
describe('#feedbackRoutes', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('The form has no "Error:" in the title before submitting', async () => {
    const { result } = await server.inject({ method: 'GET', url: '/feedback' })
    expect(result).toMatch(/<title>\s*Give feedback \|/)
  })

  test('Missing feedback puts "Error:" at the start of the page title', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/feedback',
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', details: '' }
    })
    expect(statusCode).toBe(400)
    expect(result).toMatch(/<title>\s*Error: Give feedback \|/)
    expect(result).toContain('Enter your feedback')
  })
})
