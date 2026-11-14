import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { MAX_EVIDENCE_LENGTH } from '#/server/common/helpers/gdad/constants.js'

/*
 * Accessibility checks on the GDaD pages: errors shown next to the field the
 * GOV.UK way, "Error:" in the page title, named scrolling tables and the
 * note on the scores download. The signed-in user and the backend are both
 * faked, so no live data is touched.
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
    saveGdadScores: vi.fn(),
    saveGdadEvidence: vi.fn()
  }
}))

const ids = {
  hod: 'a00000000000000000000001',
  manager: 'a00000000000000000000002',
  designer: 'b00000000000000000000001'
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
  // Only the Head of Design scores, so the score controls are checked as them
  hod: sessionUser(ids.hod, {
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  }),
  manager: sessionUser(ids.manager, { isLineManager: true }),
  designer: sessionUser(ids.designer)
}

const designer = {
  id: ids.designer,
  name: 'Ada Designer',
  role: 'Interaction Designer',
  managerId: ids.manager,
  gdad: {}
}

const people = [
  designer,
  {
    id: ids.manager,
    name: 'Manager Themselves',
    role: 'Senior Interaction Designer',
    managerId: null,
    gdad: {}
  }
]

function pageTitle(html) {
  return html.match(/<title>([\s\S]*?)<\/title>/)[1].trim()
}

/** The opening tag of the element with this id. */
function openingTag(html, id) {
  const match = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))
  return match ? match[0] : ''
}

describe('#gdad accessibility', () => {
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

  async function post(user, url, payload) {
    mockState.user = user
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', ...payload }
    })
  }

  describe('Evidence form', () => {
    const url = '/my-gdad-evidence/design_communication/edit'

    test('Uses the GOV.UK character count, with no error or "Error:" title', async () => {
      const { result } = await get(users.designer, url)
      expect(result).toContain('data-module="govuk-character-count"')
      expect(result).toContain('id="evidence-design_communication-info"')
      expect(pageTitle(result)).not.toMatch(/^Error:/)
      expect(result).not.toContain('govuk-error-message')
    })

    test('Shows a too-long error next to the box and keeps what was typed', async () => {
      const tooLong = 'x'.repeat(MAX_EVIDENCE_LENGTH + 1)
      const { statusCode, result } = await post(users.designer, url, {
        evidence_design_communication: tooLong
      })
      expect(statusCode).toBe(400)
      expect(pageTitle(result)).toMatch(/^Error: /)
      expect(result).toContain('href="#evidence-design_communication"')
      expect(result).toContain('govuk-form-group--error')
      expect(result).toContain('id="evidence-design_communication-error"')
      expect(result).toContain('Evidence must be 12,000 characters or fewer')
      const textarea = openingTag(result, 'evidence-design_communication')
      expect(textarea).toContain('govuk-textarea--error')
      expect(textarea).toMatch(
        /aria-describedby="[^"]*evidence-design_communication-error/
      )
      expect(result).toContain(tooLong)
    })
  })

  describe('Single skill score', () => {
    const url = `/review/gdad-evidence/${ids.designer}/design_communication`

    test('Labels the control "Score" when nothing is scored yet', async () => {
      const { result } = await get(users.hod, url)
      expect(result).toMatch(
        /<label class="govuk-label govuk-label--m" for="score-design_communication">\s*Score\s*<\/label>/
      )
    })

    test('Labels the control "Change score" once a score is saved', async () => {
      mockState.people = [
        { ...designer, gdad: { design_communication: { officialScore: 2 } } },
        people[1]
      ]
      const { result } = await get(users.hod, url)
      expect(result).toMatch(
        /for="score-design_communication">\s*Change score\s*<\/label>/
      )
    })

    test('Shows an invalid score error next to the select', async () => {
      const { result } = await get(users.hod, `${url}?err=invalid`)
      expect(pageTitle(result)).toMatch(/^Error: /)
      expect(result).toContain('href="#score-design_communication"')
      expect(result).toContain('id="score-design_communication-error"')
      const select = openingTag(result, 'score-design_communication')
      expect(select).toContain('govuk-select--error')
      expect(select).toContain(
        'aria-describedby="score-design_communication-error"'
      )
    })
  })

  describe('All scores for a person', () => {
    const url = `/review/gdad-evidence/${ids.designer}`

    test('An invalid score sends you back naming the skill', async () => {
      const { statusCode, headers } = await post(users.hod, url, {
        score_designing_together: '9'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(
        `${url}?err=invalid&skill=designing_together`
      )
    })

    test('Shows the error at the top and next to that skill’s score', async () => {
      const { result } = await get(
        users.hod,
        `${url}?err=invalid&skill=designing_together`
      )
      expect(pageTitle(result)).toMatch(/^Error: /)
      expect(result.indexOf('govuk-error-summary')).toBeLessThan(
        result.indexOf('<h1')
      )
      expect(result).toContain('href="#score-designing_together"')
      const select = openingTag(result, 'score-designing_together')
      expect(select).toContain('govuk-select--error')
      expect(select).toContain(
        'aria-describedby="score-designing_together-error"'
      )
      expect(openingTag(result, 'score-design_communication')).not.toContain(
        'govuk-select--error'
      )
    })

    test('Falls back to the first score when the skill is unknown', async () => {
      const { result } = await get(users.hod, `${url}?err=invalid`)
      expect(result).toContain('href="#score-design_communication"')
      expect(openingTag(result, 'score-design_communication')).toContain(
        'govuk-select--error'
      )
    })

    test('Names the scrolling skills table', async () => {
      const { result } = await get(users.manager, url)
      expect(result).toContain(
        'tabindex="0" role="region" aria-label="Skills table, scrolls sideways"'
      )
      expect(pageTitle(result)).not.toMatch(/^Error:/)
    })
  })

  describe('My team', () => {
    test('Names the scrolling table and warns about the CSV download', async () => {
      const { statusCode, result } = await get(users.manager, '/my-team')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'tabindex="0" role="region" aria-label="Designers table, scrolls sideways"'
      )
      expect(result).toContain(
        'This file contains personal information. Store it somewhere only the right people can see it, and delete it when you no longer need it.'
      )
    })
  })

  describe('My team views (Head of Design)', () => {
    test('Are a labelled navigation that marks the current view', async () => {
      const { result } = await get(users.hod, '/my-team?view=direct')
      expect(result).toContain('<nav class="design-help-view-nav')
      expect(result).toContain('aria-label="My team views"')
      expect(result).toMatch(
        /href="\/my-team\?view=direct" aria-current="page"/
      )
      expect(result).not.toMatch(/view=whole" aria-current/)
      expect(result).toContain(
        '<h2 class="govuk-heading-l">My direct reports</h2>'
      )
    })
  })

  describe('CSV import', () => {
    const url = '/my-gdad-evidence/import-csv'

    function multipart(fields) {
      const boundary = 'test-boundary'
      const parts = fields.map(
        ({ name, filename, content }) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"` +
          (filename
            ? `; filename="${filename}"\r\nContent-Type: text/csv`
            : '') +
          `\r\n\r\n${content}\r\n`
      )
      return {
        payload: `${parts.join('')}--${boundary}--\r\n`,
        contentType: `multipart/form-data; boundary=${boundary}`
      }
    }

    test('Shows an error at the top and next to the file field', async () => {
      mockState.user = users.designer
      const { payload, contentType } = multipart([
        { name: 'crumb', content: 'test-crumb' },
        { name: 'evidenceCsv', filename: 'empty.csv', content: '   ' }
      ])
      const { statusCode, result } = await server.inject({
        method: 'POST',
        url,
        headers: { cookie: 'crumb=test-crumb', 'content-type': contentType },
        payload
      })
      expect(statusCode).toBe(400)
      expect(pageTitle(result)).toMatch(/^Error: /)
      expect(result.indexOf('govuk-error-summary')).toBeLessThan(
        result.indexOf('<h1')
      )
      expect(result).toContain('href="#evidenceCsv"')
      expect(result).toContain('id="evidenceCsv-error"')
      const input = openingTag(result, 'evidenceCsv')
      expect(input).toContain('govuk-file-upload--error')
      expect(input).toContain('accept=".csv,text/csv"')
      expect(input).toMatch(/aria-describedby="[^"]*evidenceCsv-error/)
    })
  })
})
