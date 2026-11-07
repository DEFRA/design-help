import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'

/*
 * The one-page "Set up a team member" form. The signed-in user and the
 * backend are both faked, so no live data is touched.
 */
const mockState = { user: null, people: [] }

vi.mock(
  '#/server/common/helpers/auth/user-session.js',
  async (importOriginal) => {
    const original = await importOriginal()
    return {
      ...original,
      getHeadOfDesignEmails: () => ['hod@defra.gov.uk'],
      refreshSessionUser: async (request) => {
        if (mockState.user) {
          request.yar.set('user', mockState.user)
        }
        return mockState.user
      }
    }
  }
)

vi.mock('#/server/common/helpers/backend-api.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    BackendApiError: original.BackendApiError,
    backendApi: {
      listPeople: vi.fn(async () => mockState.people),
      getPerson: vi.fn(
        async (idOrSlug) =>
          mockState.people.find(
            (person) => person.id === idOrSlug || person.slug === idOrSlug
          ) ?? null
      ),
      getPersonByEmail: vi.fn(
        async (email) =>
          mockState.people.find((person) => person.email === email) ?? null
      ),
      createPerson: vi.fn(),
      updatePerson: vi.fn(),
      replaceLineManagers: vi.fn(),
      setManager: vi.fn(),
      listHelpingPairs: vi.fn(async () => [])
    }
  }
})

const ids = {
  hod: 'a00000000000000000000001',
  admin: 'a00000000000000000000002',
  designer: 'a00000000000000000000003',
  managerA: 'a00000000000000000000004',
  managerB: 'a00000000000000000000005',
  report: 'b00000000000000000000001',
  pending: 'b00000000000000000000002',
  created: 'c00000000000000000000001'
}

function sessionUser(id, flags = {}) {
  return {
    id,
    email: `${id}@defra.gov.uk`,
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
    email: 'hod@defra.gov.uk',
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  }),
  admin: sessionUser(ids.admin, { isAdmin: true }),
  designer: sessionUser(ids.designer)
}

function person(id, fields = {}) {
  return {
    id,
    slug: null,
    email: `${id}@defra.gov.uk`,
    name: null,
    role: null,
    location: null,
    experience: null,
    bio: null,
    canHelpWith: [],
    canHelpWithText: null,
    developmentGoalsText: null,
    projectTeam: null,
    deliveryGroup: null,
    linkedinProfile: null,
    availabilityStatus: 'Some capacity',
    isAdmin: false,
    isLineManager: false,
    managerId: null,
    helping: [],
    gdad: {},
    activatedAt: null,
    ...fields
  }
}

function buildPeople() {
  return [
    person(ids.hod, {
      email: 'hod@defra.gov.uk',
      name: 'Pat Head',
      slug: 'pat-head',
      role: 'Head of Design',
      isAdmin: true,
      isLineManager: true,
      activatedAt: '2026-01-01T00:00:00.000Z'
    }),
    person(ids.managerA, {
      name: 'Alex Manager',
      slug: 'alex-manager',
      role: 'Design Manager',
      isLineManager: true,
      managerId: ids.hod
    }),
    person(ids.managerB, {
      name: 'Bo Manager',
      slug: 'bo-manager',
      role: 'Design Manager',
      isLineManager: true
    }),
    person(ids.report, {
      name: 'Rae Report',
      slug: 'rae-report',
      role: 'Interaction Designer',
      managerId: ids.managerA
    }),
    // Allow-list only: email, nothing else yet
    person(ids.pending, { email: 'pending@defra.gov.uk' })
  ]
}

const validNew = {
  name: 'Nia New',
  email: 'Nia.New@defra.gov.uk',
  role: 'Service Designer',
  managerId: ids.managerA
}

describe('#teamMemberRoutes', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockState.people = buildPeople()
    backendApi.createPerson.mockImplementation(async (payload) =>
      person(ids.created, payload)
    )
    backendApi.updatePerson.mockImplementation(async (id, payload) => ({
      ...mockState.people.find((p) => p.id === id),
      ...payload
    }))
  })

  async function get(user, url) {
    mockState.user = user
    return server.inject({ method: 'GET', url })
  }

  async function post(user, url, payload) {
    mockState.user = user
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', ...payload }
    })
  }

  describe('Access', () => {
    const urls = ['/admin/team-member/new', `/admin/team-member/${ids.report}`]

    test.each([
      ['non-Head-of-Design admin', 'admin'],
      ['non-admin', 'designer']
    ])('%s gets 403 on GET and POST', async (_label, key) => {
      for (const url of urls) {
        expect((await get(users[key], url)).statusCode).toBe(
          statusCodes.forbidden
        )
        expect((await post(users[key], url, validNew)).statusCode).toBe(
          statusCodes.forbidden
        )
      }
      expect(backendApi.createPerson).not.toHaveBeenCalled()
      expect(backendApi.updatePerson).not.toHaveBeenCalled()
      expect(backendApi.replaceLineManagers).not.toHaveBeenCalled()
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })

    test('Head of Design can open both forms', async () => {
      for (const url of urls) {
        expect((await get(users.hod, url)).statusCode).toBe(statusCodes.ok)
      }
    })

    test('Unknown person is a 404', async () => {
      const { statusCode } = await get(
        users.hod,
        '/admin/team-member/ffffffffffffffffffffffff'
      )
      expect(statusCode).toBe(statusCodes.notFound)
    })
  })

  describe('Add form', () => {
    test('Lists only line managers, plus "No manager yet"', async () => {
      const { result } = await get(users.hod, '/admin/team-member/new')
      expect(result).toContain('No manager yet')
      expect(result).toContain(`value="${ids.managerA}"`)
      expect(result).toContain(`value="${ids.managerB}"`)
      expect(result).toContain(`value="${ids.hod}"`)
      expect(result).not.toContain(`value="${ids.report}"`)
      expect(result).toContain('This person manages other designers')
      expect(result).toContain('name="crumb"')
      expect(result).not.toContain('style=')
    })

    test('Creates the person with only the set-up fields and allocates the manager', async () => {
      const { statusCode, headers } = await post(
        users.hod,
        '/admin/team-member/new',
        validNew
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `/admin/users?saved=created&person=${ids.created}`
      )
      expect(backendApi.createPerson).toHaveBeenCalledWith({
        email: 'nia.new@defra.gov.uk',
        name: 'Nia New',
        role: 'Service Designer'
      })
      expect(backendApi.replaceLineManagers).not.toHaveBeenCalled()
      expect(backendApi.setManager).toHaveBeenCalledWith(
        ids.created,
        ids.managerA
      )
    })

    test('Ticking "manages other designers" adds them to the existing line-manager set', async () => {
      await post(users.hod, '/admin/team-member/new', {
        ...validNew,
        managerId: '',
        isLineManager: 'yes'
      })
      const [setIds] = backendApi.replaceLineManagers.mock.calls[0]
      expect([...setIds].sort()).toEqual(
        [ids.hod, ids.managerA, ids.managerB, ids.created].sort()
      )
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })

    test('Missing name, non-Defra email and missing job title show inline errors and keep input', async () => {
      const { statusCode, result } = await post(
        users.hod,
        '/admin/team-member/new',
        { name: '', email: 'someone@gmail.com', role: '', managerId: '' }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain('href="#name"')
      expect(result).toContain('Enter their full name')
      expect(result).toContain('href="#email"')
      expect(result).toContain('ending in @defra.gov.uk')
      expect(result).toContain('Select their job title')
      expect(result).toContain('value="someone@gmail.com"')
      expect(result).toContain('govuk-error-message')
      expect(result).toContain('Error: Set up a team member |')
      expect(backendApi.createPerson).not.toHaveBeenCalled()
    })

    test('Missing email is an error', async () => {
      const { result } = await post(users.hod, '/admin/team-member/new', {
        ...validNew,
        email: ''
      })
      expect(result).toContain('Enter their Defra email address')
      expect(backendApi.createPerson).not.toHaveBeenCalled()
    })

    test('Someone who is not a line manager cannot be chosen as manager', async () => {
      const { statusCode, result } = await post(
        users.hod,
        '/admin/team-member/new',
        { ...validNew, managerId: ids.report }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('href="#managerId"')
      expect(backendApi.createPerson).not.toHaveBeenCalled()
    })

    test('Head of Design job title is reserved', async () => {
      const { statusCode, result } = await post(
        users.hod,
        '/admin/team-member/new',
        { ...validNew, role: 'Head of Design' }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('reserved for the Head of Design')
    })

    test('Duplicate email (409) shows a friendly message and a link to change them', async () => {
      backendApi.createPerson.mockRejectedValueOnce(
        new BackendApiError(409, 'duplicate_email')
      )
      const { statusCode, result } = await post(
        users.hod,
        '/admin/team-member/new',
        { ...validNew, email: 'pending@defra.gov.uk' }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('That email address is already on the list')
      expect(result).toContain(`href="/admin/team-member/${ids.pending}"`)
      expect(result).toContain('value="Nia New"')
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })
  })

  describe('Change form', () => {
    test('Prefills their details and never offers them as their own manager', async () => {
      const { result } = await get(
        users.hod,
        `/admin/team-member/${ids.managerA}`
      )
      expect(result).toContain('value="Alex Manager"')
      expect(result).toContain(`value="${ids.managerB}"`)
      expect(result).not.toContain(`value="${ids.managerA}"`)
      expect(result).toMatch(new RegExp(`value="${ids.hod}" selected`))
      expect(result).toContain('This person manages 1 person')
    })

    test('Updates name, email and title, and changes the manager', async () => {
      const { statusCode, headers } = await post(
        users.hod,
        `/admin/team-member/${ids.report}`,
        {
          name: 'Rae Renamed',
          email: 'rae.new@defra.gov.uk',
          role: 'Senior Interaction Designer',
          managerId: ids.managerB
        }
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `/admin/users?saved=updated&person=${ids.report}`
      )
      expect(backendApi.updatePerson).toHaveBeenCalledWith(ids.report, {
        name: 'Rae Renamed',
        role: 'Senior Interaction Designer',
        email: 'rae.new@defra.gov.uk'
      })
      expect(backendApi.setManager).toHaveBeenCalledWith(
        ids.report,
        ids.managerB
      )
      expect(backendApi.replaceLineManagers).not.toHaveBeenCalled()
    })

    test('Unchanged email is not resent; "No manager yet" clears the allocation', async () => {
      await post(users.hod, `/admin/team-member/${ids.report}`, {
        name: 'Rae Report',
        email: `${ids.report}@defra.gov.uk`,
        role: 'Interaction Designer',
        managerId: ''
      })
      expect(backendApi.updatePerson).toHaveBeenCalledWith(ids.report, {
        name: 'Rae Report',
        role: 'Interaction Designer'
      })
      expect(backendApi.setManager).toHaveBeenCalledWith(ids.report, null)
    })

    test('Unticking "manages other designers" removes only them from the set', async () => {
      await post(users.hod, `/admin/team-member/${ids.managerA}`, {
        name: 'Alex Manager',
        email: `${ids.managerA}@defra.gov.uk`,
        role: 'Design Manager',
        managerId: ids.hod
      })
      const [setIds] = backendApi.replaceLineManagers.mock.calls[0]
      expect([...setIds].sort()).toEqual([ids.hod, ids.managerB].sort())
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })

    test('Ticking it for a designer adds them without disturbing others', async () => {
      await post(users.hod, `/admin/team-member/${ids.report}`, {
        name: 'Rae Report',
        email: `${ids.report}@defra.gov.uk`,
        role: 'Interaction Designer',
        managerId: ids.managerA,
        isLineManager: 'yes'
      })
      const [setIds] = backendApi.replaceLineManagers.mock.calls[0]
      expect([...setIds].sort()).toEqual(
        [ids.hod, ids.managerA, ids.managerB, ids.report].sort()
      )
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })

    test('A person cannot be their own manager', async () => {
      const { statusCode, result } = await post(
        users.hod,
        `/admin/team-member/${ids.managerA}`,
        {
          name: 'Alex Manager',
          email: `${ids.managerA}@defra.gov.uk`,
          role: 'Design Manager',
          managerId: ids.managerA,
          isLineManager: 'yes'
        }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('A person cannot be their own line manager')
      expect(backendApi.updatePerson).not.toHaveBeenCalled()
    })

    test('Duplicate email on change (409) shows the friendly message', async () => {
      backendApi.updatePerson.mockRejectedValueOnce(
        new BackendApiError(409, 'duplicate_email')
      )
      const { statusCode, result } = await post(
        users.hod,
        `/admin/team-member/${ids.report}`,
        {
          name: 'Rae Report',
          email: 'pending@defra.gov.uk',
          role: 'Interaction Designer',
          managerId: ''
        }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('That email address is already on the list')
      expect(backendApi.setManager).not.toHaveBeenCalled()
    })

    test('Turns an email-only entry into a set-up person', async () => {
      await post(users.hod, `/admin/team-member/${ids.pending}`, {
        name: 'Penny Pending',
        email: 'pending@defra.gov.uk',
        role: 'Service Designer',
        managerId: ids.managerB
      })
      expect(backendApi.updatePerson).toHaveBeenCalledWith(ids.pending, {
        name: 'Penny Pending',
        role: 'Service Designer'
      })
      expect(backendApi.setManager).toHaveBeenCalledWith(
        ids.pending,
        ids.managerB
      )
    })

    test('Head of Design cannot change their own job title or email', async () => {
      const { statusCode, result } = await post(
        users.hod,
        `/admin/team-member/${ids.hod}`,
        {
          name: 'Pat Head',
          email: 'other@defra.gov.uk',
          role: 'Design Manager',
          managerId: '',
          isLineManager: 'yes'
        }
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('You cannot change your own email address')
      expect(result).toContain('You cannot change your own job title')
      expect(backendApi.updatePerson).not.toHaveBeenCalled()
    })
  })

  describe('People and access', () => {
    test('Head of Design sees the new form button, Change links and the success banner', async () => {
      mockState.people.push(person(ids.created, { name: 'Nia New' }))
      const { result } = await get(
        users.hod,
        `/admin/users?saved=created&person=${ids.created}`
      )
      expect(result).toContain('href="/admin/team-member/new"')
      expect(result).toContain(`href="/admin/team-member/${ids.report}"`)
      expect(result).toContain(`href="/admin/team-member/${ids.pending}"`)
      expect(result).toContain('href="/admin/add-profile?new=1"')
      expect(result).toContain('Nia New is set up.')
      expect(result).toContain('see this when they sign in.')
    })

    test('Other admins keep the old wizard and get no Change links', async () => {
      const { statusCode, result } = await get(
        users.admin,
        `/admin/users?saved=created&person=${ids.report}`
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('href="/admin/add-profile?new=1"')
      expect(result).not.toContain('/admin/team-member/')
      expect(result).not.toContain('is set up.')
    })
  })

  describe('A person set up with only these fields', () => {
    const minimal = () =>
      person(ids.designer, {
        name: 'Min Imal',
        slug: 'min-imal',
        role: 'Interaction Designer',
        managerId: ids.managerA,
        email: `${ids.designer}@defra.gov.uk`
      })

    beforeEach(() => {
      mockState.people.push(minimal())
    })

    test.each([
      '/browse',
      '/browse?sort=profession',
      '/profile/min-imal',
      '/my-profile',
      '/my-profile/edit',
      '/my-gdad-evidence'
    ])('%s renders for them', async (url) => {
      const { statusCode } = await get(
        { ...users.designer, slug: 'min-imal', name: 'Min Imal' },
        url
      )
      expect(statusCode).toBe(statusCodes.ok)
    })

    test('My profile nudges them to finish it', async () => {
      const { result } = await get(users.designer, '/my-profile')
      expect(result).toContain('Finish your profile')
    })

    test('Their manager sees them on My team and can open their GDaD', async () => {
      const manager = sessionUser(ids.managerA, { isLineManager: true })
      expect((await get(manager, '/my-team')).result).toContain('Min Imal')
      expect(
        (await get(manager, `/review/gdad-evidence/${ids.designer}`)).statusCode
      ).toBe(statusCodes.ok)
    })

    test('Browse card does not show empty Experience and Location labels', async () => {
      const { result } = await get(users.designer, '/browse')
      expect(result).toContain('Profile not filled in yet.')
    })
  })
})
