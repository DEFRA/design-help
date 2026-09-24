import { config } from '#/config/config.js'
import { isMagicLinkNotifyConfigured } from '#/server/common/helpers/notify.js'

/**
 * Sign-in needs GOV.UK Notify in production (links are logged to the
 * console elsewhere). Until the Notify secret and template are set the
 * whole sign-in journey presents as "not available yet" — and comes back
 * by itself once they exist, with no code or config change.
 */
export function isSignInAvailable() {
  return !config.get('isProduction') || isMagicLinkNotifyConfigured()
}
