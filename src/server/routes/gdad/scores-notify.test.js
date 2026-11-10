import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { sendScoresUpdatedEmail } from '#/server/common/helpers/notify.js'
import {
  buildScoresEmailPanel,
  formatNotifiedDate,
  scoresNotifyStatus
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
  user_focus: {
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
        user_focus: { evidenceText: 'Evidence only', officialScore: null }
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
const BUTTON_TEXT = 'to tell them their scores have been updated'

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
      expect(result).toContain(`Email Ada Scored ${BUTTON_TEXT}`)
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
      expect(result).toContain(`Email Bea Told ${BUTTON_TEXT}`)
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

    test('Saved banner links to the email button', async () => {
      const { result } = await get(
        users.hod,
        `${personUrl(ids.scored)}?saved=1`
      )
      expect(result).toContain('Scores saved.')
      expect(result).toContain('href="#scores-email"')
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
      expect(page.result).toContain('Email sent to Ada Scored and Mo Manager.')
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
    })

    test('If the designer email fails, nothing is recorded and an error shows', async () => {
      sendScoresUpdatedEmail.mockRejectedValueOnce(new Error('notify down'))
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(1)
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
      expect(page.result).toContain(
        'Couldn’t send the email to Ada Scored. Try again later.'
      )
    })

    test('If the line manager copy fails, still records and says so', async () => {
      sendScoresUpdatedEmail
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('notify down'))
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(backendApi.markGdadScoresNotified).toHaveBeenCalledTimes(1)
      expect(page.result).toContain('we couldn’t send the copy to Mo Manager')
    })

    test('If recording fails, still shows success', async () => {
      backendApi.markGdadScoresNotified.mockRejectedValueOnce(
        new Error('not deployed')
      )
      const { page } = await postAndFollow(users.hod, notifyUrl(ids.scored))
      expect(sendScoresUpdatedEmail).toHaveBeenCalledTimes(2)
      expect(page.result).toContain('Email sent to Ada Scored and Mo Manager.')
    })

    test('Sends nothing when there is nothing new to tell them', async () => {
      const response = await post(users.hod, notifyUrl(ids.alreadyTold))
      expect(response.statusCode).toBe(302)
      expect(sendScoresUpdatedEmail).not.toHaveBeenCalled()
      expect(backendApi.markGdadScoresNotified).not.toHaveBeenCalled()
    })

    test.each([
      ['line manager of the person', 'manager'],
      ['the designer themselves', 'designer']
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
      scoresNotifyStatus({ gdad: { user_focus: { officialScore: 2 } } })
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

  test('A cleared score after the last email still counts as new', () => {
    const status = scoresNotifyStatus({
      gdad: {
        user_focus: { officialScore: null, scoredAt: '2026-11-07T00:00:00Z' }
      },
      gdadScoresNotifiedAt: '2026-11-06T00:00:00Z'
    })
    expect(status.hasNewScores).toBe(true)
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
    expect(formatNotifiedDate(undefined)).toBeNull()
  })
})
