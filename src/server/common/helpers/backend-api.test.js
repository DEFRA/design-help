import { vi } from 'vitest'

import { backendApi } from '#/server/common/helpers/backend-api.js'

/*
 * What the evidence calls send to the backend. fetch is faked, so nothing
 * leaves the test.
 */
describe('#backendApi evidence calls', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
    )
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function sent() {
    const [url, options] = fetchMock.mock.calls[0]
    return { url, method: options.method, body: JSON.parse(options.body) }
  }

  test('saveGdadEvidence leaves out who saved it when not given', async () => {
    await backendApi.saveGdadEvidence('abc', { leading_design: 'x' })
    const { url, method, body } = sent()
    expect(url).toMatch(/\/people\/abc\/gdad\/evidence$/)
    expect(method).toBe('PUT')
    // An older backend refuses keys it does not know
    expect(body).toEqual({ evidence: { leading_design: 'x' } })
  })

  test('saveGdadEvidence sends who saved it when given', async () => {
    await backendApi.saveGdadEvidence('abc', { leading_design: 'x' }, 'u1')
    expect(sent().body).toEqual({
      evidence: { leading_design: 'x' },
      updatedById: 'u1'
    })
  })

  test('saveGdadNewEvidence puts to the new-evidence address', async () => {
    await backendApi.saveGdadNewEvidence('abc', { leading_design: '' }, 'u1')
    const { url, method, body } = sent()
    expect(url).toMatch(/\/people\/abc\/gdad\/new-evidence$/)
    expect(method).toBe('PUT')
    expect(body).toEqual({
      evidence: { leading_design: '' },
      updatedById: 'u1'
    })
  })
})
