import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

describe('#howItHasBeenBuiltController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  test('Should describe the current AI tools and security position', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/how-it-has-been-built'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toContain('How Design help has been built |')
    expect(result).toContain('How we used AI to write the code')
    expect(result).toContain('Claude Code')
    expect(result).toContain('data protection impact assessment')
    expect(result).not.toContain('security risk is relatively low')
    expect(result).not.toContain('internal design community')
  })
})
