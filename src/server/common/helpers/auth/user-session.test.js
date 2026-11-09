import { vi } from 'vitest'

import {
  buildSessionUser,
  findHasGdadReports,
  loadSessionUser
} from './user-session.js'

/*
 * Whether a line manager has anyone on the GDaD path to review. The backend
 * is faked with made-up people, so no live data is touched.
 */
const mockListPeople = vi.fn()

vi.mock('#/server/common/helpers/backend-api.js', () => ({
  backendApi: { listPeople: (...args) => mockListPeople(...args) }
}))

function person(id, role, flags = {}) {
  return {
    id,
    email: `${id}@example.test`,
    name: `Person ${id}`,
    role,
    isAdmin: false,
    isLineManager: false,
    managerId: null,
    ...flags
  }
}

const resourceManager = person('rm', 'Senior Resource Manager', {
  isLineManager: true
})
const accessibilityLead = person(
  'a11y-lead',
  'Senior Accessibility Specialist (Grade 7)',
  { isLineManager: true }
)
const designer = person('designer', 'Interaction Designer')

const everyone = [
  resourceManager,
  accessibilityLead,
  designer,
  person('d1', 'Service Designer', { managerId: 'rm' }),
  person('d2', 'Interaction Designer', { managerId: 'rm' }),
  person('s1', 'Accessibility Specialist (SEO)', { managerId: 'a11y-lead' }),
  person('s2', 'Accessibility Specialist (SEO)', { managerId: 'a11y-lead' })
]

describe('#findHasGdadReports', () => {
  beforeEach(() => {
    mockListPeople.mockReset()
    mockListPeople.mockResolvedValue(everyone)
  })

  test('A resource manager who manages designers has GDaD reports', async () => {
    expect(await findHasGdadReports(resourceManager)).toBe(true)
  })

  test('A manager of accessibility specialists only has no GDaD reports', async () => {
    expect(await findHasGdadReports(accessibilityLead)).toBe(false)
  })

  test('A manager who is given a designer later gets GDaD reports straight away', async () => {
    expect(await findHasGdadReports(accessibilityLead)).toBe(false)
    mockListPeople.mockResolvedValue([
      ...everyone,
      person('d3', 'Service Designer', { managerId: 'a11y-lead' })
    ])
    expect(await findHasGdadReports(accessibilityLead)).toBe(true)
  })

  test('People without a name (no profile yet) do not count', async () => {
    mockListPeople.mockResolvedValue([
      person('d4', 'Service Designer', { managerId: 'a11y-lead', name: '' })
    ])
    expect(await findHasGdadReports(accessibilityLead)).toBe(false)
  })

  test('Is not worked out for people who are not line managers', async () => {
    expect(await findHasGdadReports(designer)).toBeUndefined()
    expect(mockListPeople).not.toHaveBeenCalled()
  })

  test('If the people list cannot be read, it is left unknown', async () => {
    mockListPeople.mockRejectedValue(new Error('backend down'))
    expect(await findHasGdadReports(resourceManager)).toBeUndefined()
  })
})

describe('#loadSessionUser', () => {
  beforeEach(() => {
    mockListPeople.mockReset()
    mockListPeople.mockResolvedValue(everyone)
  })

  test('Carries the job title and the GDaD reports check', async () => {
    const user = await loadSessionUser(resourceManager)
    expect(user.role).toBe('Senior Resource Manager')
    expect(user.hasGdadReports).toBe(true)
    expect((await loadSessionUser(accessibilityLead)).hasGdadReports).toBe(
      false
    )
  })

  test('Leaves the check out for people who are not line managers', async () => {
    expect(await loadSessionUser(designer)).not.toHaveProperty('hasGdadReports')
  })
})

describe('#buildSessionUser', () => {
  test('Without the check, the session looks as it did before', () => {
    expect(buildSessionUser(resourceManager)).not.toHaveProperty(
      'hasGdadReports'
    )
  })
})
