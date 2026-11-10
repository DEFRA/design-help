import { config } from '#/config/config.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import {
  isScoresUpdatedNotifyConfigured,
  sendScoresUpdatedEmail
} from '#/server/common/helpers/notify.js'

const logger = createLogger()

export const SCORES_EMAIL_RESULT_FLASH = 'gdadScoresEmailResult'

function toDate(value) {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "10 November 2026" */
export function formatNotifiedDate(value) {
  const d = toDate(value)
  return d
    ? d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/London'
      })
    : null
}

/**
 * Emails about scores can be sent when Notify is set up. Outside
 * production the email is written to the log instead, so the button still
 * shows there.
 */
export function canOfferScoresEmail() {
  return !config.get('isProduction') || isScoresUpdatedNotifyConfigured()
}

/**
 * Whether there is anything to tell the person about.
 * - `hasScores`: at least one skill has been scored
 * - `hasNewScores`: something was scored after the last email (or there
 *   has never been an email and at least one skill is scored)
 * - `notifiedAt`: when they were last emailed, or null
 * A missing `gdadScoresNotifiedAt` (older backend) counts as never sent.
 */
export function scoresNotifyStatus(person) {
  const gdad = person?.gdad ?? {}
  const notifiedAt = toDate(person?.gdadScoresNotifiedAt)
  let hasScores = false
  let hasNewScores = false
  for (const entry of Object.values(gdad)) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const scored = entry.officialScore != null && entry.officialScore !== ''
    const scoredAt = toDate(entry.scoredAt)
    if (scored || scoredAt) {
      hasScores = true
    }
    if (notifiedAt) {
      if (scoredAt && scoredAt > notifiedAt) {
        hasNewScores = true
      }
    } else if (scored || scoredAt) {
      hasNewScores = true
    }
  }
  return { hasScores, hasNewScores, notifiedAt }
}

/**
 * The line manager to copy in: the person's recorded manager, looked up
 * from the backend, if they have an email address and are not the person
 * themselves or the Head of Design who is sending.
 */
export async function findManagerToCopy(target, sender) {
  const managerId = target?.managerId
  if (!managerId || managerId === target.id || managerId === sender?.id) {
    return null
  }
  let manager
  try {
    manager = await backendApi.getPerson(managerId)
  } catch (error) {
    logger.warn(
      `Could not look up line manager ${managerId} for person ${target.id}: ${error.message}`
    )
    return null
  }
  if (!manager?.email || manager.id !== managerId) {
    return null
  }
  return manager
}

function managerLabel(manager) {
  return manager.name || 'their line manager'
}

/**
 * What the Head of Design sees under the scores, or null for nothing.
 * `state` is 'ready' (show the button) or 'sent' (already told them).
 */
export async function buildScoresEmailPanel(target, sender) {
  if (!canOfferScoresEmail()) {
    return null
  }
  const { hasScores, hasNewScores, notifiedAt } = scoresNotifyStatus(target)
  if (!hasScores) {
    return null
  }
  const lastSentLabel = formatNotifiedDate(notifiedAt)
  if (!hasNewScores) {
    return { state: 'sent', lastSentLabel }
  }
  const manager = await findManagerToCopy(target, sender)
  return {
    state: 'ready',
    lastSentLabel,
    managerName: manager ? managerLabel(manager) : null
  }
}

function personalisationFor(sender, target, { forManager }) {
  const senderName = sender?.name || 'The Head of Design'
  const baseUrl = config.get('appBaseUrl')
  return forManager
    ? {
        intro: `${senderName} has updated the GDaD scores for ${target.name} in Design Help.`,
        link: `${baseUrl}/review/gdad-evidence/${target.id}`
      }
    : {
        intro: `${senderName} has updated your GDaD scores in Design Help.`,
        link: `${baseUrl}/my-gdad-evidence`
      }
}

/**
 * Emails the person, copies in their line manager and records when it was
 * sent. Addresses only ever come from the backend person records.
 * Returns the banner to show: `{ kind: 'success' | 'partial' | 'failed', text }`.
 */
export async function sendScoresUpdated(sender, target) {
  const failed = {
    kind: 'failed',
    text: `Couldn’t send the email to ${target.name}. Try again later.`
  }
  if (!target.email) {
    return failed
  }

  const manager = await findManagerToCopy(target, sender)

  try {
    await sendScoresUpdatedEmail(
      target.email,
      personalisationFor(sender, target, { forManager: false })
    )
  } catch (error) {
    logger.error(
      error,
      `Failed to send scores-updated email to person ${target.id}`
    )
    return failed
  }

  let managerFailed = false
  if (manager) {
    try {
      await sendScoresUpdatedEmail(
        manager.email,
        personalisationFor(sender, target, { forManager: true })
      )
    } catch (error) {
      managerFailed = true
      logger.error(
        error,
        `Failed to send scores-updated copy to manager ${manager.id}`
      )
    }
  }

  try {
    await backendApi.markGdadScoresNotified(target.id, sender.id)
  } catch (error) {
    logger.warn(
      `Scores-updated email sent for person ${target.id} but not recorded: ${error.message}`
    )
  }

  if (managerFailed) {
    return {
      kind: 'partial',
      text: `Email sent to ${target.name}, but we couldn’t send the copy to ${managerLabel(manager)}. You may want to let them know yourself.`
    }
  }
  return {
    kind: 'success',
    text: manager
      ? `Email sent to ${target.name} and ${managerLabel(manager)}.`
      : `Email sent to ${target.name}.`
  }
}
