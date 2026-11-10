import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { sendScoresUpdatedEmail } from '#/server/common/helpers/notify.js'
import {
  buildScoresEmailPanel,
  formatNotifiedDate,
  possessive,
  scoresNotifyStatus,
  withSavedScores
} from './scores-notify.js'

/*
 * The Head of Design's "Email <name> to tell them their scores have been
 * updated" button. The signed-in user, the backend and the email sender
 * are all faked, so no live data is touched and no email is sent.
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
    listPeople: vi.fn(async () => mockState.people),
    getPerson: vi.fn(
      async (id) => mockState.people.find((person) => person.id === id) ?? null
    ),
    saveGdadScores: vi.fn(),
    markGdadScoresNotified: vi.fn(async () => ({}))
  }
}))

vi.mock('#/server/common/helpers/notify.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    sendScoresUpdatedEmail: vi.fn(async () => {}),
    isScoresUpdatedNotifyConfigured: vi.fn(() => false)
  }
})

const ids = {
  hod: 'a00000000000000000000001',
  manager: 'a00000000000000000000002',
  designer: 'a00000000000000000000005',
  scored: 'b00000000000000000000001',
  alreadyTold: 'b00000000000000000000002',
  noScores: 'b00000000000000000000003',
  noManager: 'b00000000000000000000004',
  hodReport: 'b00000000000000000000005',
  legacy: 'b00000000000000000000006'
}

const users = {
  hod: {
    id: ids.hod,
    email: 'hod@example.test',
    name: 'Hana Head',
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true,
    isLineManager: true
  },
  manager: {
    id: ids.manager,
    email: 'manager@example.test',
    name: 'Mo Manager',
    role: 'Senior Interaction Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: true
  },
  admin: {
    id: 'a00000000000000000000004',
    email: 'admin@example.test',
    name: 'Al Admin',
    role: 'Interaction Designer',
    isAdmin: true,
    isHeadOfDesignSuperUser: false,
    isLineManager: false
  },
  designer: {
    id: ids.scored,
    email: 'ada@example.test',
    name: 'Ada Scored',
    role: 'Interaction Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false
  }
}

const scoredGdad = {
  design_communication: {
    evidenceText: 'Some evidence',
    officialScore: 3,
    scoredAt: '2026-11-05T10:00:00.000Z'
  },
  iterative_design: {
    evidenceText: 'More evidence',
    officialScore: 2,
    scoredAt: '2026-11-01T10:00:00.000Z'
  }
}

function buildPeople() {
  return [
    {
      id: ids.hod,
      email: 'hod@example.test',
      name: 'Hana Head',
      role: 'Head of Design',
      managerId: null,
      gdad: {}
    },
    {
      id: ids.manager,
      email: 'manager@example.test',
      name: 'Mo Manager',
      role: 'Senior Interaction Designer',
      managerId: null,
      gdad: {}
    },
    // Scored, never emailed (field missing, as on the older backend)
    {
      id: ids.scored,
      email: 'ada@example.test',
      name: 'Ada Scored',
      role: 'Interaction Designer',
      managerId: ids.manager,
      gdad: scoredGdad
    },
    // Emailed after the last score
    {
      id: ids.alreadyTold,
      email: 'bea@example.test',
      name: 'Bea Told',
      role: 'Interaction Designer',
      managerId: ids.manager,
      gdad: scoredGdad,
      gdadScoresNotifiedAt: '2026-11-06T09:00:00.000Z',
      gdadScoresNotifiedById: ids.hod
    },
    {
      id: ids.noScores,
      email: 'cy@example.test',
      name: 'Cy Unscored',
      role: 'Interaction Designer',
      managerId: ids.manager,
      gdad: {
        iterative_design: { evidenceText: 'Evidence only', officialScore: null }
      }
    },
    {
      id: ids.noManager,
      email: 'dee@example.test',
      name: 'Dee Unallocated',
      role: 'Service Designer',
      managerId: null,
      gdad: scoredGdad,
      gdadScoresNotifiedAt: null
    },
    // Managed by the Head of Design: no separate copy
    {
      id: ids.hodReport,
      email: 'hal@example.test',
      name: 'Hal Hod-Report',
      role: 'Senior Service Designer',
      managerId: ids.hod,
      gdad: scoredGdad
    }
  ]
}

const personUrl = (id) => `/review/gdad-evidence/${id}`
const notifyUrl = (id) => `/review/gdad-evidence/${id}/notify-scores`
const scoresSavedUrl = (id) => `/review/gdad-evidence/${id}/scores-saved`
const BUTTON_TEXT = 'to tell them their scores have been updated'
const SENTENCE =
  'to tell them their scores have been updated. The email links to their GDaD evidence in Design Help. It does not include their scores.'

/** The govukButton element with this exact text, and its classes. */
function buttonFor(html, text) {
  const match = html.match(
    new RegExp(`<button[^>]*class="([^"]*)"[^>]*>\\s*${text}\\s*</button>`)
  )
  return match ? { classes: match[1] } : null
}

/** Where the main heading starts, to check banners come before it. */
function h1Index(html) {
  return html.indexOf('<h1')
}

function sessionCookie(response) {
  const cookies = [response.headers['set-cookie'] ?? []].flat()
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

describe('#gdad scores-updated email', () => {
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
    sendScoresUpdatedEmail.mockImplementation(async () => {})
    backendApi.markGdadScoresNotified.mockImplementation(async () => ({}))
    backendApi.getPerson.mockImplementation(
      async (id) => mockState.people.find((person) => person.id === id) ?? null
    )
    mockState.people = buildPeople()
  })

  function get(user, url, cookie) {
    mockState.user = user
    return server.inject({
      method: 'GET',
      url,
      ...(cookie ? { headers: { cookie } } : {})
    })
  }

  function post(user, url, payload = {}) {
    mockState.user = user
    return server.inject({
      method: 'POST',
      url,
      headers: { cookie: 'crumb=test-crumb' },
      payload: { crumb: 'test-crumb', ...payload }
    })
  }

  async function postAndFollow(user, url) {
    const response = await post(user, url)
    expect(response.statusCode).toBe(302)
    const page = await get(
      user,
      response.headers.location,
      `crumb=test-crumb; ${sessionCookie(response)}`
    )
    return { response, page }
  }

  describe('Review page', () => {
    test('Head of Design sees the button, the copy-in hint and a crumb', async () => {
      const { statusCode, result } = await get(users.hod, personUrl(ids.scored))
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(`You can email Ada Scored ${SENTENCE}`)
      expect(buttonFor(result, 'Email Ada Scored').classes).toContain(
        'govuk-button--secondary'
      )
      expect(result).toContain(
        'Their line manager, Mo Manager, will be copied in.'
      )
      expect(result).toContain(`action="${notifyUrl(ids.scored)}"`)
      expect(result).toMatch(
        /notify-scores" novalidate>\s*<input type="hidden" name="crumb" value="[^"]+">/
      )
      expect(result).not.toContain('Last emailed on')
    })

    test('Shows when they were last emailed if scored again since', async () => {
      mockState.people.find(
        (p) => p.id === ids.alreadyTold
      ).gdadScoresNotifiedAt = '2026-11-03T09:00:00.000Z'
      const { result } = await get(users.hod, personUrl(ids.alreadyTold))
      expect(buttonFor(result, 'Email Bea Told')).not.toBeNull()
      expect(result).toContain('Last emailed on 3 November 2026.')
    })

    test('Says when they were emailed, with no button, if nothing is new', async () => {
      const { result } = await get(users.hod, personUrl(ids.alreadyTold))
      expect(result).toContain(
        'Bea Told was emailed about their scores on 6 November 2026.'
      )
      expect(result).not.toContain(BUTTON_TEXT)
    })

    test('Shows nothing when nothing has been scored', async () => {
      const { result } = await get(users.hod, personUrl(ids.noScores))
      expect(result).not.toContain(BUTTON_TEXT)
      expect(result).not.toContain('about their scores')
    })

    test('Leaves out the copy-in hint with no line manager, or when it is the Head of Design', async () => {
      for (const id of [ids.noManager, ids.hodReport]) {
        const { result } = await get(users.hod, personUrl(id))
        expect(result).toContain(BUTTON_TEXT)
        expect(result).not.toContain('will be copied in')
      }
    })

    test('Saved banner is just "Scores saved.", at the top, with no jump link', async () => {
      const { result } = await get(
        users.hod,
        `${personUrl(ids.scored)}?saved=1`
      )
      expect(result).toContain('Scores saved.')
      expect(result.indexOf('Scores saved.')).toBeLessThan(h1Index(result))
      expect(result).not.toContain('href="#scores-email"')
      // The bottom section is still there as a fallback
      expect(buttonFor(result, 'Email Ada Scored')).not.toBeNull()
    })

    test('Line manager does not see the button', async () => {
      const { statusCode, result } = await get(
        users.manager,
        personUrl(ids.scored)
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).not.toContain(BUTTON_TEXT)
      expect(result).not.toContain('notify-scores')
    })
  })

  describe('Sending', () => {
    test('Emails the designer and copies in their line manager, without scores', async () => {
      const { response, page } = await postAndFollow(
        users.hod,
        notifyUrl(ids.scored)
      )
      expect(response.headers.location).toBe(personUrl(ids.scored))

      const base = config.get('appBaseUrl')
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(2)
      expect(sendScoresUpdatedEmail).toHaveBeenNthCalledWith(
        1,
        'ada@example.test',
        {
          intro: 'Hana Head has updated your GDaD scores in Design Help.',
          link: `${base}/my-gdad-evidence`
        }
      )
      expect(sendScoresUpdatedEmail).toHaveBeenNthCalledWith(
        2,
        'manager@example.test',
        {
          intro:
            'Hana Head has updated the GDaD scores for Ada Scored in Design Help.',
          link: `${base}/review/gdad-evidence/${ids.scored}`
        }
      )
      const sent = JSON.stringify(sendScoresUpdatedEmail.mock.calls)
      expect(sent).not.toMatch(/officialScore|score_|Some evidence/)

      expect(backendApi.markGdadScoresNotified).toHaveBeenCalledWith(
        ids.scored,
        ids.hod
      )
      expect(page.result).toContain(
        'Email sent to Ada Scored. Mo Manager was copied in.'
      )
    })

    test('Success banner is at the very top, shown once, with no jump link', async () => {
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      const { result } = page
      const text = 'Email sent to Ada Scored. Mo Manager was copied in.'
      expect(result.split(text)).toHaveLength(2)
      expect(result.indexOf(text)).toBeLessThan(h1Index(result))
      expect(result).toContain('govuk-notification-banner--success')
      expect(result).not.toContain('href="#scores-email"')
    })

    test('Ignores any addresses in the form', async () => {
      await post(users.hod, notifyUrl(ids.scored), {
        email: 'someone-else@example.test',
        managerEmail: 'another@example.test'
      })
      const recipients = sendScoresUpdatedEmail.mock.calls.map(([to]) => to)
      expect(recipients).toEqual(['ada@example.test', 'manager@example.test'])
    })

    test('With no line manager, emails only the designer', async () => {
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.noManager))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(1)
      expect(sendScoresUpdatedEmail.mock.calls[0][0]).toBe('dee@example.test')
      expect(page.result).toContain('Email sent to Dee Unallocated.')
      expect(page.result).not.toContain('was copied in')
      expect(
        page.result.indexOf('Email sent to Dee Unallocated.')
      ).toBeLessThan(h1Index(page.result))
    })

    test('If the designer email fails, nothing is recorded and an error shows', async () => {
      sendScoresUpdatedEmail.mockRejectedValueOnce(new Error('notify down'))
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(1)
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
      const text = 'Couldn’t send the email to Ada Scored. Try again later.'
      expect(page.result).toContain(text)
      expect(page.result.indexOf(text)).toBeLessThan(h1Index(page.result))
    })

    test('If the line manager copy fails, still records and says so', async () => {
      sendScoresUpdatedEmail
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('notify down'))
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(backendApi.markGdadScoresNotified).toHaveBeenCalledTimes(1)
      const text = 'we couldn’t send the copy to Mo Manager'
      expect(page.result).toContain(text)
      expect(page.result.indexOf(text)).toBeLessThan(h1Index(page.result))
    })

    test('If recording fails, still shows success', async () => {
      backendApi.markGdadScoresNotified.mockRejectedValueOnce(
        new Error('not deployed')
      )
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(2)
      expect(page.result).toContain(
        'Email sent to Ada Scored. Mo Manager was copied in.'
      )
    })

    test('Sends nothing when there is nothing new to tell them', async () => {
      const response = await post(users.hod, notifyUrl(ids.alreadyTold))
      expect(response.statusCode).toBe(302)
      expect(sendScoresUpdatedEmail).not.toHaveBeenCalled()
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
    })

    test.each([
      ['line manager of the person', 'manager'],
      ['the designer themselves', 'designer'],
      ['plain admin who is not the Head of Design', 'admin']
    ])('Is refused (403) for the %s', async (_label, who) => {
      const response = await post(users[who], notifyUrl(ids.scored))
      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(sendScoresUpdatedEmail).not.toHaveBeenCalled()
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
    })

    test('Is refused without a crumb', async () => {
      mockState.user = users.hod
      const response = await server.inject({
        method: 'POST',
        url: notifyUrl(ids.scored)
      })
      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(sendScoresUpdatedEmail).not.toHaveBeenCalled()
    })
  })

  describe('After saving changed scores', () => {
    test.each([
      ['whole-person save', (id) => personUrl(id)],
      ['single-skill save', (id) => `${personUrl(id)}/design_communication`]
    ])('%s goes to the scores-saved page', async (_label, url) => {
      const response = await post(users.hod, url(ids.alreadyTold), {
        score_design_communication: '1',
        score_iterative_design: '2'
      })
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(scoresSavedUrl(ids.alreadyTold))
      expect(backendApi.saveGdadScores).toHaveBeenCalledTimes(1)
    })

    test('Scores-saved page offers one green Email button, with the line manager copied in', async () => {
      const { statusCode, result } = await get(
        users.hod,
        scoresSavedUrl(ids.scored)
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Scores saved for Ada Scored</h1>')
      expect(result).toContain(`You can email Ada Scored ${SENTENCE}`)
      expect(result).toContain(
        'Their line manager, Mo Manager, will be copied in.'
      )
      expect(result).toContain(`action="${notifyUrl(ids.scored)}"`)
      expect(result).toMatch(
        /notify-scores" novalidate>\s*<input type="hidden" name="crumb" value="[^"]+">/
      )
      const button = buttonFor(result, 'Email Ada Scored')
      expect(button).not.toBeNull()
      expect(button.classes).not.toContain('govuk-button--secondary')
      const main = result.slice(result.indexOf('<main'))
      expect(main.match(/<button/g)).toHaveLength(1)
      expect(result).toContain(
        `class="govuk-back-link" href="${personUrl(ids.scored)}"`
      )
      expect(result).toContain(
        `<a class="govuk-link" href="${personUrl(ids.scored)}">Not now, back to Ada Scored’s evidence</a>`
      )
    })

    test('Scores-saved page leaves out the copy-in line with no line manager', async () => {
      const { result } = await get(users.hod, scoresSavedUrl(ids.noManager))
      expect(result).toContain('Email Dee Unallocated')
      expect(result).not.toContain('will be copied in')
    })

    test('Scores-saved page goes back to the evidence page when already emailed', async () => {
      const response = await get(users.hod, scoresSavedUrl(ids.alreadyTold))
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(personUrl(ids.alreadyTold))
    })

    test.each([
      ['line manager of the person', 'manager'],
      ['the designer themselves', 'designer'],
      ['plain admin who is not the Head of Design', 'admin']
    ])('Scores-saved page is refused (403) for the %s', async (_label, who) => {
      const response = await get(users[who], scoresSavedUrl(ids.scored))
      expect(response.statusCode).toBe(statusCodes.forbidden)
    })
  })

  describe('Line manager lookup fails', () => {
    test('Page still shows the button, without the copy-in line, and sending still works', async () => {
      backendApi.getPerson.mockImplementation(async (id) => {
        if (id === ids.manager) {
          throw new Error('backend down')
        }
        return mockState.people.find((person) => person.id === id) ?? null
      })

      const { statusCode, result } = await get(users.hod, personUrl(ids.scored))
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain(BUTTON_TEXT)
      expect(result).not.toContain('will be copied in')

      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(1)
      expect(sendScoresUpdatedEmail.mock.calls[0][0]).toBe('ada@example.test')
      expect(page.result).toContain('Email sent to Ada Scored.')
    })
  })

  describe('Saving unchanged scores', () => {
    const allScores = {
      score_design_communication: '3',
      score_iterative_design: '2'
    }

    test('Whole-person save with nothing changed saves nothing and keeps the "emailed" state', async () => {
      const response = await post(
        users.hod,
        personUrl(ids.alreadyTold),
        allScores
      )
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(
        `${personUrl(ids.alreadyTold)}?saved=none`
      )
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()

      const { result } = await get(users.hod, response.headers.location)
      expect(result).toContain('No scores were changed.')
      expect(result).not.toContain('Scores saved.')
      expect(result).not.toContain(BUTTON_TEXT)
    })

    test('Whole-person save sends only the skills that changed', async () => {
      const response = await post(users.hod, personUrl(ids.alreadyTold), {
        ...allScores,
        score_iterative_design: '3'
      })
      expect(response.headers.location).toBe(scoresSavedUrl(ids.alreadyTold))
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.alreadyTold,
        { iterative_design: 3 },
        ids.hod
      )
    })

    test('Clearing a score counts as a change, but leaves nothing to email about', async () => {
      const response = await post(users.hod, personUrl(ids.alreadyTold), {
        score_design_communication: '3'
      })
      expect(response.headers.location).toBe(
        `${personUrl(ids.alreadyTold)}?saved=1`
      )
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.alreadyTold,
        { iterative_design: null },
        ids.hod
      )
    })

    test('Same score with evidence updated since it was scored is saved, and the email button comes back', async () => {
      const person = mockState.people.find((p) => p.id === ids.alreadyTold)
      person.gdad = {
        ...scoredGdad,
        iterative_design: {
          ...scoredGdad.iterative_design,
          evidenceUpdatedAt: '2026-11-02T10:00:00.000Z'
        }
      }

      const response = await post(
        users.hod,
        personUrl(ids.alreadyTold),
        allScores
      )
      expect(response.headers.location).toBe(scoresSavedUrl(ids.alreadyTold))
      // Only the skill with new evidence; the other is untouched
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.alreadyTold,
        { iterative_design: 2 },
        ids.hod
      )

      // The backend re-stamps scoredAt, so there is something new to tell
      person.gdad.iterative_design.scoredAt = '2026-11-10T12:00:00.000Z'
      const { result } = await get(users.hod, response.headers.location)
      expect(result).toContain('Scores saved for Bea Told')
      expect(result).toContain(BUTTON_TEXT)
    })

    test('Same score with no evidence since it was scored is not saved', async () => {
      const person = mockState.people.find((p) => p.id === ids.alreadyTold)
      person.gdad = {
        ...scoredGdad,
        iterative_design: {
          ...scoredGdad.iterative_design,
          evidenceUpdatedAt: '2026-10-20T10:00:00.000Z'
        }
      }
      const response = await post(
        users.hod,
        personUrl(ids.alreadyTold),
        allScores
      )
      expect(response.headers.location).toBe(
        `${personUrl(ids.alreadyTold)}?saved=none`
      )
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test('Single-skill save of the same score after new evidence is saved', async () => {
      const person = mockState.people.find((p) => p.id === ids.alreadyTold)
      person.gdad = {
        ...scoredGdad,
        design_communication: {
          ...scoredGdad.design_communication,
          evidenceUpdatedAt: '2026-11-07T10:00:00.000Z'
        }
      }
      const url = `${personUrl(ids.alreadyTold)}/design_communication`
      const response = await post(users.hod, url, {
        score_design_communication: '3'
      })
      expect(response.headers.location).toBe(scoresSavedUrl(ids.alreadyTold))
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.alreadyTold,
        { design_communication: 3 },
        ids.hod
      )
    })

    test('Single-skill save with the same score saves nothing', async () => {
      const url = `${personUrl(ids.alreadyTold)}/design_communication`
      const response = await post(users.hod, url, {
        score_design_communication: '3'
      })
      expect(response.headers.location).toBe(`${url}?saved=none`)
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()

      const { result } = await get(users.hod, response.headers.location)
      expect(result).toContain('was not changed.')
    })

    test('Single-skill save with a new score saves it', async () => {
      const url = `${personUrl(ids.alreadyTold)}/design_communication`
      const response = await post(users.hod, url, {
        score_design_communication: '1'
      })
      expect(response.headers.location).toBe(scoresSavedUrl(ids.alreadyTold))
      expect(backendApi.saveGdadScores).toHaveBeenCalledWith(
        ids.alreadyTold,
        { design_communication: 1 },
        ids.hod
      )
    })
  })

  describe('In production without the Notify template set up', () => {
    let wasProduction

    beforeEach(() => {
      wasProduction = config.get('isProduction')
      config.set('isProduction', true)
    })

    afterEach(() => {
      config.set('isProduction', wasProduction)
    })

    test('Shows no button', async () => {
      const { result } = await get(users.hod, personUrl(ids.scored))
      expect(result).not.toContain(BUTTON_TEXT)
    })

    test('Saving changed scores goes back to the page with "Scores saved."', async () => {
      for (const url of [
        personUrl(ids.scored),
        `${personUrl(ids.scored)}/design_communication`
      ]) {
        backendApi.saveGdadScores.mockClear()
        const response = await post(users.hod, url, {
          score_design_communication: '1'
        })
        expect(response.headers.location).toBe(`${url}?saved=1`)
        expect(backendApi.saveGdadScores).toHaveBeenCalledTimes(1)
      }
    })

    test('The scores-saved page sends you back to the evidence page', async () => {
      const response = await get(users.hod, scoresSavedUrl(ids.scored))
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(personUrl(ids.scored))
    })

    test('Refuses to send, with a message', async () => {
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).not.toHaveBeenCalled()
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
      expect(page.result).toContain(
        'Emailing people about their scores is not set up yet.'
      )
    })
  })
})

describe('#scoresNotifyStatus', () => {
  test('Undefined or null notified date counts as never sent', () => {
    expect(scoresNotifyStatus({ gdad: scoredGdad })).toEqual({
      hasScores: true,
      hasNewScores: true,
      notifiedAt: null
    })
  })

  test('Older scores with no score date still count as scored', () => {
    expect(
      scoresNotifyStatus({ gdad: { iterative_design: { officialScore: 2 } } })
        .hasNewScores
    ).toBe(true)
  })

  test('Nothing new once emailed after the latest score', () => {
    const status = scoresNotifyStatus({
      gdad: scoredGdad,
      gdadScoresNotifiedAt: '2026-11-05T10:00:01.000Z'
    })
    expect(status.hasScores).toBe(true)
    expect(status.hasNewScores).toBe(false)
  })

  test('Scores cleared after the last email (the backend blanks scoredAt) are not news', () => {
    const status = scoresNotifyStatus({
      gdad: {
        iterative_design: { officialScore: null, scoredAt: null },
        design_communication: {
          officialScore: 2,
          scoredAt: '2026-11-01T00:00:00Z'
        }
      },
      gdadScoresNotifiedAt: '2026-11-06T00:00:00Z'
    })
    expect(status.hasScores).toBe(true)
    expect(status.hasNewScores).toBe(false)
  })

  test('A cleared score on its own means nothing to tell', () => {
    expect(
      scoresNotifyStatus({
        gdad: { iterative_design: { officialScore: null, scoredAt: null } }
      })
    ).toEqual({ hasScores: false, hasNewScores: false, notifiedAt: null })
  })

  test('No scores means nothing to tell', () => {
    expect(scoresNotifyStatus({ gdad: {} })).toEqual({
      hasScores: false,
      hasNewScores: false,
      notifiedAt: null
    })
  })
})

describe('#buildScoresEmailPanel', () => {
  test('Returns nothing for no scores', async () => {
    expect(await buildScoresEmailPanel({ gdad: {} }, users.hod)).toBeNull()
  })

  test('Formats dates as day month year', () => {
    expect(formatNotifiedDate('2026-11-06T09:00:00.000Z')).toBe(
      '6 November 2026'
    )
    // Just after midnight in the UK during summer time is still that UK day
    expect(formatNotifiedDate('2026-07-14T23:30:00.000Z')).toBe('15 July 2026')
    expect(formatNotifiedDate(undefined)).toBeNull()
  })
})

describe('#withSavedScores', () => {
  test('New scores are stamped now and cleared scores are blanked', () => {
    const now = new Date('2026-11-10T12:00:00.000Z')
    const result = withSavedScores(
      { id: 'x', gdad: scoredGdad },
      { design_communication: 1, iterative_design: null },
      now
    )
    expect(result.gdad.design_communication).toMatchObject({
      evidenceText: 'Some evidence',
      officialScore: 1,
      scoredAt: '2026-11-10T12:00:00.000Z'
    })
    expect(result.gdad.iterative_design).toMatchObject({
      officialScore: null,
      scoredAt: null
    })
    // The original is not changed
    expect(scoredGdad.design_communication.officialScore).toBe(3)
  })
})

describe('#possessive', () => {
  test.each([
    ['Ada Scored', 'Ada Scored’s'],
    ['James', 'James’'],
    ['Chris Jones', 'Chris Jones’']
  ])('%s → %s', (name, expected) => {
    expect(possessive(name)).toBe(expected)
  })
})
