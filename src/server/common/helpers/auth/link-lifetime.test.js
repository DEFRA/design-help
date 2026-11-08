import { linkLifetimeText } from './link-lifetime.js'

describe('#linkLifetimeText', () => {
  test.each([
    [15 * 60 * 1000, '15 minutes'],
    [60 * 1000, '1 minute'],
    [90 * 60 * 1000, '90 minutes'],
    [60 * 60 * 1000, '1 hour'],
    [12 * 60 * 60 * 1000, '12 hours'],
    [24 * 60 * 60 * 1000, '1 day'],
    [7 * 24 * 60 * 60 * 1000, '7 days']
  ])('%i milliseconds reads as "%s"', (ttl, text) => {
    expect(linkLifetimeText(ttl)).toBe(text)
  })
})
