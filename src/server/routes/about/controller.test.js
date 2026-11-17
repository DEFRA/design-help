import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

describe('#aboutController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should provide expected response', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/about'
    })

    expect(result).toEqual(expect.stringContaining('About Design help |'))
    expect(statusCode).toBe(statusCodes.ok)
  })

  test('Should describe the GDaD purpose and who can see evidence', async () => {
    const { result } = await server.inject({ method: 'GET', url: '/about' })

    expect(result).toContain('GDaD')
    expect(result).toContain(
      'href="https://understand-digital-data-roles-skills.service.gov.uk"'
    )
    expect(result).toContain('Who can see your evidence')
    expect(result).toContain('The GDaD year')
    expect(result).toContain('Find help')
    expect(result).toContain('href="/how-it-has-been-built"')
    expect(result).not.toContain('User need')
  })
})
