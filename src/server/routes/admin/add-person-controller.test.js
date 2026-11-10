import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'

/*
 * "Add a person" (name and Defra email only) and the People and access page
 * around it. The signed-in user and the backend are both faked, so no live
 * data is touched.
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
        async (id) => mockState.people.find((p) => p.id === id) ?? null
      ),
      getPersonByEmail: vi.fn(
        async (email) => mockState.people.find((p) => p.email === email) ?? null
      ),
      createPerson: vi.fn()
    }
  }
})

const ids = {
  hod: 'a00000000000000000000001',
  admin: 'a00000000000000000000002',
  designer: 'a00000000000000000000003',
  existing: 'b00000000000000000000001',
  created: 'c00000000000000000000001'
}

function sessionUser(id, flags = {}) {
  return {
    id,
    email: `${id}@defra.gov.uk`,
    name: `User ${id}`,
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false,
    ...flags
  }
}

const users = {
  hod: sessionUser(ids.hod, {
    email: 'hod@defra.gov.uk',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  }),
  admin: sessionUser(ids.admin, { isAdmin: true }),
  designer: sessionUser(ids.designer)
}

function person(id, fields = {}) {
  return {
    id,
    email: `${id}@defra.gov.uk`,
    name: null,
    role: null,
    approved: true,
    isAdmin: false,
    isLineManager: false,
    managerId: null,
    activatedAt: null,
    ...fields
  }
}

function buildPeople() {
  return [
    person(ids.existing, {
      email: 'sam.smith@defra.gov.uk',
      name: 'Sam Smith',
      role: 'Service Designer',
      activatedAt: '2026-01-01T00:00:00.000Z'
    })
  ]
}

const valid = { name: 'Nia New', email: 'Nia.New@defra.gov.uk' }

describe('#addPersonRoutes', () => {
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
    backendApi.createPerson.mockImplementation(async (payload) => {
      const created = person(ids.created, payload)
      mockState.people.push(created)
      return created
    })
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

  describe('People and access page', () => {
    test.each([
      ['Head of Design', 'hod'],
      ['other admin', 'admin']
    ])(
      '%s sees one Add a person button and no old add options',
      async (_label, key) => {
        const { statusCode, result } = await get(users[key], '/admin/users')
        expect(statusCode).toBe(statusCodes.ok)
        expect(result).toContain(
          '<h1 class="govuk-heading-xl">People and access</h1>'
        )
        expect(result).toContain(
          'Add people, set their job title and line manager, and give or remove admin access. People marked Pending haven’t signed in yet.'
        )
        expect(result.match(/>Add a person</g)).toHaveLength(1)
        expect(result).toContain('href="/admin/people/new"')
        expect(result).not.toContain('action="/admin/approved-emails"')
        expect(result).not.toContain('Add person (email address)')
        expect(result).not.toContain('full directory profile')
        expect(result).not.toContain('/admin/add-profile')
        expect(result).not.toContain('href="/admin/team-member/new"')
        expect(result).not.toContain('Add team member')
        expect(result).not.toContain('GDaD evidence admin tool')
        expect(result).not.toContain('style=')
      }
    )
  })

  describe('Access', () => {
    test('An admin who is not the Head of Design can open the page', async () => {
      const { statusCode, result } = await get(users.admin, '/admin/people/new')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('<h1 class="govuk-heading-xl">Add a person</h1>')
      expect(result).toContain('href="/admin/users"')
      expect(result).toContain('Full name')
      expect(result).toContain('Defra email address')
      expect(result).toContain('Add to list')
      expect(result).toContain('name="crumb"')
      expect(result).toContain('spellcheck="false"')
      expect(result).toContain('autocomplete="off"')
      expect(result).not.toContain('style=')
    })

    test('A non-admin is refused on GET and POST', async () => {
      expect((await get(users.designer, '/admin/people/new')).statusCode).toBe(
        statusCodes.forbidden
      )
      expect(
        (await post(users.designer, '/admin/people/new', valid)).statusCode
      ).toBe(statusCodes.forbidden)
      expect(backendApi.createPerson).not.toHaveBeenCalled()
    })
  })

  describe('Validation', () => {
    test.each([
      [
        'missing name',
        { ...valid, name: '  ' },
        '#name',
        'Enter their full name'
      ],
      [
        'name too long',
        { ...valid, name: 'a'.repeat(256) },
        '#name',
        'Full name must be 255 characters or fewer'
      ],
      [
        'missing email',
        { ...valid, email: '' },
        '#email',
        'Enter their Defra email address'
      ],
      [
        'non-Defra email',
        { ...valid, email: 'someone@gmail.com' },
        '#email',
        'Enter a Defra email address ending in @defra.gov.uk, like name@defra.gov.uk'
      ],
      [
        'email already on the list',
        { ...valid, email: 'Sam.Smith@defra.gov.uk' },
        '#email',
        'That email address is already on the list. Change their details instead of adding them again'
      ]
    ])(
      '%s shows the error summary and inline error',
      async (_l, payload, href, message) => {
        const { statusCode, result } = await post(
          users.admin,
          '/admin/people/new',
          payload
        )
        expect(statusCode).toBe(statusCodes.badRequest)
        expect(result).toContain('There is a problem')
        expect(result).toContain(`href="${href}"`)
        expect(result).toContain(message)
        expect(result).toContain('govuk-error-message')
        expect(result).toContain('Error: Add a person |')
        expect(backendApi.createPerson).not.toHaveBeenCalled()
      }
    )

    test('Keeps what was typed after an error', async () => {
      const { result } = await post(users.admin, '/admin/people/new', {
        name: 'Nia New',
        email: 'someone@gmail.com'
      })
      expect(result).toContain('value="Nia New"')
      expect(result).toContain('value="someone@gmail.com"')
    })

    test('A duplicate found by the backend is refused the same way', async () => {
      backendApi.createPerson.mockRejectedValueOnce(
        new BackendApiError(409, 'duplicate')
      )
      const { statusCode, result } = await post(
        users.admin,
        '/admin/people/new',
        valid
      )
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('That email address is already on the list.')
    })

    test('Head of Design gets a link to change the person already on the list', async () => {
      const { result } = await post(users.hod, '/admin/people/new', {
        ...valid,
        email: 'sam.smith@defra.gov.uk'
      })
      expect(result).toContain(`href="/admin/team-member/${ids.existing}"`)
    })

    test('Other admins do not get the Head of Design-only Change link', async () => {
      const { result } = await post(users.admin, '/admin/people/new', {
        ...valid,
        email: 'sam.smith@defra.gov.uk'
      })
      expect(result).not.toContain('/admin/team-member/')
    })
  })

  describe('Adding someone', () => {
    test('Creates them with name and email only, then shows the banner', async () => {
      const { statusCode, headers } = await post(
        users.admin,
        '/admin/people/new',
        valid
      )
      expect(statusCode).toBe(302)
      expect(backendApi.createPerson).toHaveBeenCalledWith({
        name: 'Nia New',
        email: 'nia.new@defra.gov.uk'
      })
      expect(headers.location).toBe(
        `/admin/users?saved=added&person=${ids.created}`
      )

      const { result } = await get(users.admin, headers.location)
      expect(result).toContain(
        'Nia New has been added. Use Change to set their job title and line manager, or send them an invite.'
      )
    })

    test('Their row shows Pending and Send invite, with no job title yet', async () => {
      await post(users.admin, '/admin/people/new', valid)
      const { result } = await get(users.hod, '/admin/users')

      const rowStart = result.indexOf('Nia New')
      const row = result.slice(rowStart, result.indexOf('</tr>', rowStart))
      expect(row).toContain(
        '<strong class="govuk-tag govuk-tag--yellow">Pending</strong>'
      )
      expect(row).toContain(`action="/admin/users/${ids.created}/invite"`)
      expect(row).toContain('Send invite')
      expect(row).toContain(`href="/admin/team-member/${ids.created}"`)
      expect(result).toContain('Invite everyone who’s pending (1)')
    })
  })

  describe('Old email-only form', () => {
    test('POST /admin/approved-emails still adds the email', async () => {
      const { statusCode, headers } = await post(
        users.admin,
        '/admin/approved-emails',
        { email: 'old.form@defra.gov.uk' }
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/admin/users')
      expect(backendApi.createPerson).toHaveBeenCalledWith({
        email: 'old.form@defra.gov.uk'
      })
    })
  })
})
