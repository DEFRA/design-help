import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'

/*
 * Route-level checks of who may use the GDaD review pages. The signed-in
 * user and the backend are both faked, so no live data is touched.
 */
const mockState = { user: null, people: [] }

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
    listPeople: async () => mockState.people,
    getPerson: async (id) =>
      mockState.people.find((person) => person.id === id) ?? null,
    saveGdadScores: vi.fn()
  }
}))

const ids = {
  hod: 'a00000000000000000000001',
  manager: 'a00000000000000000000002',
  otherManager: 'a00000000000000000000003',
  admin: 'a00000000000000000000004',
  designer: 'a00000000000000000000005',
  adminManager: 'a00000000000000000000006',
  adminManagersReport: 'b00000000000000000000004',
  ownReport: 'b00000000000000000000001',
  otherReport: 'b00000000000000000000002',
  unallocated: 'b00000000000000000000003'
}

function sessionUser(id, flags = {}) {
  return {
    id,
    email: `${id}@example.test`,
    name: `User ${id}`,
    role: 'Interaction Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false,
    ...flags
  }
}

const users = {
  hod: sessionUser(ids.hod, {
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  }),
  manager: sessionUser(ids.manager, { isLineManager: true }),
  admin: sessionUser(ids.admin, { isAdmin: true }),
  designer: sessionUser(ids.designer),
  adminManager: sessionUser(ids.adminManager, {
    isAdmin: true,
    isLineManager: true
  })
}

const people = [
  {
    id: ids.ownReport,
    name: 'Ada Own-Report',
    role: 'Interaction Designer',
    managerId: ids.manager,
    gdad: {}
  },
  {
    id: ids.otherReport,
    name: 'Bea Other-Report',
    role: 'Service Designer',
    managerId: ids.otherManager,
    gdad: {}
  },
  {
    id: ids.unallocated,
    name: 'Cy Unallocated',
    role: 'Interaction Designer',
    managerId: null,
    gdad: {}
  },
  {
    id: ids.manager,
    name: 'Manager Themselves',
    role: 'Senior Interaction Designer',
    managerId: ids.manager,
    gdad: {}
  },
  {
    id: ids.hod,
    name: 'Head Of Design Themselves',
    role: 'Head of Design',
    managerId: null,
    gdad: {}
  },
  {
    id: ids.adminManagersReport,
    name: 'Dee Admin-Managers-Report',
    role: 'Service Designer',
    managerId: ids.adminManager,
    gdad: {}
  }
]

const personUrl = (id) => `/review/gdad-evidence/${id}`
const skillUrl = (id) => `/review/gdad-evidence/${id}/design_communication`

describe('#gdadReviewRoutes access', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    mockState.people = people
  })

  async function get(user, url) {
    mockState.user = user
    return server.inject({ method: 'GET', url })
  }

  // Forms are protected by crumb: the form field must match the cookie
  async function post(user, url, payload) {
    mockState.user = user
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', ...payload }
    })
  }

  const scorePayload = { score_design_communication: '2' }
  const saveRoutes = [
    { name: 'whole-person save', url: personUrl },
    { name: 'single-skill save', url: skillUrl }
  ]

  describe('Non-admin line manager', () => {
    test('Sees only their own report on the review list', async () => {
      const { statusCode, result } = await get(
        users.manager,
        '/review/gdad-evidence'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Ada Own-Report')
      expect(result).not.toContain('Bea Other-Report')
      expect(result).not.toContain('Cy Unallocated')
      expect(result).not.toContain('Manager Themselves')
    })

    test('Gets the team link in the header but not the Admin link', async () => {
      const { result } = await get(users.manager, '/review/gdad-evidence')
      expect(result).toContain("My team's GDaD evidence")
      expect(result).not.toContain('href="/admin/users"')
    })

    test('May open their own report', async () => {
      expect(
        (await get(users.manager, personUrl(ids.ownReport))).statusCode
      ).toBe(statusCodes.ok)
    })

    test('Is refused for someone else’s report and unallocated people', async () => {
      for (const id of [ids.otherReport, ids.unallocated]) {
        expect((await get(users.manager, personUrl(id))).statusCode).toBe(
          statusCodes.forbidden
        )
        expect((await get(users.manager, skillUrl(id))).statusCode).toBe(
          statusCodes.forbidden
        )
      }
    })

    test('Cannot review themselves', async () => {
      expect(
        (await get(users.manager, personUrl(ids.manager))).statusCode
      ).toBe(statusCodes.forbidden)
    })

    test('CSV export contains only their own report', async () => {
      const { statusCode, result } = await get(
        users.manager,
        '/review/gdad-evidence/export.csv'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Ada Own-Report')
      expect(result).not.toContain('Bea Other-Report')
      expect(result).not.toContain('Cy Unallocated')
    })

    test('CSV export has a neutral file name', async () => {
      const { headers } = await get(
        users.manager,
        '/review/gdad-evidence/export.csv'
      )
      expect(headers['content-disposition']).toContain('GDaD-scores-export.csv')
    })

    test('Still cannot open admin pages', async () => {
      expect((await get(users.manager, '/admin/users')).statusCode).toBe(
        statusCodes.forbidden
      )
    })
  })

  describe('Admin who is not Head of Design or a line manager', () => {
    test('Is refused on every review route', async () => {
      for (const url of [
        '/review/gdad-evidence',
        '/review/gdad-evidence/export.csv',
        personUrl(ids.unallocated),
        skillUrl(ids.unallocated)
      ]) {
        expect((await get(users.admin, url)).statusCode).toBe(
          statusCodes.forbidden
        )
      }
    })
  })

  describe('Non-manager non-admin', () => {
    test('Is refused on every review route', async () => {
      for (const url of [
        '/review/gdad-evidence',
        '/review/gdad-evidence/export.csv',
        personUrl(ids.ownReport)
      ]) {
        expect((await get(users.designer, url)).statusCode).toBe(
          statusCodes.forbidden
        )
      }
    })
  })

  describe('Head of Design', () => {
    test('Sees everyone, including unallocated designers', async () => {
      const { statusCode, result } = await get(
        users.hod,
        '/review/gdad-evidence'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Ada Own-Report')
      expect(result).toContain('Bea Other-Report')
      expect(result).toContain('Cy Unallocated')
    })

    test('May open anyone, including unallocated designers', async () => {
      for (const id of [ids.ownReport, ids.otherReport, ids.unallocated]) {
        expect((await get(users.hod, personUrl(id))).statusCode).toBe(
          statusCodes.ok
        )
      }
    })

    test('Keeps the Head of Design self-review special case', async () => {
      expect((await get(users.hod, personUrl(ids.hod))).statusCode).toBe(
        statusCodes.ok
      )
    })

    test('CSV export includes everyone', async () => {
      const { result } = await get(
        users.hod,
        '/review/gdad-evidence/export.csv'
      )
      expect(result).toContain('Cy Unallocated')
      expect(result).toContain('Bea Other-Report')
    })
  })

  describe('Admin who is also a line manager', () => {
    test('Sees only their own report, with the Admin menu', async () => {
      const { statusCode, result } = await get(
        users.adminManager,
        '/review/gdad-evidence'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Dee Admin-Managers-Report')
      expect(result).not.toContain('Ada Own-Report')
      expect(result).not.toContain('Cy Unallocated')
      expect(result).toContain('href="/admin/users"')
      expect(result).toContain('aria-label="Admin tools"')
    })

    test('May open their own report only', async () => {
      expect(
        (await get(users.adminManager, personUrl(ids.adminManagersReport)))
          .statusCode
      ).toBe(statusCodes.ok)
      for (const id of [ids.ownReport, ids.unallocated]) {
        expect((await get(users.adminManager, personUrl(id))).statusCode).toBe(
          statusCodes.forbidden
        )
      }
    })
  })

  describe.each(saveRoutes)('Saving scores ($name)', ({ url }) => {
    test.each([
      ['line manager, another manager’s report', 'manager', ids.otherReport],
      ['line manager, unallocated person', 'manager', ids.unallocated],
      ['plain admin, unallocated person', 'admin', ids.unallocated],
      ['plain admin, allocated person', 'admin', ids.ownReport],
      ['non-manager non-admin', 'designer', ids.ownReport]
    ])('Refused for %s', async (_label, who, id) => {
      const { statusCode } = await post(users[who], url(id), scorePayload)
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test.each([
      ['line manager, own report', 'manager', ids.ownReport],
      [
        'admin line manager, own report',
        'adminManager',
        ids.adminManagersReport
      ],
      ['Head of Design, unallocated person', 'hod', ids.unallocated],
      ['Head of Design, another manager’s report', 'hod', ids.otherReport]
    ])('Allowed for %s', async (_label, who, id) => {
      const { statusCode, headers } = await post(
        users[who],
        url(id),
        scorePayload
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toContain('saved=1')
      expect(backendApi.saveGdadScores).toHaveBeenCalledTimes(1)
      const [savedId, scores, reviewerId] =
        backendApi.saveGdadScores.mock.calls[0]
      expect(savedId).toBe(id)
      expect(scores.design_communication).toBe(2)
      expect(reviewerId).toBe(users[who].id)
    })
  })
})
