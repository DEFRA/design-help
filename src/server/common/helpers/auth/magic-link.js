import { createHash, randomBytes } from 'node:crypto'

/**
 * Single-use sign-in tokens. Only a hash of the token is stored, in the
 * server-side session cache engine (Redis on CDP), with a short TTL.
 */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createMagicLinkStore(cache) {
  return {
    /**
     * `ttl` (milliseconds) overrides the cache's default expiry for this one
     * token — admin invites use a longer life than ordinary sign-in links.
     * Both catbox-memory and catbox-redis honour a per-item TTL.
     */
    async issue(email, { ttl } = {}) {
      const token = randomBytes(32).toString('hex')
      if (ttl) {
        await cache.set(hashToken(token), { email }, ttl)
      } else {
        await cache.set(hashToken(token), { email })
      }
      return token
    },
    async consume(token) {
      if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
        return null
      }
      const key = hashToken(token)
      const entry = await cache.get(key)
      if (!entry) {
        return null
      }
      await cache.drop(key)
      return entry.email
    }
  }
}
