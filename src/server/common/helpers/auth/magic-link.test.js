import Hapi from '@hapi/hapi'
import { Engine as CatboxRedis } from '@hapi/catbox-redis'
import { vi } from 'vitest'

import { createMagicLinkStore } from './magic-link.js'

/*
 * The sign-in link store against a real Hapi cache (in memory, as used
 * locally) and a pretend Redis client (as used on CDP). Only the clock is
 * faked; nothing leaves the test.
 */
const FIFTEEN_MINUTES = 15 * 60 * 1000
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

async function memoryStore() {
  const server = Hapi.server()
  const cache = server.cache({
    segment: 'magic-links-test',
    expiresIn: FIFTEEN_MINUTES
  })
  await server.initialize()
  return { server, store: createMagicLinkStore(cache) }
}

describe('#createMagicLinkStore', () => {
  let server
  let store

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-07T09:00:00.000Z'))
    ;({ server, store } = await memoryStore())
  })

  afterEach(async () => {
    vi.useRealTimers()
    await server.stop({ timeout: 0 })
  })

  test('A link works once and then stops working', async () => {
    const token = await store.issue('person@defra.gov.uk')
    expect(await store.consume(token)).toBe('person@defra.gov.uk')
    expect(await store.consume(token)).toBeNull()
  })

  test('An ordinary sign-in link expires after 15 minutes', async () => {
    const token = await store.issue('person@defra.gov.uk')
    vi.advanceTimersByTime(FIFTEEN_MINUTES + 1000)
    expect(await store.consume(token)).toBeNull()
  })

  test('An invite link still works after 15 minutes and expires after its own time to live', async () => {
    const stillGood = await store.issue('person@defra.gov.uk', {
      ttl: SEVEN_DAYS
    })
    const expired = await store.issue('person@defra.gov.uk', {
      ttl: SEVEN_DAYS
    })

    vi.advanceTimersByTime(6 * 24 * 60 * 60 * 1000)
    expect(await store.consume(stillGood)).toBe('person@defra.gov.uk')

    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000)
    expect(await store.consume(expired)).toBeNull()
  })

  test('A malformed token is refused', async () => {
    expect(await store.consume('not-a-token')).toBeNull()
    expect(await store.consume(undefined)).toBeNull()
  })
})

describe('#createMagicLinkStore with Redis', () => {
  test('The invite time to live is passed on to Redis; ordinary links use the default', async () => {
    const psetex = vi.fn(async () => 'OK')
    const fakeRedisClient = {
      status: 'ready',
      psetex,
      get: vi.fn(),
      del: vi.fn()
    }
    const server = Hapi.server({
      cache: [
        {
          name: 'redis-test',
          engine: new CatboxRedis({ client: fakeRedisClient })
        }
      ]
    })
    const cache = server.cache({
      cache: 'redis-test',
      segment: 'magic-links',
      expiresIn: FIFTEEN_MINUTES
    })
    await server.initialize()
    const store = createMagicLinkStore(cache)

    await store.issue('person@defra.gov.uk')
    await store.issue('person@defra.gov.uk', { ttl: SEVEN_DAYS })

    expect(psetex.mock.calls[0][1]).toBe(FIFTEEN_MINUTES)
    expect(psetex.mock.calls[1][1]).toBe(SEVEN_DAYS)

    await server.stop({ timeout: 0 })
  })
})
