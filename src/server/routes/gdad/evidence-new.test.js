import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import {
  BackendApiError,
  backendApi
} from '#/server/common/helpers/backend-api.js'
import { MAX_EVIDENCE_LENGTH } from '#/server/common/helpers/gdad/constants.js'

/*
 * New evidence: evidence towards the next review, kept beside the
 * current (scored) evidence until the Head of Design scores it. The
 * signed-in user and the backend are both faked, so no live data is
 * touched.
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

vi.mock('#/server/common/helpers/backend-api.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    backendApi: {
      listPeople: async () => mockState.people,
      getPerson: async (id) =>
        mockState.people.find((person) => person.id === id) ?? null,
      saveGdadEvidence: vi.fn(async () => ({})),
      saveGdadNewEvidence: vi.fn(async () => ({})),
      saveGdadScores: vi.fn(async () => ({}))
    }
  }
})

const ids = {
  designer: 'a00000000000000000000031',
  otherDesigner: 'a00000000000000000000032',
  manager: 'a00000000000000000000033',
  hod: 'a00000000000000000000034'
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
  otherDesigner: sessionUser(ids.otherDesigner),
  manager: sessionUser(ids.manager, { isLineManager: true }),
  hod: sessionUser(ids.hod, {
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  })
}

const SCORED_AT = '2026-09-15T09:00:00.000Z'

/** A skill entry in the new backend's shape: every key, even as null. */
function entry(fields = {}) {
  return {
    evidenceText: '',
    evidenceUpdatedAt: null,
    evidenceUpdatedById: null,
    officialScore: null,
    scoredAt: null,
    newEvidenceText: null,
    newEvidenceUpdatedAt: null,
    newEvidenceUpdatedById: null,
    previous: [],
    ...fields
  }
}

const SCORED = entry({
  evidenceText: 'Situation: the scored evidence',
  evidenceUpdatedAt: '2026-08-01T09:00:00.000Z',
  officialScore: 2,
  scoredAt: SCORED_AT
})

const WITH_NEW = entry({
  ...SCORED,
  newEvidenceText: 'Situation: working towards next year',
  newEvidenceUpdatedAt: '2026-11-01T10:00:00.000Z',
  newEvidenceUpdatedById: ids.designer,
  previous: [
    {
      evidenceText: 'Situation: last year’s evidence',
      evidenceUpdatedAt: '2025-08-01T09:00:00.000Z',
      officialScore: 3,
      scoredAt: '2025-09-20T09:00:00.000Z',
      scoredById: ids.hod,
      archivedAt: '2026-09-15T09:00:00.000Z'
    },
    {
      evidenceText: 'Situation: the oldest evidence',
      evidenceUpdatedAt: '2024-08-01T09:00:00.000Z',
      officialScore: null,
      scoredAt: null,
      scoredById: null,
      archivedAt: '2025-09-20T09:00:00.000Z'
    }
  ]
})

function designerWith(gdad, id = ids.designer, name = 'Made Up Designer') {
  return {
    id,
    name,
    role: 'Interaction Designer',
    managerId: ids.manager,
    gdad
  }
}

function setPeople(gdad) {
  mockState.people = [
    designerWith(gdad),
    designerWith({}, ids.otherDesigner, 'Other Designer'),
    {
      id: ids.manager,
      name: 'Made Up Manager',
      role: 'Senior Interaction Designer',
      managerId: null,
      gdad: {}
    },
    {
      id: ids.hod,
      name: 'Made Up Head',
      role: 'Head of Design',
      managerId: null,
      gdad: {}
    }
  ]
}

const SKILL = 'design_communication'
const OWN = `/my-gdad-evidence/${SKILL}`
const BEHALF = `/review/gdad-evidence/${ids.designer}/${SKILL}`
const FIELD = `evidence_${SKILL}`
const CRUMB = 'test-crumb'

describe('#gdad new evidence', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    setPeople({ [SKILL]: SCORED })
    mockState.user = users.designer
  })

  function get(url, user = mockState.user) {
    mockState.user = user
    return server.inject({ method: 'GET', url })
  }

  function post(url, fields = {}, { crumb = CRUMB, user } = {}) {
    if (user) {
      mockState.user = user
    }
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: `crumb=${CRUMB}` },
      payload: crumb === null ? fields : { crumb, ...fields }
    })
  }

  describe('The designer’s skill page', () => {
    test('No evidence: offers to add some', async () => {
      setPeople({})
      const { result } = await get(OWN)
      expect(result).toContain('You haven’t added evidence for this skill yet.')
      expect(result).toContain('Add evidence')
      expect(result).not.toContain('Start new evidence')
      expect(result).not.toContain('Previous evidence')
    })

    test('Evidence not yet scored: one Edit evidence button', async () => {
      setPeople({ [SKILL]: entry({ evidenceText: 'Situation: unscored' }) })
      const { result } = await get(OWN)
      expect(result).toMatch(
        /href="\/my-gdad-evidence\/design_communication\/edit"[^>]*class="govuk-button govuk-button--secondary"[^>]*>\s*Edit evidence\s*</
      )
      expect(result).not.toContain('Start new evidence')
      expect(result).not.toContain('Edit existing evidence')
      expect(result).not.toContain('Scored ')
    })

    test('Scored, no new evidence: score line, start new and edit existing', async () => {
      const { result } = await get(OWN)
      expect(result).toContain('Situation: the scored evidence')
      expect(result).toContain('Scored 2 — At standard on 15 September 2026')
      expect(result).toContain(
        'Start new evidence when you’re working towards your next review. Your current score stays until the new evidence is scored.'
      )
      expect(result).toMatch(
        /href="\/my-gdad-evidence\/design_communication\/new"[^>]*class="govuk-button"[^>]*>\s*Start new evidence\s*</
      )
      expect(result).toMatch(
        /href="\/my-gdad-evidence\/design_communication\/edit"[^>]*class="govuk-button govuk-button--secondary"[^>]*>\s*Edit existing evidence\s*</
      )
      expect(result).not.toContain('New evidence</strong>')
    })

    test('New evidence: new, then current, then previous evidence', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(OWN)
      const at = (text) => {
        const i = result.indexOf(text)
        expect(i, text).toBeGreaterThan(-1)
        return i
      }
      expect(at('>Evidence for your next review</h2>')).toBeLessThan(
        at('Situation: working towards next year')
      )
      expect(at('Situation: working towards next year')).toBeLessThan(
        at('>Current evidence</h2>')
      )
      expect(at('>Current evidence</h2>')).toBeLessThan(
        at('Situation: the scored evidence')
      )
      expect(at('Situation: the scored evidence')).toBeLessThan(
        at('>Previous evidence</h2>')
      )
      // The tag sits outside the heading, so it is not read out twice
      expect(result).toContain(
        '<p class="govuk-body"><strong class="govuk-tag govuk-tag--blue">New evidence</strong></p>'
      )
      expect(result).not.toMatch(/<h2[^>]*>[^<]*<strong/)
      expect(result).toContain('Last updated 1 Nov 2026, 10:00')
      expect(result).toContain(
        'Your current score of 2 (15 September 2026) is based on this evidence, not your new evidence.'
      )
      expect(result).toMatch(
        /href="\/my-gdad-evidence\/design_communication\/new"[^>]*class="govuk-button govuk-button--secondary"[^>]*>\s*Edit new evidence\s*</
      )
      expect(result).toContain(
        '<a class="govuk-link" href="/my-gdad-evidence/design_communication/discard-new">Discard new evidence</a>'
      )
      // The current evidence is read-only while there is new evidence
      expect(result).not.toContain(`href="${OWN}/edit"`)
      expect(result).not.toContain('Start new evidence')
    })

    test('Previous evidence: one details per entry, newest first', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(OWN)
      const first = result.indexOf(
        'Scored 3 — Above standard on 20 September 2025'
      )
      const second = result.search(/Not scored\s*<\/span>/)
      expect(first).toBeGreaterThan(-1)
      expect(second).toBeGreaterThan(first)
      expect(result.match(/govuk-details__summary-text/g)).toHaveLength(2)
      expect(result).toContain('Situation: last year’s evidence')
      expect(result).toContain(
        'Moved to previous evidence on 15 September 2026'
      )
      expect(result).toContain(
        'Moved to previous evidence on 20 September 2025'
      )
    })

    test('Old backend without the new keys: no Start new evidence', async () => {
      setPeople({
        [SKILL]: {
          evidenceText: 'Situation: the scored evidence',
          officialScore: 2,
          scoredAt: SCORED_AT
        }
      })
      const { result } = await get(OWN)
      expect(result).toContain('Edit evidence')
      expect(result).not.toContain('Start new evidence')
      expect(result).not.toContain('Edit existing evidence')
      expect(result).not.toContain('Previous evidence')
      expect((await get(`${OWN}/new`)).headers.location).toBe(OWN)
    })

    test('The summary table tags the skill and notes the score', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get('/my-gdad-evidence')
      expect(result).toContain(
        'govuk-tag govuk-tag--blue govuk-!-display-block govuk-!-margin-top-1 gdad-tag-fit">New evidence</strong>'
      )
      expect(result).toContain('Based on last scored evidence')
      expect(result).not.toContain('Evidence changed since scored')
    })
  })

  describe('Starting and editing new evidence', () => {
    test('Starts blank, with its own caption and form', async () => {
      const { statusCode, result } = await get(`${OWN}/new`)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Made Up Designer · New evidence</span>')
      expect(result).toMatch(/<title>\s*New evidence: Design communication/)
      expect(result).toContain(`action="${OWN}/new"`)
      expect(result).toMatch(/name="crumb" value="[^"]+"/)
      expect(result).toContain('data-maxlength="12000"')
      expect(result).toMatch(
        new RegExp(`<textarea[^>]*name="${FIELD}"[^>]*>\\s*</textarea>`)
      )
      expect(result).toContain('Save new evidence')
    })

    test('Is prefilled when there is new evidence', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(`${OWN}/new`)
      expect(result).toMatch(
        new RegExp(
          `<textarea[^>]*name="${FIELD}"[^>]*>\\s*Situation: working towards next year`
        )
      )
    })

    test('Is not offered before the current evidence is scored', async () => {
      setPeople({ [SKILL]: entry({ evidenceText: 'Situation: unscored' }) })
      expect((await get(`${OWN}/new`)).headers.location).toBe(OWN)
      const { headers } = await post(`${OWN}/new`, { [FIELD]: 'Situation: x' })
      expect(headers.location).toBe(OWN)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
    })

    test('Saving goes back with a banner, saying who saved it', async () => {
      const { statusCode, headers } = await post(`${OWN}/new`, {
        [FIELD]: '  Situation: next year  '
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(`${OWN}?saved=new`)
      expect(backendApi.saveGdadNewEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 'Situation: next year' },
        ids.designer
      )
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
      const { result } = await get(headers.location)
      expect(result).toContain('govuk-notification-banner--success')
      expect(result).toContain('New evidence saved')
    })

    test('Saving the same new evidence again changes nothing', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { headers } = await post(`${OWN}/new`, {
        [FIELD]: 'Situation: working towards next year\r\n'
      })
      expect(headers.location).toBe(`${OWN}?unchanged=new`)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
      const { result } = await get(headers.location)
      expect(result).toContain('Your new evidence was not changed.')
    })

    test('Saving it blank discards the new evidence', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { headers } = await post(`${OWN}/new`, { [FIELD]: '   ' })
      expect(headers.location).toBe(`${OWN}?discarded=new`)
      expect(backendApi.saveGdadNewEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: '' },
        ids.designer
      )
    })

    test('Too-long new evidence comes back with an error, keeping the text', async () => {
      const tooLong = 'z'.repeat(MAX_EVIDENCE_LENGTH + 1)
      const { statusCode, result } = await post(`${OWN}/new`, {
        [FIELD]: tooLong
      })
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('Evidence must be 12,000 characters or fewer')
      expect(result).toContain(tooLong)
      expect(result).toMatch(/<title>\s*Error: New evidence: /)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
    })

    test('A save the backend refuses goes back to the skill page', async () => {
      vi.mocked(backendApi.saveGdadNewEvidence).mockRejectedValueOnce(
        new BackendApiError(409, 'no_current_evidence')
      )
      const { statusCode, headers } = await post(`${OWN}/new`, {
        [FIELD]: 'Situation: x'
      })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe(OWN)
    })

    test.each([`${OWN}/new`, `${OWN}/discard-new`])(
      'Refuses a save to %s without the CSRF token',
      async (url) => {
        setPeople({ [SKILL]: WITH_NEW })
        const { statusCode } = await post(
          url,
          { [FIELD]: 'Situation: x' },
          { crumb: null }
        )
        expect(statusCode).toBe(statusCodes.forbidden)
        expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
      }
    )
  })

  describe('Discarding new evidence', () => {
    beforeEach(() => {
      setPeople({ [SKILL]: WITH_NEW })
    })

    test('Asks first, with a warning button', async () => {
      const { statusCode, result } = await get(`${OWN}/discard-new`)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(
        'Are you sure you want to discard your new evidence?'
      )
      expect(result).toContain(
        'This deletes your new evidence for Design communication. Your current evidence and score aren’t affected.'
      )
      expect(result).toContain('govuk-button--warning')
      expect(result).toContain(`action="${OWN}/discard-new"`)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
    })

    test('Discards and says so', async () => {
      const { headers } = await post(`${OWN}/discard-new`)
      expect(headers.location).toBe(`${OWN}?discarded=new`)
      expect(backendApi.saveGdadNewEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: '' },
        ids.designer
      )
      const { result } = await get(headers.location)
      expect(result).toContain('New evidence discarded')
    })

    test('With no new evidence, there is nothing to discard', async () => {
      setPeople({ [SKILL]: SCORED })
      expect((await get(`${OWN}/discard-new`)).headers.location).toBe(OWN)
      expect((await post(`${OWN}/discard-new`)).headers.location).toBe(OWN)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
    })
  })

  describe('Editing the current evidence', () => {
    test('With an old-backend record, a save from the skill page does not say who saved it', async () => {
      setPeople({
        [SKILL]: {
          evidenceText: 'Situation: the scored evidence',
          officialScore: 2,
          scoredAt: SCORED_AT
        }
      })
      const { headers } = await post(`${OWN}/edit`, {
        [FIELD]: 'Situation: a correction'
      })
      expect(headers.location).toBe(`${OWN}?saved=1`)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledTimes(1)
      expect(backendApi.saveGdadEvidence.mock.calls[0]).toEqual([
        ids.designer,
        { [SKILL]: 'Situation: a correction' },
        undefined
      ])
    })

    test('Is blocked while there is new evidence', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      expect((await get(`${OWN}/edit`)).headers.location).toBe(OWN)
      const { headers } = await post(`${OWN}/edit`, { [FIELD]: 'Situation: x' })
      expect(headers.location).toBe(OWN)
      expect(
        (await post(OWN, { [FIELD]: 'Situation: x' })).headers.location
      ).toBe(OWN)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Edit existing evidence saves the current evidence, saying who saved it', async () => {
      const { headers } = await post(`${OWN}/edit`, {
        [FIELD]: 'Situation: a correction'
      })
      expect(headers.location).toBe(`${OWN}?saved=1`)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 'Situation: a correction' },
        ids.designer
      )
    })
  })

  describe('Head of Design on the designer’s behalf', () => {
    test('Sees the same sections with the controls', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { statusCode, result } = await get(BEHALF, users.hod)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('>Evidence for their next review</h2>')
      expect(result).toContain('govuk-tag--blue">New evidence</strong>')
      expect(result).toContain(
        'The current score of 2 (15 September 2026) is based on this evidence, not the new evidence.'
      )
      expect(result).toContain('>Previous evidence</h2>')
      expect(result).toContain(`href="${BEHALF}/new"`)
      expect(result).toContain(`href="${BEHALF}/discard-new"`)
    })

    test('Gets the score label and hint for new evidence, starting blank', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(BEHALF, users.hod)
      expect(result).toContain('Score for the new evidence')
      expect(result).toContain(
        'Saving a score moves the current evidence and its score to Previous evidence.'
      )
      expect(result).toMatch(
        /<option value="" selected>Not scored yet<\/option>/
      )
      expect(result).not.toMatch(/<option value="2" selected>/)
    })

    test('Without new evidence, the score label is as before', async () => {
      const { result } = await get(BEHALF, users.hod)
      expect(result).toContain('Change score')
      expect(result).not.toContain('Score for the new evidence')
      expect(result).toContain(
        'Start new evidence when Made Up Designer is working towards their next review. Their current score stays until the new evidence is scored.'
      )
    })

    test('May start new evidence, saved as the Head of Design', async () => {
      expect((await get(`${BEHALF}/new`, users.hod)).statusCode).toBe(
        statusCodes.ok
      )
      const { headers } = await post(`${BEHALF}/new`, {
        [FIELD]: 'Situation: from the review'
      })
      expect(headers.location).toBe(`${BEHALF}?evidence=new-saved`)
      expect(backendApi.saveGdadNewEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 'Situation: from the review' },
        ids.hod
      )
      const { result } = await get(headers.location)
      expect(result).toContain('New evidence saved')
    })

    test('May edit the current evidence, saved as the Head of Design', async () => {
      const { result } = await get(`${BEHALF}/edit`, users.hod)
      expect(result).toContain('Made Up Designer · Edit evidence</span>')
      expect(result).toContain(`action="${BEHALF}/edit"`)
      const { headers } = await post(`${BEHALF}/edit`, {
        [FIELD]: 'Situation: corrected'
      })
      expect(headers.location).toBe(`${BEHALF}?evidence=saved`)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 'Situation: corrected' },
        ids.hod
      )
    })

    test('May discard new evidence', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(`${BEHALF}/discard-new`, users.hod)
      expect(result).toContain(
        'Are you sure you want to discard Made Up Designer’s new evidence?'
      )
      expect(result).toContain(
        'This deletes Made Up Designer’s new evidence for Design communication. Their current evidence and score aren’t affected.'
      )
      const { headers } = await post(`${BEHALF}/discard-new`)
      expect(headers.location).toBe(`${BEHALF}?evidence=new-discarded`)
      expect(backendApi.saveGdadNewEvidence).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: '' },
        ids.hod
      )
    })

    test('The person page tags the skill and notes the score', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get(
        `/review/gdad-evidence/${ids.designer}`,
        users.hod
      )
      expect(result).toContain('gdad-tag-fit">New evidence</strong>')
      expect(result).toContain('Based on last scored evidence')
      expect(result).toContain(
        'Score for the new evidence for Design communication'
      )
    })

    test('My team counts new evidence as needing attention', async () => {
      setPeople({ [SKILL]: WITH_NEW })
      const { result } = await get('/my-team', users.hod)
      expect(result).toContain('1 designer needs your attention')
    })
  })

  describe('Scoring new evidence', () => {
    // What the scoring page showed for the new evidence
    const SEEN_NEW = { [`seen_${SKILL}`]: WITH_NEW.newEvidenceUpdatedAt }
    const SEEN_NONE = { [`seen_${SKILL}`]: 'none' }
    const PERSON = `/review/gdad-evidence/${ids.designer}`

    beforeEach(() => {
      setPeople({ [SKILL]: WITH_NEW })
      mockState.user = users.hod
    })

    test.each([BEHALF, PERSON])(
      'The page at %s records the new evidence it showed',
      async (url) => {
        const { result } = await get(url)
        expect(result).toContain(
          `<input type="hidden" name="seen_${SKILL}" value="${WITH_NEW.newEvidenceUpdatedAt}">`
        )
        setPeople({ [SKILL]: SCORED })
        expect((await get(url)).result).toContain(
          `<input type="hidden" name="seen_${SKILL}" value="none">`
        )
      }
    )

    test.each([BEHALF, PERSON])(
      '(a) New evidence discarded while %s was open: blank does not wipe the score',
      async (url) => {
        setPeople({ [SKILL]: SCORED })
        const { headers } = await post(url, {
          ...SEEN_NEW,
          [`score_${SKILL}`]: ''
        })
        expect(headers.location).toBe(`${url}?err=concurrent`)
        expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
      }
    )

    test.each([BEHALF, PERSON])(
      '(b) New evidence started while %s was open: the old score is not sent',
      async (url) => {
        const { headers } = await post(url, {
          ...SEEN_NONE,
          [`score_${SKILL}`]: '2'
        })
        expect(headers.location).toBe(`${url}?err=concurrent`)
        expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
      }
    )

    test.each([BEHALF, PERSON])(
      '(c) New evidence edited after %s was read: the score is not saved',
      async (url) => {
        const { headers } = await post(url, {
          [`seen_${SKILL}`]: '2026-10-01T08:00:00.000Z',
          [`score_${SKILL}`]: '3'
        })
        expect(headers.location).toBe(`${url}?err=concurrent`)
        expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
        const { result } = await get(headers.location)
        expect(result).toContain(
          'Someone else changed this evidence just now. Try again.'
        )
      }
    )

    test('A skill elsewhere in the table changing also stops the whole-table save', async () => {
      const { headers } = await post(PERSON, {
        [`seen_iterative_design`]: '2026-10-01T08:00:00.000Z',
        ...SEEN_NEW,
        [`score_${SKILL}`]: '3'
      })
      expect(headers.location).toBe(`${PERSON}?err=concurrent`)
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test('Nothing changed meanwhile: scores save as normal', async () => {
      setPeople({ [SKILL]: SCORED })
      const { headers } = await post(BEHALF, {
        ...SEEN_NONE,
        [`score_${SKILL}`]: '3'
      })
      expect(headers.location).not.toContain('err=')
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 3 },
        ids.hod
      )
    })

    test('The same score as before still saves, because it scores the new evidence', async () => {
      const { headers } = await post(BEHALF, {
        ...SEEN_NEW,
        [`score_${SKILL}`]: '2'
      })
      expect(headers.location).not.toContain('saved=none')
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.designer,
        { [SKILL]: 2 },
        ids.hod
      )
    })

    test('Leaving it blank does not clear the current score', async () => {
      const { headers } = await post(BEHALF, {
        ...SEEN_NEW,
        [`score_${SKILL}`]: ''
      })
      expect(headers.location).toBe(`${BEHALF}?saved=none`)
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test('Saving the whole table leaves blank new-evidence skills alone', async () => {
      const { headers } = await post(PERSON, {
        ...SEEN_NEW,
        [`score_${SKILL}`]: ''
      })
      expect(headers.location).toContain('saved=none')
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test('Someone else saving at the same time shows a friendly error', async () => {
      vi.mocked(backendApi.saveGdadScores).mockRejectedValueOnce(
        new BackendApiError(409, 'concurrent_update')
      )
      const { headers } = await post(BEHALF, {
        ...SEEN_NEW,
        [`score_${SKILL}`]: '3'
      })
      expect(headers.location).toBe(`${BEHALF}?err=concurrent`)
      const { result } = await get(headers.location)
      expect(result).toContain(
        'Someone else changed this evidence just now. Try again.'
      )
    })
  })

  describe('Who may change evidence on someone’s behalf', () => {
    const writeUrls = [
      ['GET', `${BEHALF}/edit`],
      ['GET', `${BEHALF}/new`],
      ['GET', `${BEHALF}/discard-new`],
      ['POST', `${BEHALF}/edit`],
      ['POST', `${BEHALF}/new`],
      ['POST', `${BEHALF}/discard-new`]
    ]

    beforeEach(() => {
      setPeople({ [SKILL]: WITH_NEW })
    })

    test.each(writeUrls)(
      'A line manager is refused %s %s',
      async (method, url) => {
        mockState.user = users.manager
        const { statusCode } =
          method === 'GET'
            ? await get(url)
            : await post(url, { [FIELD]: 'Situation: x' })
        expect(statusCode).toBe(statusCodes.forbidden)
        expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
        expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
      }
    )

    test.each(writeUrls)(
      'Another designer is refused %s %s',
      async (method, url) => {
        mockState.user = users.otherDesigner
        const { statusCode } =
          method === 'GET'
            ? await get(url)
            : await post(url, { [FIELD]: 'Situation: x' })
        expect(statusCode).toBe(statusCodes.forbidden)
        expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
        expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
      }
    )

    test('A line manager sees everything read-only', async () => {
      const { statusCode, result } = await get(BEHALF, users.manager)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('>Evidence for their next review</h2>')
      expect(result).toContain('govuk-tag--blue">New evidence</strong>')
      expect(result).toContain('>Current evidence</h2>')
      expect(result).toContain('>Previous evidence</h2>')
      expect(result).not.toContain('Edit new evidence')
      expect(result).not.toContain('Discard new evidence')
      expect(result).not.toContain(`href="${BEHALF}/`)
      expect(result).not.toContain('Score for the new evidence')
    })

    test('A line manager gets no Start new evidence', async () => {
      setPeople({ [SKILL]: SCORED })
      const { result } = await get(BEHALF, users.manager)
      expect(result).not.toContain('Start new evidence')
      expect(result).not.toContain('Edit existing evidence')
    })

    test('The Head of Design is refused CSRF-less saves', async () => {
      mockState.user = users.hod
      const { statusCode } = await post(
        `${BEHALF}/new`,
        { [FIELD]: 'Situation: x' },
        { crumb: null }
      )
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadNewEvidence).not.toHaveBeenCalled()
    })
  })
})
