import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'

/*
 * My profile page. The signed-in user and the backend are both faked, so no
 * live data is touched.
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
      getPersonByEmail: vi.fn(async () => null),
      listHelpingPairs: vi.fn(async () => [])
    }
  }
})

const id = 'a00000000000000000000009'

const user = {
  id,
  email: 'sam.sample@defra.gov.uk',
  name: 'Sam Sample',
  role: 'Interaction Designer',
  isAdmin: false,
  isHeadOfDesignSuperUser: false,
  isLineManager: false
}

function person(fields = {}) {
  return {
    id,
    slug: 'sam-sample',
    email: 'sam.sample@defra.gov.uk',
    contactEmail: null,
    name: 'Sam Sample',
    role: 'Interaction Designer',
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
    ...fields
  }
}

describe('#myProfile page', () => {
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
    mockState.user = user
  })

  async function getMyProfile(fields) {
    mockState.people = [person(fields)]
    const response = await server.inject({ method: 'GET', url: '/my-profile' })
    expect(response.statusCode).toBe(statusCodes.ok)
    return response.result
  }

  test('shows every filled-in field, including free text', async () => {
    const html = await getMyProfile({
      location: 'York',
      experience: '5 to 10 years',
      projectTeam: 'Farming grants',
      deliveryGroup: 'Rural',
      canHelpWith: ['Prototyping'],
      canHelpWithText: 'Running **workshops**',
      developmentGoalsText: 'Learning service design',
      bio: 'I like maps.',
      linkedinProfile: 'https://www.linkedin.com/in/sam-sample'
    })

    expect(html).toContain('York')
    expect(html).toContain('5 to 10 years')
    expect(html).toContain('Farming grants')
    expect(html).toContain('Rural')
    expect(html).toContain('Prototyping')
    expect(html).toContain('Running <strong>workshops</strong>')
    expect(html).toContain('What I would like help with')
    expect(html).toContain('Learning service design')
    expect(html).toContain('>About</h2>')
    expect(html).toContain('I like maps.')
    expect(html).toContain('https://www.linkedin.com/in/sam-sample')
  })

  test('hides free-text sections that are empty', async () => {
    const html = await getMyProfile({})

    expect(html).not.toContain('Can help with')
    expect(html).not.toContain('What I would like help with')
    expect(html).not.toContain('>About</h2>')
    expect(html).not.toContain('LinkedIn')
    expect(html).not.toContain('Project team')
    expect(html).not.toContain('Delivery group')
  })

  test('escapes HTML typed into free text', async () => {
    const html = await getMyProfile({
      canHelpWithText: 'Hello <script>alert(1)</script>',
      developmentGoalsText: '<img src=x onerror=alert(1)>',
      bio: '[click](javascript:alert(1))'
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;script&gt;')
  })

  test('shows a contact email only when it differs from the sign-in email', async () => {
    expect(
      await getMyProfile({ contactEmail: 'sam.other@defra.gov.uk' })
    ).toContain('sam.other@defra.gov.uk')
    expect(
      await getMyProfile({ contactEmail: 'sam.sample@defra.gov.uk' })
    ).not.toContain('Contact email')
  })

  test('links to the public profile', async () => {
    const html = await getMyProfile({})
    expect(html).toContain('href="/profile/sam-sample"')
    expect(html).toContain('See your profile as others see it')
  })

  test('falls back to the id for the public profile link when there is no slug', async () => {
    const html = await getMyProfile({ slug: null })
    expect(html).toContain(`href="/profile/${id}"`)
  })

  test('no public profile link before a profile exists', async () => {
    mockState.people = [person({ name: null })]
    const response = await server.inject({ method: 'GET', url: '/my-profile' })
    expect(response.result).toContain('You do not have a profile yet.')
    expect(response.result).not.toContain('See your profile as others see it')
  })
})
