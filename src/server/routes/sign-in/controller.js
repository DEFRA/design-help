import { timingSafeEqual } from 'node:crypto'

import { config } from '#/config/config.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { buildSessionUser } from '#/server/common/helpers/auth/user-session.js'
import { sendMagicLinkEmail } from '#/server/common/helpers/notify.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { isSignInAvailable } from '#/server/common/helpers/auth/sign-in-availability.js'

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
      if (!isSignInAvailable()) {
        return h.view('sign-in/unavailable', {
          pageTitle: 'Sign in is not available yet'
        })
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

      if (!isSignInAvailable()) {
        return h.view('sign-in/unavailable', {
          pageTitle: 'Sign in is not available yet'
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
  },
  /**
   * Temporary side door while GOV.UK Notify is not yet configured:
   * sign in with your email plus a shared access code held in the
   * DEV_SIGN_IN_CODE secret. The route 404s whenever that secret is
   * unset, so removing the secret removes the door. The allow-list
   * still applies — the code only replaces the emailed link.
   */
  {
    method: 'GET',
    path: '/sign-in/dev',
    handler(request, h) {
      if (!config.get('auth.devSignInCode')) {
        return h.response().code(404)
      }
      if (request.app.user) {
        return h.redirect('/browse')
      }
      return h.view('sign-in/dev', { pageTitle: 'Sign in with access code' })
    }
  },
  {
    method: 'POST',
    path: '/sign-in/dev',
    async handler(request, h) {
      const expectedCode = config.get('auth.devSignInCode')
      if (!expectedCode) {
        return h.response().code(404)
      }

      const email = String(request.payload?.email ?? '')
        .trim()
        .toLowerCase()
      const code = String(request.payload?.code ?? '').trim()
      const codeMatches =
        code.length === expectedCode.length &&
        timingSafeEqual(Buffer.from(code), Buffer.from(expectedCode))

      const person = codeMatches
        ? await backendApi.getPersonByEmail(email)
        : null
      if (!person || !person.approved) {
        logger.info('Access-code sign-in rejected')
        return h
          .view('sign-in/dev', {
            pageTitle: 'Sign in with access code',
            email,
            errorMessage:
              'The access code and email did not match. Check both and try again.'
          })
          .code(400)
      }

      if (!person.activatedAt) {
        await backendApi.activatePerson(person.id)
      }
      request.yar.set('user', buildSessionUser(person))
      return h.redirect('/browse')
    }
  }
]
