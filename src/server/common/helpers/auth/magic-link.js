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
    async issue(email) {
      const token = randomBytes(32).toString('hex')
      await cache.set(hashToken(token), { email })
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
