import { vi } from 'vitest'

import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  isScoresUpdatedNotifyConfigured,
  sendScoresUpdatedEmail
} from './notify.js'

const mockSendEmail = vi.fn(async () => ({}))

vi.mock('notifications-node-client', () => ({
  NotifyClient: vi.fn(function NotifyClient() {
    this.sendEmail = mockSendEmail
  })
}))

const personalisation = {
  intro: 'Someone has updated your GDaD scores in Design Help.',
  link: 'https://example.test/my-gdad-evidence'
}

describe('#sendScoresUpdatedEmail', () => {
  const saved = {}

  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of [
      'isProduction',
      'notify.apiKey',
      'notify.scoresUpdatedTemplateId'
    ]) {
      saved[key] = config.get(key)
    }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      config.set(key, value)
    }
  })

  test('Outside production without Notify, logs instead of sending', async () => {
    config.set('isProduction', false)
    config.set('notify.apiKey', '')
    config.set('notify.scoresUpdatedTemplateId', '')
    const info = vi.spyOn(createLogger(), 'info')

    expect(isScoresUpdatedNotifyConfigured()).toBe(false)
    await sendScoresUpdatedEmail('ada@example.test', personalisation)

    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(info.mock.calls.flat().join(' ')).toContain(
      '[dev] Scores-updated email for ada@example.test'
    )
    info.mockRestore()
  })

  test('In production without Notify, refuses', async () => {
    config.set('isProduction', true)
    config.set('notify.apiKey', '')
    config.set('notify.scoresUpdatedTemplateId', '')

    await expect(
      sendScoresUpdatedEmail('ada@example.test', personalisation)
    ).rejects.toThrow('notify_not_configured')
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  test('With Notify set up, sends only intro and link', async () => {
    config.set('notify.apiKey', 'test-key')
    config.set('notify.scoresUpdatedTemplateId', 'template-123')

    expect(isScoresUpdatedNotifyConfigured()).toBe(true)
    await sendScoresUpdatedEmail('ada@example.test', {
      ...personalisation,
      extra: 'not sent'
    })

    expect(mockSendEmail).toHaveBeenCalledWith(
      'template-123',
      'ada@example.test',
      {
        personalisation,
        reference: expect.stringMatching(/^design-help-scores-updated-\d+$/)
      }
    )
  })
})
