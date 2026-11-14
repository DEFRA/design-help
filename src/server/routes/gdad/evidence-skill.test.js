import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { MAX_EVIDENCE_LENGTH } from '#/server/common/helpers/gdad/constants.js'

/*
 * Route-level checks of the designer's own skill pages: reading their
 * evidence, and the separate page for editing it. The signed-in user and
 * the backend are both faked, so no live data is touched.
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
    saveGdadEvidence: vi.fn(async () => ({})),
    saveGdadScores: vi.fn()
  }
}))

const ids = {
  designer: 'a00000000000000000000021',
  accessibility: 'a00000000000000000000022',
  noProfile: 'a00000000000000000000023'
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
  designer: sessionUser(ids.designer),
  accessibility: sessionUser(ids.accessibility, {
    role: 'Accessibility Specialist (SEO)'
  }),
  noProfile: sessionUser(ids.noProfile)
}

const SAVED_EVIDENCE = [
  'Situation: a made-up service',
  '',
  '- First thing I did',
  '- Second thing I did'
].join('\n')

function basePeople() {
  return [
    {
      id: ids.designer,
      name: 'Made Up Designer',
      role: 'Interaction Designer',
      managerId: null,
      gdad: {
        design_communication: {
          evidenceText: SAVED_EVIDENCE,
          // 10:30 in London (summer time)
          evidenceUpdatedAt: '2026-07-01T09:30:00.000Z'
        }
      }
    },
    {
      id: ids.accessibility,
      name: 'Made Up Accessibility',
      role: 'Accessibility Specialist (SEO)',
      managerId: null,
      gdad: {}
    },
    { id: ids.noProfile, name: '', role: '', gdad: {} }
  ]
}

const READ_URL = '/my-gdad-evidence/design_communication'
const EDIT_URL = `${READ_URL}/edit`
const EMPTY_READ_URL = '/my-gdad-evidence/iterative_design'
const CRUMB = 'test-crumb'
const FIELD = 'evidence_design_communication'

describe('#gdadEvidenceRoutes skill pages', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    mockState.people = basePeople()
    mockState.user = users.designer
    vi.mocked(backendApi.saveGdadEvidence).mockClear()
  })

  function get(url) {
    return server.inject({ method: 'GET', url })
  }

  function post(url, fields, { crumb = CRUMB } = {}) {
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: `crumb=${CRUMB}` },
      payload: crumb === null ? fields : { crumb, ...fields }
    })
  }

  describe('Reading evidence', () => {
    test('Shows the evidence as page content, not in a text box', async () => {
      const { statusCode, result } = await get(READ_URL)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Evidence (STAR)')
      expect(result).toContain('<ul class="govuk-list govuk-list--bullet">')
      expect(result).toContain('<li>First thing I did</li>')
      expect(result).not.toContain('<textarea')
      expect(result).not.toContain(`name="${FIELD}"`)
      expect(result).not.toContain('Save evidence')
    })

    test('Says when it was last updated, in UK time', async () => {
      const { result } = await get(READ_URL)
      expect(result).toContain('Last updated 1 Jul 2026, 10:30')
    })

    test('Links to the edit page with a secondary button', async () => {
      const { result } = await get(READ_URL)
      expect(result).toMatch(
        /<a href="\/my-gdad-evidence\/design_communication\/edit"[^>]*class="govuk-button govuk-button--secondary"[^>]*>\s*Edit evidence\s*<\/a>/
      )
      expect(result).not.toContain('Add evidence')
    })

    test('Without evidence, says so and offers to add some', async () => {
      const { statusCode, result } = await get(EMPTY_READ_URL)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('You haven’t added evidence for this skill yet.')
      expect(result).toMatch(
        /<a href="\/my-gdad-evidence\/iterative_design\/edit"[^>]*class="govuk-button"[^>]*>\s*Add evidence\s*<\/a>/
      )
      expect(result).not.toContain('Edit evidence')
      expect(result).not.toContain('Last updated')
      expect(result).not.toContain('<textarea')
    })

    test('The summary page links each skill to its reading page', async () => {
      const { result } = await get('/my-gdad-evidence')
      expect(result).toContain(`href="${READ_URL}"`)
      expect(result).not.toContain(`href="${EDIT_URL}"`)
    })

    test('An unknown skill is not found', async () => {
      expect((await get('/my-gdad-evidence/not_a_skill')).statusCode).toBe(
        statusCodes.notFound
      )
      expect((await get('/my-gdad-evidence/not_a_skill/edit')).statusCode).toBe(
        statusCodes.notFound
      )
    })
  })

  describe('Editing evidence', () => {
    test('Has the evidence box, filled in with the saved evidence', async () => {
      const { statusCode, result } = await get(EDIT_URL)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('data-module="govuk-character-count"')
      expect(result).toContain('data-maxlength="12000"')
      expect(result).toMatch(new RegExp(`<textarea[^>]*name="${FIELD}"`))
      expect(result).toContain('First thing I did')
      expect(result).toContain(`action="${EDIT_URL}"`)
      expect(result).toMatch(/name="crumb" value="[^"]+"/)
      expect(result).toContain('Save evidence')
      expect(result).toContain(
        `<a class="govuk-link" href="${READ_URL}">Cancel</a>`
      )
      expect(result).toContain(`class="govuk-back-link" href="${READ_URL}"`)
      expect(result).toContain('· Edit evidence</span>')
      expect(result).toMatch(/<title>\s*Edit evidence: /)
    })

    test('Saving goes back to the reading page with a banner', async () => {
      const { statusCode, headers } = await post(EDIT_URL, {
        [FIELD]: '  Situation: new evidence  '
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(`${READ_URL}?saved=1`)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledWith(ids.designer, {
        design_communication: 'Situation: new evidence'
      })

      const { result } = await get(headers.location)
      expect(result).toContain('govuk-notification-banner--success')
      expect(result).toContain('Evidence saved')
    })

    test('The old form address still saves', async () => {
      const { statusCode, headers } = await post(READ_URL, {
        [FIELD]: 'Situation: from the old address'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(`${READ_URL}?saved=1`)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledTimes(1)
    })

    test('Saving the same evidence again changes nothing', async () => {
      const { statusCode, headers } = await post(EDIT_URL, {
        [FIELD]: SAVED_EVIDENCE.replace(/\n/g, '\r\n')
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(`${READ_URL}?unchanged=1`)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()

      const { result } = await get(headers.location)
      expect(result).toContain('Your evidence was not changed.')
      expect(result).not.toContain('Evidence saved')
    })

    test('Too-long evidence shows the edit page again, keeping the text', async () => {
      const tooLong = 'y'.repeat(MAX_EVIDENCE_LENGTH + 1)
      const { statusCode, result } = await post(EDIT_URL, {
        [FIELD]: tooLong
      })
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain('Evidence must be 12,000 characters or fewer')
      expect(result).toMatch(new RegExp(`<textarea[^>]*name="${FIELD}"`))
      expect(result).toContain(tooLong)
      expect(result).toContain('· Edit evidence</span>')
      expect(result).toMatch(/<title>\s*Error: Edit evidence: /)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })
  })

  describe('Who can use these pages', () => {
    test.each([READ_URL, EDIT_URL])(
      'Sends signed-out visitors to sign in from %s',
      async (url) => {
        mockState.user = null
        const { statusCode, headers } = await get(url)
        expect(statusCode).toBe(302)
        expect(headers.location).toBe('/sign-in')
      }
    )

    test.each([READ_URL, EDIT_URL])(
      'Shows job titles not on the GDaD path the not-applicable page at %s',
      async (url) => {
        mockState.user = users.accessibility
        const { statusCode, result } = await get(url)
        expect(statusCode).toBe(statusCodes.forbidden)
        expect(result).not.toContain('<textarea')
      }
    )

    test('Refuses a save from a job title not on the GDaD path', async () => {
      mockState.user = users.accessibility
      const { statusCode } = await post(EDIT_URL, { [FIELD]: 'Situation: x' })
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Refuses a save from someone signed out', async () => {
      mockState.user = null
      const { statusCode, headers } = await post(EDIT_URL, {
        [FIELD]: 'Situation: x'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/sign-in')
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Sends someone with no profile to create one', async () => {
      mockState.user = users.noProfile
      const { statusCode, headers } = await get(EDIT_URL)
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/my-profile/edit')
    })

    test.each([EDIT_URL, READ_URL])(
      'Refuses a save to %s without the CSRF token',
      async (url) => {
        const { statusCode } = await post(
          url,
          { [FIELD]: 'Situation: x' },
          { crumb: null }
        )
        expect(statusCode).toBe(statusCodes.forbidden)
        expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
      }
    )

    test('Refuses a save with the wrong CSRF token', async () => {
      const { statusCode } = await post(
        EDIT_URL,
        { [FIELD]: 'Situation: x' },
        { crumb: 'not-the-cookie-value' }
      )
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })
  })
})
