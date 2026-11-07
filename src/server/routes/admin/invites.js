import { config } from '#/config/config.js'
import { sendMagicLinkEmail } from '#/server/common/helpers/notify.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

/**
 * Someone an admin may invite: on the approved list with an email address,
 * and never signed in (the "Pending" rows on People and access).
 */
export function isInvitable(person) {
  return Boolean(
    person?.email && person.approved === true && !person.activatedAt
  )
}

export function inviteLabel(person) {
  return person.name || person.email
}

/**
 * Emails one person a sign-in link that lasts `auth.inviteLinkTtl` (longer
 * than an ordinary sign-in link). Uses the same Notify template as sign-in.
 * The link is still single-use and the verify route still checks approval.
 */
export async function sendInvite(server, person) {
  const email = String(person.email).toLowerCase()
  const token = await server.magicLinks.issue(email, {
    ttl: config.get('auth.inviteLinkTtl')
  })
  const signInLink = `${config.get('appBaseUrl')}/sign-in/verify?token=${token}`
  await sendMagicLinkEmail(email, signInLink)
  logger.info(`Invite sent to person ${person.id}`)
}

/**
 * Sends to each person in turn and carries on past failures.
 * Returns the people it could not send to.
 */
export async function sendInvites(server, people) {
  const failed = []
  let sent = 0
  for (const person of people) {
    try {
      await sendInvite(server, person)
      sent += 1
    } catch (error) {
      logger.error(error, `Failed to send invite to person ${person.id}`)
      failed.push(person)
    }
  }
  return { sent, failed }
}

function plural(count, one, many) {
  return count === 1 ? one : many
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** How long an invite link lasts, in words: "7 days", "12 hours". */
export function inviteLinkLifetimeText(ttl = config.get('auth.inviteLinkTtl')) {
  if (ttl >= DAY_MS && ttl % DAY_MS === 0) {
    const days = ttl / DAY_MS
    return `${days} ${plural(days, 'day', 'days')}`
  }
  const hours = Math.max(1, Math.round(ttl / HOUR_MS))
  return `${hours} ${plural(hours, 'hour', 'hours')}`
}

/** Banner shown on People and access after sending invites. */
export function inviteResultBanner({ sent, failedLabels }) {
  const sentText = `Sent ${sent} ${plural(sent, 'invite', 'invites')}.`
  if (!failedLabels.length) {
    return { isSuccess: true, text: sentText }
  }
  return {
    isSuccess: false,
    text: `${sentText} Couldn’t send to: ${failedLabels.join(', ')}. Try again later.`
  }
}
