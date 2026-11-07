import { vi } from 'vitest'

import { createServer } from '#/server/server.js'

/*
 * Where people land after signing in. The sign-in link, the session and the
 * backend are all faked, so nobody is really signed in and no live data is
 * touched.
 */
const mockState = { user: null, person: null }

vi.mock(
  '#/server/common/helpers/auth/user-session.js',
  async (importOriginal) => {
    const original = await importOriginal()
    return {
      ...original,
      refreshSessionUser: async (request) => {
        if (mockState.user) {
          request.yar.set('user', mockState.user)
        }
        return mockState.user
      }
    }
  }
)

vi.mock('#/server/common/helpers/backend-api.js', () => ({
  backendApi: {
    getPersonByEmail: async () => mockState.person,
    activatePerson: vi.fn()
  }
}))

function person(flags = {}) {
  return {
    id: 'a00000000000000000000001',
    email: 'someone@example.test',
    name: 'Some One',
    role: 'Interaction Designer',
    approved: true,
    activatedAt: '2026-01-01T00:00:00.000Z',
    isAdmin: false,
    isLineManager: false,
    ...flags
  }
}

describe('#signInRoutes landing', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
    server.magicLinks.consume = async (token) =>
      token === 'good-token' ? mockState.person?.email : null
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    mockState.user = null
  })

  test.each([
    ['a designer', {}, '/my-gdad-evidence'],
    ['an admin who is not a manager', { isAdmin: true }, '/my-gdad-evidence'],
    ['a line manager', { isLineManager: true }, '/my-team']
  ])(
    'After following the sign-in link, %s lands on %s',
    async (_label, flags, location) => {
      mockState.person = person(flags)
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/sign-in/verify?token=good-token'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(location)
    }
  )

  test('An expired link does not sign anyone in', async () => {
    mockState.person = person()
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/sign-in/verify?token=bad-token'
    })
    expect(statusCode).toBe(200)
    expect(result).toContain('This sign-in link has expired')
  })

  test.each([
    ['designer', { isLineManager: false }, '/my-gdad-evidence'],
    ['line manager', { isLineManager: true }, '/my-team']
  ])(
    'An already signed-in %s visiting sign in goes to %s',
    async (_label, flags, location) => {
      mockState.user = { ...person(flags), isHeadOfDesignSuperUser: false }
      const { statusCode, headers } = await server.inject({
        method: 'GET',
        url: '/sign-in'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(location)
    }
  )
})
