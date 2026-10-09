import { config } from '#/config/config.js'

/**
 * Bearer-token auth for calling design-help-backend through a CDP PRIVATE
 * API gateway (Cognito client-credentials flow), used for local frontend
 * development against a deployed backend. When BACKEND_API_TOKEN_URL /
 * CLIENT_ID / CLIENT_SECRET are unset — on CDP itself, and against a local
 * backend — this is a no-op.
 */
let cached = { token: null, expiresAt: 0 }

export function isGatewayAuthConfigured() {
  return Boolean(
    config.get('backendApiAuth.tokenUrl') &&
    config.get('backendApiAuth.clientId') &&
    config.get('backendApiAuth.clientSecret')
  )
}

export function clearTokenCache() {
  cached = { token: null, expiresAt: 0 }
}

async function fetchToken() {
  // Credentials usually arrive by copy-paste from a CSV with Windows line
  // endings; a stray \r makes Cognito return invalid_client, so trim.
  const tokenUrl = config.get('backendApiAuth.tokenUrl').trim()
  const clientId = config.get('backendApiAuth.clientId').trim()
  const clientSecret = config.get('backendApiAuth.clientSecret').trim()

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  })
  if (!response.ok) {
    throw new Error(
      `Backend API token request failed: ${response.status} ${response.statusText}`
    )
  }
  const body = await response.json()
  cached = {
    token: body.access_token,
    // Refresh a minute early so in-flight requests never carry a token
    // that expires mid-call
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - 60000
  }
  return cached.token
}

export async function getAuthHeaders() {
  if (!isGatewayAuthConfigured()) {
    return {}
  }
  const token =
    cached.token && Date.now() < cached.expiresAt
      ? cached.token
      : await fetchToken()
  return { Authorization: `Bearer ${token}` }
}
