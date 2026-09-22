import { config } from '#/config/config.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { buildSessionUser } from '#/server/common/helpers/auth/user-session.js'
import {
  isMagicLinkNotifyConfigured,
  sendMagicLinkEmail
} from '#/server/common/helpers/notify.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

const DEFRA_EMAIL_PATTERN = /^[^@\s]+@defra\.gov\.uk$/i
const ANY_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Outside production the Defra-domain rule is relaxed so local development
// can sign in with any allow-listed address; the allow-list still gates.
function isAcceptableEmail(email) {
  return config.get('isProduction')
    ? DEFRA_EMAIL_PATTERN.test(email)
    : ANY_EMAIL_PATTERN.test(email)
}

export const signInRoutes = [
  {
    method: 'GET',
    path: '/sign-in',
    handler(request, h) {
      if (request.app.user) {
        return h.redirect('/browse')
      }
      return h.view('sign-in/index', { pageTitle: 'Sign in' })
    }
  },
  {
    method: 'POST',
    path: '/sign-in',
    async handler(request, h) {
      const email = String(request.payload?.email ?? '')
        .trim()
        .toLowerCase()

      if (!isAcceptableEmail(email)) {
        return h.view('sign-in/index', {
          pageTitle: 'Sign in',
          email,
          errorMessage: 'Enter your Defra email address, like name@defra.gov.uk'
        })
      }

      if (config.get('isProduction') && !isMagicLinkNotifyConfigured()) {
        return h.view('sign-in/index', {
          pageTitle: 'Sign in',
          email,
          errorMessage:
            'Sign in is not available because email sending is not configured on this service. Contact an administrator.'
        })
      }

      // Only approved people get an email, but the response is identical
      // either way so addresses cannot be enumerated.
      const person = await backendApi.getPersonByEmail(email)
      if (person?.approved) {
        const token = await request.server.magicLinks.issue(email)
        const signInLink = `${config.get('appBaseUrl')}/sign-in/verify?token=${token}`
        try {
          await sendMagicLinkEmail(email, signInLink)
        } catch (error) {
          logger.error(error, 'Failed to send sign-in email')
        }
      } else {
        logger.info(`Sign-in requested for unknown or unapproved email`)
      }

      request.yar.flash('signInEmail', email)
      return h.redirect('/sign-in/check-email')
    }
  },
  {
    method: 'GET',
    path: '/sign-in/check-email',
    handler(request, h) {
      const [email] = request.yar.flash('signInEmail')
      return h.view('sign-in/check-email', {
        pageTitle: 'Check your email',
        email
      })
    }
  },
  {
    method: 'GET',
    path: '/sign-in/verify',
    async handler(request, h) {
      const email = await request.server.magicLinks.consume(request.query.token)
      if (!email) {
        return h.view('sign-in/invalid-link', {
          pageTitle: 'This sign-in link has expired'
        })
      }

      const person = await backendApi.getPersonByEmail(email)
      if (!person || !person.approved) {
        return h.view('sign-in/invalid-link', {
          pageTitle: 'This sign-in link has expired'
        })
      }

      if (!person.activatedAt) {
        await backendApi.activatePerson(person.id)
      }

      request.yar.set('user', buildSessionUser(person))
      return h.redirect('/browse')
    }
  },
  {
    method: 'POST',
    path: '/sign-out',
    handler(request, h) {
      request.yar.reset()
      return h.redirect('/')
    }
  }
]
