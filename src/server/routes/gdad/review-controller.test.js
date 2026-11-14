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
  hodReport: 'b00000000000000000000005',
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
  },
  {
    id: ids.hodReport,
    name: 'Hal Hod-Report',
    role: 'Senior Service Designer',
    managerId: ids.hod,
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
    test('Sees only their own report on My team', async () => {
      const { statusCode, result } = await get(users.manager, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Ada Own-Report')
      expect(result).not.toContain('Bea Other-Report')
      expect(result).not.toContain('Cy Unallocated')
      expect(result).not.toContain('Manager Themselves')
    })

    test('Gets My team in the menu but not the Admin link', async () => {
      const { result } = await get(users.manager, '/my-team')
      expect(result).toMatch(/href="\/my-team" aria-current="page"/)
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
        '/my-team',
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
        '/my-team',
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
      const { statusCode, result } = await get(users.hod, '/my-team')
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
    test('Sees only their own report, with the Admin link', async () => {
      const { statusCode, result } = await get(users.adminManager, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Dee Admin-Managers-Report')
      expect(result).not.toContain('Ada Own-Report')
      expect(result).not.toContain('Cy Unallocated')
      expect(result).toContain('href="/admin/users"')
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
      ['line manager, own report', 'manager', ids.ownReport],
      [
        'admin line manager, own report',
        'adminManager',
        ids.adminManagersReport
      ],
      ['plain admin, unallocated person', 'admin', ids.unallocated],
      ['plain admin, allocated person', 'admin', ids.ownReport],
      ['non-manager non-admin', 'designer', ids.ownReport]
    ])('Refused for %s', async (_label, who, id) => {
      const { statusCode } = await post(users[who], url(id), scorePayload)
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test.each([
      ['Head of Design, own direct report', 'hod', ids.hodReport],
      ['Head of Design, unallocated person', 'hod', ids.unallocated],
      ['Head of Design, another manager’s report', 'hod', ids.otherReport],
      ['Head of Design, self-review special case', 'hod', ids.hod]
    ])('Allowed for %s', async (_label, who, id) => {
      const { statusCode, headers } = await post(
        users[who],
        url(id),
        scorePayload
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(`/review/gdad-evidence/${id}/scores-saved`)
      expect(backendApi.saveGdadScores).toHaveBeenCalledTimes(1)
      const [savedId, scores, reviewerId] =
        backendApi.saveGdadScores.mock.calls[0]
      expect(savedId).toBe(id)
      expect(scores.design_communication).toBe(2)
      expect(reviewerId).toBe(users[who].id)
    })
  })

  describe('Line managers are view-only', () => {
    const scored = {
      id: ids.ownReport,
      name: 'Ada Own-Report',
      role: 'Interaction Designer',
      managerId: ids.manager,
      gdad: {
        design_communication: {
          evidenceText: 'Some evidence',
          evidenceUpdatedAt: '2026-10-01T09:00:00.000Z',
          officialScore: 2,
          scoredAt: '2026-10-02T09:00:00.000Z'
        }
      }
    }
    beforeEach(() => {
      mockState.people = [
        scored,
        ...people.filter((p) => p.id !== ids.ownReport)
      ]
    })

    test('See their report’s scores and capability level, with no score controls', async () => {
      const { statusCode, result } = await get(
        users.manager,
        personUrl(ids.ownReport)
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('2 — At standard')
      expect(result).toContain('No score yet')
      expect(result).toContain('Scores are given by the Head of Design.')
      expect(result).not.toContain('name="score_')
      expect(result).not.toContain('Change score')
      expect(result).not.toContain('Save scores')
      expect(result).not.toContain('action="/review/gdad-evidence')
    })

    test('See a skill page with the score, but no score form', async () => {
      const { statusCode, result } = await get(
        users.manager,
        skillUrl(ids.ownReport)
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('2 — At standard')
      expect(result).toContain('Some evidence')
      expect(result).toContain('Scores are given by the Head of Design.')
      expect(result).not.toContain('name="score_')
      expect(result).not.toContain('Save score')
      expect(result).not.toContain('action="/review/gdad-evidence')
    })

    test('The Head of Design gets the score controls', async () => {
      const person = (await get(users.hod, personUrl(ids.ownReport))).result
      expect(person).toContain('name="score_design_communication"')
      expect(person).toContain('Save scores')
      expect(person).not.toContain('Scores are given by the Head of Design.')
      const skill = (await get(users.hod, skillUrl(ids.ownReport))).result
      expect(skill).toContain('name="score_design_communication"')
      expect(skill).toContain('Save score')
    })

    test('My team tells line managers the Head of Design scores', async () => {
      const { result } = await get(users.manager, '/my-team')
      expect(result).toContain('Scores are given by the Head of Design.')
      expect(result).not.toContain('read their GDaD evidence and score it')
    })
  })

  describe('Head of Design My team views', () => {
    function rowFor(result, name) {
      const start = result.indexOf(name)
      return result.slice(start, result.indexOf('</tr>', start))
    }

    test('Defaults to the whole team, with a line manager column', async () => {
      const { statusCode, result } = await get(users.hod, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /href="\/my-team\?view=whole" aria-current="page">Whole team/
      )
      expect(result).toContain(
        '<th scope="col" class="govuk-table__header">Line manager</th>'
      )
      expect(rowFor(result, 'Ada Own-Report')).toContain('Manager Themselves')
      expect(rowFor(result, 'Hal Hod-Report')).toContain(
        'Head Of Design Themselves'
      )
      expect(rowFor(result, 'Cy Unallocated')).toContain('Not allocated')
      expect(result).toContain('Bea Other-Report')
    })

    test('Whole team can be chosen explicitly', async () => {
      const { result } = await get(users.hod, '/my-team?view=whole')
      expect(result).toContain('Cy Unallocated')
      expect(result).toContain('Hal Hod-Report')
    })

    test('My direct reports shows only people the Head of Design manages', async () => {
      const { statusCode, result } = await get(
        users.hod,
        '/my-team?view=direct'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toMatch(
        /href="\/my-team\?view=direct" aria-current="page">My direct reports \(1\)/
      )
      expect(result).toContain('Hal Hod-Report')
      expect(result).not.toContain('Ada Own-Report')
      expect(result).not.toContain('Cy Unallocated')
      expect(result).not.toContain('>Line manager</th>')
    })

    test('An unknown view falls back to the whole team', async () => {
      const { result } = await get(users.hod, '/my-team?view=nonsense')
      expect(result).toMatch(/view=whole" aria-current="page"/)
    })

    test('Shows an empty state when the Head of Design has no direct reports', async () => {
      mockState.people = people.filter((p) => p.id !== ids.hodReport)
      const { result } = await get(users.hod, '/my-team?view=direct')
      expect(result).toContain('My direct reports (0)')
      expect(result).toContain(
        'No designers have you as their responsible manager.'
      )
    })

    test('Line managers get no views or line manager column', async () => {
      const { result } = await get(users.manager, '/my-team')
      expect(result).not.toContain('My team views')
      expect(result).not.toContain('view=whole')
      expect(result).not.toContain('view=direct')
      expect(result).not.toContain('>Line manager</th>')
    })
  })

  describe('Scores CSV', () => {
    test('Head of Design gets everyone, with a line manager column', async () => {
      const { result } = await get(
        users.hod,
        '/review/gdad-evidence/export.csv'
      )
      const lines = result.replace('\uFEFF', '').split('\n')
      expect(lines[0].endsWith(',Line manager')).toBe(true)
      const line = (name) => lines.find((l) => l.startsWith(name))
      expect(line('Ada Own-Report').endsWith(',Manager Themselves')).toBe(true)
      expect(line('Cy Unallocated').endsWith(',Not allocated')).toBe(true)
      expect(
        line('Hal Hod-Report').endsWith(',Head Of Design Themselves')
      ).toBe(true)
    })

    test('Line managers get only their reports, with no line manager column', async () => {
      const { result } = await get(
        users.manager,
        '/review/gdad-evidence/export.csv'
      )
      const lines = result.replace('\uFEFF', '').split('\n')
      expect(lines[0]).not.toContain('Line manager')
      expect(lines[0].endsWith(',Capability Level Change')).toBe(true)
      expect(lines).toHaveLength(2)
      expect(lines[1].startsWith('Ada Own-Report')).toBe(true)
    })
  })

  describe('Job titles not on the GDaD path', () => {
    const resourceManager = sessionUser(ids.otherManager, {
      role: 'Senior Resource Manager',
      isLineManager: true,
      hasGdadReports: true
    })
    const accessibilityManager = sessionUser(ids.manager, {
      role: 'Senior Accessibility Specialist (Grade 7)',
      isLineManager: true,
      hasGdadReports: false
    })

    test('A resource manager sees their designers on My team, with no GDaD link', async () => {
      const { statusCode, result } = await get(resourceManager, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Bea Other-Report')
      expect(result).not.toContain('Ada Own-Report')
      expect(result).not.toContain('href="/my-gdad-evidence"')
    })

    test('A resource manager can open their designer’s evidence', async () => {
      expect(
        (await get(resourceManager, personUrl(ids.otherReport))).statusCode
      ).toBe(statusCodes.ok)
      expect(
        (await get(resourceManager, skillUrl(ids.otherReport))).statusCode
      ).toBe(statusCodes.ok)
    })

    test('A manager with no GDaD reports is refused My team and the CSV', async () => {
      for (const url of ['/my-team', '/review/gdad-evidence/export.csv']) {
        expect((await get(accessibilityManager, url)).statusCode).toBe(
          statusCodes.forbidden
        )
      }
    })
  })

  describe('Old review list address', () => {
    test('Redirects to My team', async () => {
      const { statusCode, headers } = await get(
        users.manager,
        '/review/gdad-evidence'
      )
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/my-team')
    })
  })

  describe('My team page', () => {
    const earlier = '2026-10-01T09:00:00.000Z'
    const later = '2026-10-20T09:00:00.000Z'
    const team = (gdadByName) =>
      Object.entries(gdadByName).map(([name, gdad], i) => ({
        id: `c0000000000000000000000${i}`,
        name,
        role: 'Interaction Designer',
        managerId: ids.manager,
        gdad
      }))

    function rowFor(result, name) {
      const start = result.indexOf(name)
      return result.slice(start, result.indexOf('</tr>', start))
    }

    test('Shows an empty state when no designers are allocated', async () => {
      mockState.people = []
      const { statusCode, result } = await get(users.manager, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('No designers are allocated to you yet.')
      expect(result).toContain('href="/review/gdad-evidence/export.csv"')
    })

    test('Flags evidence with no score, and evidence changed since scored', async () => {
      mockState.people = team({
        'Ann Unscored': {
          design_communication: {
            evidenceText: 'Some evidence',
            evidenceUpdatedAt: earlier
          }
        },
        'Ben Changed': {
          design_communication: {
            evidenceText: 'Some evidence',
            evidenceUpdatedAt: later,
            officialScore: 2,
            scoredAt: earlier
          }
        },
        'Cat Scored': {
          design_communication: {
            evidenceText: 'Some evidence',
            evidenceUpdatedAt: earlier,
            officialScore: 2,
            scoredAt: later
          }
        },
        'Dan Nothing': {}
      })
      const { result } = await get(users.hod, '/my-team')
      expect(result).toContain('2 designers need your attention')
      expect(rowFor(result, 'Ann Unscored')).toContain('Needs your attention')
      expect(rowFor(result, 'Ben Changed')).toContain('Needs your attention')
      expect(rowFor(result, 'Cat Scored')).not.toContain('Needs your attention')
      expect(rowFor(result, 'Cat Scored')).toContain('Up to date')
      expect(rowFor(result, 'Dan Nothing')).not.toContain(
        'Needs your attention'
      )
      expect(rowFor(result, 'Cat Scored')).toContain('1 of 7')

      // A line manager is told the same thing as information, not asked to score
      const lmView = (await get(users.manager, '/my-team')).result
      expect(lmView).not.toContain('Needs your attention')
      expect(lmView).not.toContain('to score</span>')
      expect(lmView).toContain('2 designers have evidence waiting for a score')
      expect(rowFor(lmView, 'Ann Unscored')).toContain('Waiting for a score')
      expect(rowFor(lmView, 'Ben Changed')).toContain(
        '1 skill new or updated since last scored'
      )
      expect(rowFor(lmView, 'Cat Scored')).toContain('Up to date')
    })

    test('Lists people needing attention first, then by name', async () => {
      mockState.people = team({
        'Aaron Fine': {},
        'Zoe Waiting': {
          design_communication: {
            evidenceText: 'Some evidence',
            evidenceUpdatedAt: earlier
          }
        },
        'Mo Fine': {}
      })
      const { result } = await get(users.manager, '/my-team')
      const order = ['Zoe Waiting', 'Aaron Fine', 'Mo Fine'].map((name) =>
        result.indexOf(name)
      )
      expect(order).toEqual([...order].sort((a, b) => a - b))
    })

    test('Shows the score and rating once six skills are scored', async () => {
      const keys = [
        'design_communication',
        'designing_for_everyone',
        'designing_strategically',
        'designing_together',
        'evidence_based_design',
        'iterative_design',
        'leading_design'
      ]
      const gdad = Object.fromEntries(
        keys.slice(0, 6).map((key) => [key, { officialScore: 2 }])
      )
      mockState.people = team({ 'Eve Banded': gdad, 'Fin Unbanded': {} })
      const { result } = await get(users.manager, '/my-team')
      // Six scores of 2 total 12 → Proficient Level 2
      expect(rowFor(result, 'Eve Banded')).toContain('12 — Proficient Level 2')
      expect(rowFor(result, 'Eve Banded')).not.toMatch(/Level \d — /)
      expect(result).toContain(
        '<th scope="col" class="govuk-table__header">Score</th>'
      )
      expect(result).not.toContain('Capability level')
      expect(rowFor(result, 'Eve Banded')).toContain('6 of 7')
      expect(rowFor(result, 'Fin Unbanded')).toContain('Not yet')
    })
  })

  describe('Designer and manager views match', () => {
    const designerPerson = {
      id: ids.designer,
      name: 'Gil Designer',
      role: 'Interaction Designer',
      managerId: ids.manager,
      gdad: {
        design_communication: {
          evidenceText: 'Some evidence',
          evidenceUpdatedAt: '2026-10-01T09:00:00.000Z',
          officialScore: 2,
          scoredAt: '2026-10-02T09:00:00.000Z'
        }
      }
    }

    function tableHeadings(html) {
      return [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map(
        (m) => m[1].trim()
      )
    }
    function skillLabels(html) {
      return [
        ...html.matchAll(/<th scope="row"[^>]*>\s*<a[^>]*>([^<]+)</g)
      ].map((m) => m[1].trim())
    }
    function capabilityPanel(html) {
      const explanation = html.indexOf('Total of the best 6 of 7 skill scores')
      const start = html.lastIndexOf('govuk-inset-text', explanation)
      return html.slice(start, html.indexOf('</div>', explanation))
    }

    test('Summary pages share skills, order, headings and capability wording', async () => {
      mockState.people = [...people, designerPerson]
      const designerView = (await get(users.designer, '/my-gdad-evidence'))
        .result
      const managerView = (await get(users.manager, personUrl(ids.designer)))
        .result
      const hodView = (await get(users.hod, personUrl(ids.designer))).result

      expect(skillLabels(designerView)).toHaveLength(7)
      expect(skillLabels(managerView)).toEqual(skillLabels(designerView))
      expect(skillLabels(hodView)).toEqual(skillLabels(designerView))
      // The line manager sees the same table as the designer
      expect(tableHeadings(managerView)).toEqual(tableHeadings(designerView))
      // The Head of Design's view only adds the score control column
      expect(tableHeadings(hodView)).toEqual([
        ...tableHeadings(designerView),
        'Change score'
      ])
      expect(capabilityPanel(managerView)).toEqual(
        capabilityPanel(designerView)
      )
      expect(capabilityPanel(hodView)).toEqual(capabilityPanel(designerView))
      expect(hodView).toContain('name="score_design_communication"')
      expect(managerView).not.toContain('name="score_design_communication"')
      expect(designerView).not.toContain('name="score_design_communication"')
    })

    test('Skill pages share the same skill detail', async () => {
      mockState.people = [...people, designerPerson]
      const detail = (html) => {
        const start = html.indexOf('<h1')
        return html.slice(start, html.indexOf('Evidence (STAR)', start))
      }
      const designerView = (
        await get(users.designer, '/my-gdad-evidence/design_communication')
      ).result
      const managerView = (await get(users.manager, skillUrl(ids.designer)))
        .result
      expect(detail(designerView)).toContain('2 — At standard')
      expect(detail(managerView)).toEqual(detail(designerView))
      const designerEdit = (
        await get(users.designer, '/my-gdad-evidence/design_communication/edit')
      ).result
      expect(detail(designerEdit)).toEqual(detail(designerView))
      expect(designerEdit).toContain('name="evidence_design_communication"')
      expect(designerView).not.toContain('name="evidence_design_communication"')
      expect(managerView).not.toContain('name="evidence_design_communication"')
    })
  })

  describe('Top of the evidence pages', () => {
    const allSkillKeys = [
      'design_communication',
      'designing_for_everyone',
      'designing_strategically',
      'designing_together',
      'evidence_based_design',
      'iterative_design',
      'leading_design'
    ]
    const explanation =
      'Total of the best 6 of 7 skill scores. The Head of Design scores each skill 1 (below expected level), 2 (at expected level) or 3 (above expected level).'

    function withScores(person, scores) {
      return {
        ...person,
        gdad: Object.fromEntries(
          scores.map((score, i) => [allSkillKeys[i], { officialScore: score }])
        )
      }
    }

    function designerWith(scores) {
      return withScores(
        {
          id: ids.designer,
          name: 'Gil Designer',
          role: 'Interaction Designer',
          managerId: ids.manager
        },
        scores
      )
    }

    test('Shows the total and rating once six skills are scored', async () => {
      mockState.people = [...people, designerWith([3, 3, 3, 3, 3, 3, 1])]
      for (const [user, url] of [
        [users.designer, '/my-gdad-evidence'],
        [users.manager, personUrl(ids.designer)],
        [users.hod, personUrl(ids.designer)]
      ]) {
        const { result } = await get(user, url)
        expect(result).toMatch(
          /<h2 class="govuk-heading-m[^"]*">Score 18 — Accomplished Level 2<\/h2>/
        )
        expect(result).toContain(explanation)
        expect(result).not.toContain('No score yet')
        expect(result).not.toContain('Capability level 6')
        expect(result).not.toMatch(/Capability level \d/)
      }
    })

    test('Says there is no score yet, and how many skills are scored', async () => {
      mockState.people = [...people, designerWith([2, 2, 3])]
      const { result } = await get(users.designer, '/my-gdad-evidence')
      expect(result).toMatch(
        /<h2 class="govuk-heading-m[^"]*">No score yet<\/h2>/
      )
      expect(result).toContain('3 of 6 skills scored so far.')
      expect(result).toContain(explanation)
      expect(result).not.toContain('Score 0')
    })

    test('Links to the designer’s level on the framework, in one line', async () => {
      mockState.people = [...people, designerWith([])]
      const { result } = await get(users.designer, '/my-gdad-evidence')
      expect(result).toContain(
        'Expected levels: <a class="govuk-link" href="https://understand-digital-data-roles-skills.service.gov.uk/role/interaction-designer/#interaction-designer" target="_blank" rel="noopener noreferrer">Interaction designer on the DDaT capability framework (opens in a new tab)</a>'
      )
      expect(result).not.toContain('Official scores')
    })

    test('Links a service designer to their level on the service designer page', async () => {
      const { result } = await get(users.hod, personUrl(ids.hodReport))
      expect(result).toContain(
        'href="https://understand-digital-data-roles-skills.service.gov.uk/role/service-designer/#senior-service-designer"'
      )
      expect(result).toContain(
        'Senior service designer on the DDaT capability framework (opens in a new tab)'
      )
    })

    test('No longer links to a local skills matrix', async () => {
      mockState.people = [...people, designerWith([2])]
      for (const [user, url] of [
        [users.designer, '/my-gdad-evidence'],
        [users.designer, '/my-gdad-evidence/design_communication'],
        [users.manager, personUrl(ids.designer)],
        [users.manager, skillUrl(ids.designer)]
      ]) {
        const { result } = await get(user, url)
        expect(result).not.toMatch(/skills matrix/i)
        expect(result).not.toContain('skills-matrix')
      }
      const { statusCode } = await get(
        users.designer,
        '/gdad-reference/skills-matrix.png'
      )
      expect(statusCode).toBe(statusCodes.notFound)
    })
  })
})
