import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

/*
 * Where people land, and the menu they see. The signed-in user and the
 * backend are faked, so no live data is touched.
 */
const mockState = { user: null }

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
    listPeople: async () => [],
    getPerson: async () => null
  }
}))

function sessionUser(flags = {}) {
  return {
    id: 'a00000000000000000000001',
    email: 'someone@example.test',
    name: 'Some One',
    role: 'Interaction Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false,
    ...flags
  }
}

const users = {
  designer: sessionUser(),
  lineManager: sessionUser({ isLineManager: true }),
  headOfDesign: sessionUser({
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  }),
  plainAdmin: sessionUser({ isAdmin: true }),
  resourceManager: sessionUser({
    role: 'Senior Resource Manager',
    isLineManager: true,
    hasGdadReports: true
  }),
  accessibilityManager: sessionUser({
    role: 'Senior Accessibility Specialist (Grade 7)',
    isLineManager: true,
    hasGdadReports: false
  }),
  accessibilitySpecialist: sessionUser({
    role: 'Accessibility Specialist (SEO)'
  })
}

function menuLinks(html) {
  const start = html.indexOf('govuk-service-navigation__list')
  if (start === -1) {
    return []
  }
  const end = html.indexOf('</ul>', start)
  return [
    ...html
      .slice(start, end)
      .matchAll(/<a class="govuk-service-navigation__link" href="([^"]+)"/g)
  ].map((m) => m[1])
}

describe('#homeController', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  async function get(user, url) {
    mockState.user = user
    return server.inject({ method: 'GET', url })
  }

  describe('Signed out', () => {
    test('Shows the home page describing Design help', async () => {
      const { result, statusCode } = await get(null, '/')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('GDaD evidence and help for the design team |')
      expect(result).toContain('GDaD evidence')
      expect(result).toContain('find someone in the team who can help you')
    })

    test('Has no signed-in menu', async () => {
      const { result } = await get(null, '/')
      expect(menuLinks(result)).toEqual([])
      expect(result).not.toContain('href="/my-team"')
    })

    test('Find help needs signing in', async () => {
      const { statusCode, headers } = await get(null, '/find-help')
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/sign-in')
    })
  })

  describe('Signed in, / sends people to where they start', () => {
    test.each([
      ['designer', '/my-gdad-evidence'],
      ['plainAdmin', '/my-gdad-evidence'],
      ['lineManager', '/my-team'],
      ['headOfDesign', '/my-team'],
      ['resourceManager', '/my-team'],
      ['accessibilityManager', '/find-help'],
      ['accessibilitySpecialist', '/find-help']
    ])('%s goes to %s', async (who, location) => {
      const { statusCode, headers } = await get(users[who], '/')
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(location)
    })
  })

  describe('Menu', () => {
    test('Designer: GDaD, Find help, My profile; no Admin', async () => {
      const { result } = await get(users.designer, '/find-help')
      expect(menuLinks(result)).toEqual([
        '/my-gdad-evidence',
        '/find-help',
        '/my-profile'
      ])
      expect(result).not.toContain('href="/admin/users"')
    })

    test('Line manager (not admin): My team first; no Admin', async () => {
      const { result } = await get(users.lineManager, '/find-help')
      expect(menuLinks(result)).toEqual([
        '/my-team',
        '/my-gdad-evidence',
        '/find-help',
        '/my-profile'
      ])
      expect(result).not.toContain('href="/admin/users"')
    })

    test('Head of Design: My team first, plus Admin', async () => {
      const { result } = await get(users.headOfDesign, '/find-help')
      expect(menuLinks(result)).toEqual([
        '/my-team',
        '/my-gdad-evidence',
        '/find-help',
        '/my-profile'
      ])
      expect(result).toContain('href="/admin/users"')
    })

    test('Admin who is not a manager: no My team, plus Admin', async () => {
      const { result } = await get(users.plainAdmin, '/find-help')
      expect(menuLinks(result)).not.toContain('/my-team')
      expect(result).toContain('href="/admin/users"')
    })

    test('Resource manager with designers: My team, no GDaD', async () => {
      const { result } = await get(users.resourceManager, '/find-help')
      expect(menuLinks(result)).toEqual([
        '/my-team',
        '/find-help',
        '/my-profile'
      ])
    })

    test.each(['accessibilityManager', 'accessibilitySpecialist'])(
      '%s: no My team and no GDaD',
      async (who) => {
        const { result } = await get(users[who], '/find-help')
        expect(menuLinks(result)).toEqual(['/find-help', '/my-profile'])
        expect(result).not.toContain('href="/my-gdad-evidence"')
      }
    )

    test('Marks the current item', async () => {
      const { result } = await get(users.designer, '/find-help')
      expect(result).toContain('href="/find-help" aria-current="page"')
      expect(result).not.toContain('href="/my-profile" aria-current')
    })

    test('No old team link in the header', async () => {
      const { result } = await get(users.lineManager, '/find-help')
      expect(result).not.toContain("My team's GDaD evidence")
    })
  })

  describe('Find help page', () => {
    test('Links to the directory, offers and requests', async () => {
      const { result, statusCode } = await get(users.designer, '/find-help')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Find help in the team |')
      expect(result).toContain('href="/browse"')
      expect(result).toContain('href="/offers"')
      expect(result).toContain('href="/requests"')
    })
  })
})
