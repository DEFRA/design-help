import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'
import { requireAdmin } from './access.js'
import { normaliseEmailInput } from './helpers.js'
import {
  DUPLICATE_EMAIL_MESSAGE,
  validateNameAndEmail
} from './team-member-controller.js'

/*
 * "Add a person": the one way to add someone from People and access. Any
 * admin can add a name and Defra email address; job title, line manager and
 * admin access are set afterwards with Change, and the person can be invited
 * from their row.
 */

const FORM_PATH = '/admin/people/new'
const TITLE = 'Add a person'
const FIELD_ORDER = ['name', 'email']

function readForm(payload = {}) {
  return {
    name: String(payload.name ?? '').trim(),
    email: normaliseEmailInput(payload.email)
  }
}

function isOnList(email, people) {
  return people.some((person) => normaliseEmailInput(person.email) === email)
}

/** Where the Head of Design can change the person who already has this email. */
function duplicateChangeHrefFor(email, people, user) {
  if (!user?.isHeadOfDesignSuperUser) {
    return null
  }
  const clash = people.find(
    (person) => normaliseEmailInput(person.email) === email
  )
  return clash?.id ? `/admin/team-member/${clash.id}` : null
}

function viewContext({ form, errors = {}, duplicateChangeHref = null }) {
  return {
    pageTitle: Object.keys(errors).length ? `Error: ${TITLE}` : TITLE,
    heading: TITLE,
    formAction: FORM_PATH,
    form,
    errors,
    errorList: FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
      text: errors[field],
      href: `#${field}`
    })),
    duplicateChangeHref
  }
}

export const addPersonRoutes = [
  {
    method: 'GET',
    path: FORM_PATH,
    handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }
      return h.view('admin/add-person', viewContext({ form: readForm() }))
    }
  },
  {
    method: 'POST',
    path: FORM_PATH,
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const user = request.app.user
      const form = readForm(request.payload)
      const errors = validateNameAndEmail(form)
      const repaint = (errs, extra = {}) =>
        h
          .view(
            'admin/add-person',
            viewContext({ form, errors: errs, ...extra })
          )
          .code(400)

      if (Object.keys(errors).length) {
        return repaint(errors)
      }

      const people = await backendApi.listPeople()
      const duplicate = () =>
        repaint(
          { email: DUPLICATE_EMAIL_MESSAGE },
          {
            duplicateChangeHref: duplicateChangeHrefFor(
              form.email,
              people,
              user
            )
          }
        )

      if (isOnList(form.email, people)) {
        return duplicate()
      }

      let created
      try {
        created = await backendApi.createPerson({
          email: form.email,
          name: form.name
        })
      } catch (err) {
        if (err instanceof BackendApiError && err.statusCode === 409) {
          return duplicate()
        }
        throw err
      }

      return h.redirect(
        `/admin/users?saved=added&person=${encodeURIComponent(created.id)}`
      )
    }
  }
]
