import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { sendMagicLinkEmail } from '#/server/common/helpers/notify.js'

/*
 * Where people land after signing in. The sign-in link, the session and the
 * backend are all faked, so nobody is really signed in and no live data is
 * touched.
 */
const mockState = { user: null, person: null, people: [] }

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
    listPeople: async () => mockState.people,
    activatePerson: vi.fn()
  }
}))

vi.mock('#/server/common/helpers/notify.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, sendMagicLinkEmail: vi.fn(async () => {}) }
})

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
    mockState.people = []
  })

  test.each([
    ['a designer', {}, '/my-gdad-evidence'],
    ['an admin who is not a manager', { isAdmin: true }, '/my-gdad-evidence'],
    [
      'a line manager with nobody on the GDaD path to review',
      { isLineManager: true },
      '/my-gdad-evidence'
    ]
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

  describe('Job titles not on the GDaD path', () => {
    const managerId = 'a00000000000000000000001'
    const report = (role) => ({
      id: 'b00000000000000000000001',
      name: 'A Report',
      role,
      managerId
    })

    test.each([
      [
        'a resource manager with designers',
        { role: 'Senior Resource Manager', isLineManager: true },
        [report('Service Designer')],
        '/my-team'
      ],
      [
        'an accessibility manager with only accessibility reports',
        {
          role: 'Senior Accessibility Specialist (Grade 7)',
          isLineManager: true
        },
        [report('Accessibility Specialist (SEO)')],
        '/find-help'
      ],
      [
        'an accessibility specialist',
        { role: 'Accessibility Specialist (SEO)' },
        [],
        '/find-help'
      ],
      [
        'a designer who line manages designers',
        { isLineManager: true },
        [report('Interaction Designer')],
        '/my-team'
      ]
    ])(
      'After following the sign-in link, %s lands on %s',
      async (_label, flags, people, location) => {
        mockState.person = person(flags)
        mockState.people = people
        const { headers } = await server.inject({
          method: 'GET',
          url: '/sign-in/verify?token=good-token'
        })
        expect(headers.location).toBe(location)
      }
    )
  })

  test('An expired link does not sign anyone in', async () => {
    mockState.person = person()
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/sign-in/verify?token=bad-token'
    })
    expect(statusCode).toBe(200)
    expect(result).toContain('This sign-in link has expired')
    expect(result).toContain(
      'A link you request yourself expires after 15 minutes.'
    )
    expect(result).toContain(
      'If you were invited by email, your link lasts 7 days.'
    )
  })

  test('Check your email gives the time for a link you requested', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/sign-in/check-email'
    })
    expect(result).toContain(
      'The link works once and expires after 15 minutes.'
    )
    expect(result).not.toContain('7 days')
  })

  test('A wrong email address shows the error with "Error:" in the title', async () => {
    const { result } = await server.inject({
      method: 'POST',
      url: '/sign-in',
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', email: 'not-an-email' }
    })
    expect(result).toMatch(/<title>\s*Error: Sign in \|/)
    expect(result).toContain('href="#email"')
    expect(result).toContain('id="email-error"')
  })

  test('The sign-in page has no "Error:" in the title before submitting', async () => {
    const { result } = await server.inject({ method: 'GET', url: '/sign-in' })
    expect(result).toMatch(/<title>\s*Sign in \|/)
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

  test('An ordinary sign-in link uses the short sign-in time, not the invite time', async () => {
    mockState.person = person()
    const issue = vi
      .spyOn(server.magicLinks, 'issue')
      .mockResolvedValue('a'.repeat(64))
    vi.mocked(sendMagicLinkEmail).mockClear()

    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/sign-in',
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', email: 'someone@example.test' }
    })

    expect(statusCode).toBe(302)
    expect(headers.location).toBe('/sign-in/check-email')
    expect(issue).toHaveBeenCalledWith('someone@example.test')
    expect(config.get('auth.magicLinkTtl')).toBe(15 * 60 * 1000)
    expect(sendMagicLinkEmail).toHaveBeenCalledWith(
      'someone@example.test',
      `${config.get('appBaseUrl')}/sign-in/verify?token=${'a'.repeat(64)}`
    )
    issue.mockRestore()
  })
})
