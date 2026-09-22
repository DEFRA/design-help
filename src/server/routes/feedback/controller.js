import {
  isFeedbackNotifyConfigured,
  sendFeedbackEmail
} from '#/server/common/helpers/notify.js'
import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

const HOW_EASY_OPTIONS = [
  'Very easy',
  'Easy',
  'Neither easy nor difficult',
  'Difficult',
  'Very difficult'
]

function sanitiseReturnPath(raw) {
  if (raw === undefined || raw === null) {
    return '/'
  }
  const path = String(raw).trim()
  if (!path.startsWith('/') || path.startsWith('//') || path.length > 512) {
    return '/'
  }
  return path
}

export const feedbackRoutes = [
  {
    method: 'GET',
    path: '/feedback',
    handler(request, h) {
      return h.view('feedback/index', {
        pageTitle: 'Give feedback',
        returnPath: sanitiseReturnPath(request.query.return),
        errors: null,
        values: { details: '', contact_email: '', how_easy: '' },
        howEasyOptions: HOW_EASY_OPTIONS
      })
    }
  },
  {
    method: 'POST',
    path: '/feedback',
    async handler(request, h) {
      const returnPath = sanitiseReturnPath(request.payload.return_path)
      const details = String(request.payload.details ?? '').trim()
      const contactEmail = String(request.payload.contact_email ?? '').trim()
      const howEasyRaw = String(request.payload.how_easy ?? '').trim()
      const howEasy = HOW_EASY_OPTIONS.includes(howEasyRaw) ? howEasyRaw : ''

      const values = {
        details,
        contact_email: contactEmail,
        how_easy: howEasy
      }
      const renderWithErrors = (errors) =>
        h
          .view('feedback/index', {
            pageTitle: 'Give feedback',
            returnPath,
            errors,
            values,
            howEasyOptions: HOW_EASY_OPTIONS
          })
          .code(400)

      const errors = {}
      if (!details) {
        errors.details = 'Enter your feedback'
      } else if (details.length > 4000) {
        errors.details = 'Feedback must be 4000 characters or fewer'
      }
      if (contactEmail.length > 255) {
        errors.contact_email = 'Email address is too long'
      } else if (
        contactEmail &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
      ) {
        errors.contact_email =
          'Enter an email address in the correct format, or leave this blank'
      }
      if (Object.keys(errors).length > 0) {
        return renderWithErrors(errors)
      }

      const easeLine = howEasy
        ? `How easy was this service to use: ${howEasy}\n\n`
        : ''
      const personalisation = {
        feedback_details: easeLine + details,
        page_path: returnPath,
        contact_email: contactEmail || 'Not provided',
        signed_in_as: request.app.user?.email ?? 'Not signed in'
      }

      if (config.get('isProduction') && !isFeedbackNotifyConfigured()) {
        return renderWithErrors({
          _form:
            'Sending feedback is not available yet. Ask the team to add a GOV.UK Notify feedback template (NOTIFY_FEEDBACK_TEMPLATE_ID).'
        })
      }

      try {
        await sendFeedbackEmail(personalisation)
      } catch (error) {
        logger.error(error, 'Feedback Notify send failed')
        return renderWithErrors({
          _form: 'Your feedback could not be sent. Try again in a few minutes.'
        })
      }

      return h.redirect('/feedback/thank-you').code(303)
    }
  },
  {
    method: 'GET',
    path: '/feedback/thank-you',
    handler(_request, h) {
      return h.view('feedback/thank-you', {
        pageTitle: 'Thank you for your feedback'
      })
    }
  }
]
