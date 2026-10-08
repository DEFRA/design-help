import { vi } from 'vitest'

const TOKEN_URL = 'https://design-help-backend-abc12.example/oauth2/token'

vi.mock(import('#/config/config.js'), async (importOriginal) => {
  const originalModule = await importOriginal()
  return {
    config: {
      get(key) {
        if (key === 'backendApiAuth.tokenUrl') {
          return TOKEN_URL
        }
        if (key === 'backendApiAuth.clientId') {
          return 'client-id'
        }
        if (key === 'backendApiAuth.clientSecret') {
          return 'client-secret'
        }
        return originalModule.config.get(key)
      },
      validate() {}
    }
  }
})

function tokenResponse(token, expiresIn = 3600) {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('backend API gateway auth', () => {
  let auth

  beforeEach(async () => {
    auth = await import('./backend-api-auth.js')
    auth.clearTokenCache()
  })

  test('fetches a token with the client-credentials flow and caches it', async () => {
    global.fetch = vi.fn().mockResolvedValue(tokenResponse('token-1'))

    const first = await auth.getAuthHeaders()
    const second = await auth.getAuthHeaders()

    expect(first).toEqual({ Authorization: 'Bearer token-1' })
    expect(second).toEqual({ Authorization: 'Bearer token-1' })
    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe(TOKEN_URL)
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`
    )
    expect(String(options.body)).toContain('grant_type=client_credentials')
  })

  test('refreshes after the cached token expires', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('short-lived', 30))
      .mockResolvedValueOnce(tokenResponse('fresh'))

    const first = await auth.getAuthHeaders()
    // 30s expiry minus the 60s early-refresh margin means it is already
    // considered stale
    const second = await auth.getAuthHeaders()

    expect(first.Authorization).toBe('Bearer short-lived')
    expect(second.Authorization).toBe('Bearer fresh')
  })

  test('backendApi retries once with a fresh token on 401', async () => {
    const { backendApi } = await import('./backend-api.js')
    const person = { id: '64b000000000000000000001', email: 'x@defra.gov.uk' }

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse('stale'))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(tokenResponse('fresh'))
      .mockResolvedValueOnce(jsonResponse(person))

    const result = await backendApi.getPerson(person.id)
    expect(result).toEqual(person)

    const apiCalls = global.fetch.mock.calls.filter(
      ([url]) => !String(url).includes('/oauth2/token')
    )
    expect(apiCalls[0][1].headers.Authorization).toBe('Bearer stale')
    expect(apiCalls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  test('throws a clear error when the token endpoint rejects', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    await expect(auth.getAuthHeaders()).rejects.toThrow(
      'Backend API token request failed: 403'
    )
  })
})
