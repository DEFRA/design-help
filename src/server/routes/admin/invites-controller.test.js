import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { config } from '#/config/config.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { sendMagicLinkEmail } from '#/server/common/helpers/notify.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

/*
 * The "Send invite" and "Invite everyone who's pending" buttons on People
 * and access. The signed-in user, the backend and the email sender are all
 * faked, so no live data is touched and no email is sent.
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
      )
    }
  }
})

vi.mock('#/server/common/helpers/notify.js', async (importOriginal) => {
  const original = await importOriginal()
  return { ...original, sendMagicLinkEmail: vi.fn(async () => {}) }
})

const ids = {
  admin: 'a00000000000000000000001',
  designer: 'a00000000000000000000002',
  active: 'a00000000000000000000003',
  pendingNamed: 'b00000000000000000000001',
  pendingEmailOnly: 'b00000000000000000000002',
  noEmail: 'b00000000000000000000003',
  removed: 'b00000000000000000000004',
  unknownApproval: 'b00000000000000000000005'
}

const users = {
  admin: {
    id: ids.admin,
    email: 'admin@defra.gov.uk',
    name: 'Ada Admin',
    isAdmin: true,
    isHeadOfDesignSuperUser: false,
    isLineManager: false
  },
  designer: {
    id: ids.designer,
    email: 'designer@defra.gov.uk',
    name: 'Dee Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false
  }
}

function person(id, fields = {}) {
  return {
    id,
    email: `${id}@defra.gov.uk`,
    name: null,
    role: null,
    approved: true,
    isAdmin: false,
    activatedAt: null,
    ...fields
  }
}

function buildPeople() {
  return [
    person(ids.admin, {
      email: 'admin@defra.gov.uk',
      name: 'Ada Admin',
      isAdmin: true,
      activatedAt: '2026-01-01T00:00:00.000Z'
    }),
    person(ids.active, {
      email: 'active@defra.gov.uk',
      name: 'Al Active',
      activatedAt: '2026-02-01T00:00:00.000Z'
    }),
    person(ids.pendingNamed, {
      email: 'pat.pending@defra.gov.uk',
      name: 'Pat Pending'
    }),
    // Allow-list only: email, nothing else yet
    person(ids.pendingEmailOnly, { email: 'emailonly@defra.gov.uk' }),
    // Profile with no email address cannot be invited
    person(ids.noEmail, { email: null, name: 'No Email' }),
    // Access removed: not on the approved list any more
    person(ids.removed, {
      email: 'removed@defra.gov.uk',
      name: 'Rem Oved',
      approved: false
    }),
    // Approval not recorded: sign-in would refuse them, so no invite either
    person(ids.unknownApproval, {
      email: 'unknown.approval@defra.gov.uk',
      approved: undefined
    })
  ]
}

function sessionCookie(response) {
  const cookies = [response.headers['set-cookie'] ?? []].flat()
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ')
}

describe('#invitesRoutes', () => {
  let server
  let issue

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
    issue = vi.spyOn(server.magicLinks, 'issue')
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    vi.clearAllMocks()
    sendMagicLinkEmail.mockImplementation(async () => {})
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

  /** Posts, then follows the redirect with the same session to read the banner. */
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

  describe('Access', () => {
    test.each([
      ['GET', '/admin/users/invite-pending'],
      ['POST', '/admin/users/invite-pending'],
      ['POST', `/admin/users/${ids.pendingNamed}/invite`]
    ])('A non-admin gets 403 on %s %s', async (method, url) => {
      const response =
        method === 'GET'
          ? await get(users.designer, url)
          : await post(users.designer, url)
      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })
  })

  describe('People and access page', () => {
    test('Shows Send invite only for pending people with an email, and the invite-all count', async () => {
      const { result } = await get(users.admin, '/admin/users')

      expect(result).toContain(
        `action="/admin/users/${ids.pendingNamed}/invite"`
      )
      expect(result).toContain(
        `action="/admin/users/${ids.pendingEmailOnly}/invite"`
      )
      expect(result).not.toContain(`action="/admin/users/${ids.active}/invite"`)
      expect(result).not.toContain(`action="/admin/users/${ids.admin}/invite"`)
      expect(result).not.toContain(
        `action="/admin/users/${ids.noEmail}/invite"`
      )
      expect(result).not.toContain(
        `action="/admin/users/${ids.removed}/invite"`
      )
      expect(result).not.toContain(
        `action="/admin/users/${ids.unknownApproval}/invite"`
      )
      expect(result).toContain('Invite everyone who’s pending (2)')
    })

    test('Send invite buttons guard against double clicks', async () => {
      const { result } = await get(users.admin, '/admin/users')
      const buttons = result.match(/<button[^>]*>Send invite</g)
      expect(buttons).toHaveLength(2)
      for (const button of buttons) {
        expect(button).toContain('data-prevent-double-click="true"')
      }
    })

    test('Explains why a pending person whose access was removed has no invite button', async () => {
      const { result } = await get(users.admin, '/admin/users')
      expect(result.match(/Access removed — can’t invite/g)).toHaveLength(2)
    })

    test('Hides the invite-all button when nobody is pending', async () => {
      mockState.people = mockState.people.filter(
        (p) => p.id === ids.admin || p.id === ids.active
      )
      const { result } = await get(users.admin, '/admin/users')
      expect(result).not.toContain('Invite everyone who’s pending')
      expect(result).not.toContain('Send invite')
    })
  })

  describe('Send one invite', () => {
    test('Sends one email with a link built from appBaseUrl using the invite time to live', async () => {
      const { page } = await postAndFollow(
        users.admin,
        `/admin/users/${ids.pendingNamed}/invite`
      )

      expect(issue).toHaveBeenCalledTimes(1)
      expect(issue).toHaveBeenCalledWith('pat.pending@defra.gov.uk', {
        ttl: config.get('auth.inviteLinkTtl')
      })
      expect(config.get('auth.inviteLinkTtl')).toBe(7 * 24 * 60 * 60 * 1000)

      expect(sendMagicLinkEmail).toHaveBeenCalledTimes(1)
      const [email, link] = sendMagicLinkEmail.mock.calls[0]
      expect(email).toBe('pat.pending@defra.gov.uk')
      expect(link).toMatch(
        new RegExp(
          `^${config.get('appBaseUrl')}/sign-in/verify\\?token=[a-f0-9]{64}$`
        )
      )

      expect(page.result).toContain('Invite sent to Pat Pending.')
    })

    test('Logs the person’s id, never their email address or the link', async () => {
      const logger = createLogger()
      const info = vi.spyOn(logger, 'info')
      const error = vi.spyOn(logger, 'error')
      sendMagicLinkEmail.mockRejectedValueOnce(new Error('notify down'))

      await post(users.admin, `/admin/users/${ids.pendingNamed}/invite`)
      await post(users.admin, `/admin/users/${ids.pendingEmailOnly}/invite`)

      const logged = [...info.mock.calls, ...error.mock.calls]
        .flat()
        .map((value) => String(value))
        .join(' ')
      expect(logged).toContain(
        `Failed to send invite to person ${ids.pendingNamed}`
      )
      expect(logged).toContain(`Invite sent to person ${ids.pendingEmailOnly}`)
      expect(logged).not.toContain('@defra.gov.uk')
      expect(logged).not.toContain('token=')
      info.mockRestore()
      error.mockRestore()
    })

    test('An invite link signs the person in', async () => {
      await post(users.admin, `/admin/users/${ids.pendingEmailOnly}/invite`)
      const [, link] = sendMagicLinkEmail.mock.calls[0]
      const token = new URL(link).searchParams.get('token')

      expect(await server.magicLinks.consume(token)).toBe(
        'emailonly@defra.gov.uk'
      )
    })

    test.each([
      ['has already signed in', ids.active],
      ['has no email address', ids.noEmail],
      ['is no longer on the approved list', ids.removed],
      ['has no recorded approval', ids.unknownApproval],
      ['is not on the list at all', 'f00000000000000000000099']
    ])('Refuses someone who %s', async (_label, id) => {
      const response = await post(users.admin, `/admin/users/${id}/invite`)
      expect(response.statusCode).toBe(302)
      expect(response.headers.location).toBe(
        '/admin/users?adminMsg=invite-not-pending'
      )
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
      expect(issue).not.toHaveBeenCalled()
    })

    test('Reports when the email could not be sent', async () => {
      sendMagicLinkEmail.mockRejectedValueOnce(new Error('notify down'))
      const { page } = await postAndFollow(
        users.admin,
        `/admin/users/${ids.pendingNamed}/invite`
      )
      expect(page.result).toContain(
        'Couldn’t send an invite to Pat Pending. Try again later.'
      )
    })
  })

  describe('Invite everyone who’s pending', () => {
    test('The confirmation page lists the right people and count', async () => {
      const { statusCode, result } = await get(
        users.admin,
        '/admin/users/invite-pending'
      )
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('You’re about to email 2 people')
      expect(result).toContain('lasts 7 days')
      expect(result).toContain('Pat Pending (pat.pending@defra.gov.uk)')
      expect(result).toContain('emailonly@defra.gov.uk')
      expect(result).not.toContain('active@defra.gov.uk')
      expect(result).not.toContain('removed@defra.gov.uk')
      expect(result).toContain('action="/admin/users/invite-pending"')
      expect(result).toMatch(
        /<button[^>]*data-prevent-double-click="true"[^>]*>Send invites</
      )
      expect(result).toContain('Cancel')
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })

    test('Sends only to pending people with emails', async () => {
      const { page } = await postAndFollow(
        users.admin,
        '/admin/users/invite-pending'
      )

      const emails = sendMagicLinkEmail.mock.calls.map(([email]) => email)
      expect(emails.sort()).toEqual([
        'emailonly@defra.gov.uk',
        'pat.pending@defra.gov.uk'
      ])
      for (const call of issue.mock.calls) {
        expect(call[1]).toEqual({ ttl: config.get('auth.inviteLinkTtl') })
      }
      expect(page.result).toContain('Sent 2 invites.')
    })

    test('Carries on past a failure and reports who was missed', async () => {
      sendMagicLinkEmail.mockImplementation(async (email) => {
        if (email === 'emailonly@defra.gov.uk') {
          throw new Error('notify down')
        }
      })
      const { page } = await postAndFollow(
        users.admin,
        '/admin/users/invite-pending'
      )

      expect(sendMagicLinkEmail).toHaveBeenCalledTimes(2)
      expect(page.result).toContain(
        'Sent 1 invite. Couldn’t send to: emailonly@defra.gov.uk. Try again later.'
      )
      expect(page.result).toContain('Some invites were not sent')
    })

    test('Does nothing when nobody is pending', async () => {
      mockState.people = mockState.people.filter(
        (p) => p.id === ids.admin || p.id === ids.active
      )
      const response = await post(users.admin, '/admin/users/invite-pending')
      expect(response.headers.location).toBe(
        '/admin/users?adminMsg=invite-none-pending'
      )
      expect(sendMagicLinkEmail).not.toHaveBeenCalled()
    })
  })
})
