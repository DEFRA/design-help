import { vi } from 'vitest'

const TEST_CODE = 'test-access-code-123'

vi.mock(import('#/config/config.js'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    config: {
      get(key) {
        if (key === 'auth.devSignInCode') {
          return TEST_CODE
        }
        return originalModule.config.get(key)
      },
      validate() {}
    }
  }
})

const PERSON = {
  id: '64b000000000000000000001',
  email: 'pete.smith@defra.gov.uk',
  name: 'Pete Smith',
  slug: 'pete-smith',
  role: 'Head of Design',
  approved: true,
  isAdmin: false,
  isLineManager: false,
  activatedAt: '2026-01-01T00:00:00.000Z',
  helping: [],
  gdad: {}
}

describe('access-code sign-in', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function getCrumb(url) {
    const response = await server.inject({ method: 'GET', url })
    const setCookie = [response.headers['set-cookie']]
      .flat()
      .find((cookie) => cookie?.startsWith('crumb='))
    const crumb = setCookie.split(';')[0].split('=')[1]
    return { crumb, cookie: `crumb=${crumb}` }
  }

  test('GET renders the access-code form when a code is configured', async () => {
    const { result, statusCode } = await server.inject({
      method: 'GET',
      url: '/sign-in/dev'
    })
    expect(statusCode).toBe(200)
    expect(result).toEqual(expect.stringContaining('Access code'))
  })

  test('rejects a wrong code without consulting the backend', async () => {
    global.fetch = vi.fn()
    const { crumb, cookie } = await getCrumb('/sign-in/dev')
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/sign-in/dev',
      headers: { cookie },
      payload: { crumb, email: PERSON.email, code: 'wrong-code' }
    })
    expect(statusCode).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('signs in an approved person with the right code', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PERSON), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    const { crumb, cookie } = await getCrumb('/sign-in/dev')
    const response = await server.inject({
      method: 'POST',
      url: '/sign-in/dev',
      headers: { cookie },
      payload: { crumb, email: PERSON.email, code: TEST_CODE }
    })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/browse')
  })

  test('rejects an unknown or unapproved email even with the right code', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    const { crumb, cookie } = await getCrumb('/sign-in/dev')
    const { statusCode } = await server.inject({
      method: 'POST',
      url: '/sign-in/dev',
      headers: { cookie },
      payload: { crumb, email: 'nobody@defra.gov.uk', code: TEST_CODE }
    })
    expect(statusCode).toBe(400)
  })
})
