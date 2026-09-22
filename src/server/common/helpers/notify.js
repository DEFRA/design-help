import { NotifyClient } from 'notifications-node-client'

import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

export function isMagicLinkNotifyConfigured() {
  return Boolean(
    config.get('notify.apiKey') && config.get('notify.magicLinkTemplateId')
  )
}

export function isFeedbackNotifyConfigured() {
  return Boolean(
    config.get('notify.apiKey') &&
    config.get('notify.feedbackTemplateId') &&
    config.get('notify.feedbackInboxEmail')
  )
}

/**
 * Template personalisation: ((sign_in_link))
 * Outbound Notify calls leave the platform via the CDP forward proxy
 * automatically (NODE_USE_ENV_PROXY); no proxy code needed here.
 */
export async function sendMagicLinkEmail(email, signInLink) {
  if (!isMagicLinkNotifyConfigured()) {
    if (config.get('isProduction')) {
      throw new Error('notify_not_configured')
    }
    logger.info(`[dev] Sign-in link for ${email}: ${signInLink}`)
    return
  }

  const client = new NotifyClient(config.get('notify.apiKey'))
  await client.sendEmail(config.get('notify.magicLinkTemplateId'), email, {
    personalisation: { sign_in_link: signInLink },
    reference: `design-help-sign-in-${Date.now()}`
  })
}

/**
 * Template personalisation: ((service_name)), ((feedback_details)),
 * ((page_path)), ((contact_email)), ((signed_in_as))
 */
export async function sendFeedbackEmail(personalisation) {
  if (!isFeedbackNotifyConfigured()) {
    if (config.get('isProduction')) {
      throw new Error('notify_not_configured')
    }
    logger.info(`[dev] Feedback (not sent): ${JSON.stringify(personalisation)}`)
    return
  }

  const client = new NotifyClient(config.get('notify.apiKey'))
  await client.sendEmail(
    config.get('notify.feedbackTemplateId'),
    config.get('notify.feedbackInboxEmail'),
    {
      personalisation: {
        service_name: 'Design help',
        ...personalisation
      },
      reference: `design-help-feedback-${Date.now()}`
    }
  )
}
