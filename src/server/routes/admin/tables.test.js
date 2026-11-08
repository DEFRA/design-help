import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

/*
 * Admin tables have captions so screen readers can name them. The signed-in
 * user and the backend are both faked, so no live data is touched.
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
      listPeople: async () => mockState.people,
      getPerson: async (id) =>
        mockState.people.find((p) => p.id === id) ?? null,
      listHelpingPairs: async () => [
        {
          helper: mockState.people[0],
          helpee: mockState.people[1],
          since: '2026-01-01T00:00:00.000Z'
        }
      ]
    }
  }
})

const hod = {
  id: 'a00000000000000000000001',
  email: 'hod@defra.gov.uk',
  name: 'Hana Head',
  role: 'Head of Design',
  isAdmin: true,
  isHeadOfDesignSuperUser: true,
  isLineManager: false
}

const people = [
  {
    id: hod.id,
    email: hod.email,
    name: hod.name,
    role: 'Head of Design',
    approved: true,
    isAdmin: true,
    isLineManager: true,
    activatedAt: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'b00000000000000000000001',
    email: 'dee@defra.gov.uk',
    name: 'Dee Designer',
    role: 'Interaction Designer',
    approved: true,
    isAdmin: false,
    isLineManager: false,
    managerId: hod.id,
    activatedAt: '2026-01-01T00:00:00.000Z'
  }
]

describe('#admin table captions', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    mockState.user = hod
    mockState.people = people
  })

  test.each([
    ['/admin/users', ['People, their access and profiles']],
    [
      '/admin/identify-managers',
      ['Current line managers', 'People who can be added as line managers']
    ],
    ['/admin/management-allocations', ['Responsible manager for each person']],
    ['/admin/long-term-helping', ['Long-term help relationships']]
  ])('%s has a caption on each table', async (url, captions) => {
    const { statusCode, result } = await server.inject({ method: 'GET', url })
    expect(statusCode).toBe(statusCodes.ok)
    const found = [
      ...result.matchAll(
        /<caption class="govuk-table__caption[^"]*">([^<]*)<\/caption>/g
      )
    ].map((match) => match[1])
    expect(found).toEqual(captions)
    expect(result.match(/<table/g)).toHaveLength(captions.length)
  })
})
