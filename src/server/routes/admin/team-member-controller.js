import Boom from '@hapi/boom'

import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'
import { getHeadOfDesignEmails } from '#/server/common/helpers/auth/user-session.js'
import { ALLOWED_ROLES } from '#/server/common/constants/design-help.js'
import { requireHeadOfDesign } from './access.js'
import { normaliseAllowedRole, normaliseEmailInput } from './helpers.js'

/*
 * One-page "Set up a team member" form for the Head of Design: name, Defra
 * email, job title, line manager and the line-manager flag. Directory
 * fields (location, availability and so on) are left for the designer to
 * fill in when they sign in.
 */

// Always Defra: these are real team members who will sign in with this
// address, so the relaxed local-development rule is not applied here.
const DEFRA_EMAIL_PATTERN = /^[^@\s]+@defra\.gov\.uk$/i
const MAX_NAME_LENGTH = 255
const NO_MANAGER = ''

function byName(a, b) {
  return String(a.name ?? a.email ?? '').localeCompare(
    String(b.name ?? b.email ?? ''),
    undefined,
    { sensitivity: 'base' }
  )
}

/** "Name (email)" when they have a name, otherwise just the email. */
export function managerLabel(person) {
  return person.name ? `${person.name} (${person.email})` : person.email
}

const MIN_MATCH_LENGTH = 2

function surnameOf(name) {
  const words = String(name ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const last = words.at(-1) ?? ''
  return last.length >= MIN_MATCH_LENGTH ? last : ''
}

/** The parts of an email before the @, e.g. "christopher.hawker2" -> christopher, hawker. */
function emailWords(email) {
  const local = String(email ?? '')
    .toLowerCase()
    .split('@')[0]
  return local
    .split(/[^a-z]+/)
    .filter((word) => word.length >= MIN_MATCH_LENGTH)
}

/**
 * People already on the list who might be the same person as the one being
 * added: same surname, or one's surname appears as a word in the other's
 * email (so "Chris Hawker" matches a nameless christopher.hawker@ entry).
 * Exact email clashes are left to the backend's duplicate check.
 */
export function findPossibleDuplicates(form, people) {
  const newSurname = surnameOf(form.name)
  const newEmailWords = emailWords(form.email)
  const newEmail = normaliseEmailInput(form.email)

  return people.filter((person) => {
    if (normaliseEmailInput(person.email) === newEmail) {
      return false
    }
    const theirSurname = surnameOf(person.name)
    if (newSurname && theirSurname === newSurname) {
      return true
    }
    if (newSurname && emailWords(person.email).includes(newSurname)) {
      return true
    }
    return Boolean(theirSurname) && newEmailWords.includes(theirSurname)
  })
}

/** Read the posted form into the shape the template repaints from. */
function readForm(payload = {}) {
  const raw = payload.isLineManager
  return {
    name: String(payload.name ?? '').trim(),
    email: normaliseEmailInput(payload.email),
    role: String(payload.role ?? '').trim(),
    managerId: String(payload.managerId ?? '').trim(),
    isLineManager: raw === 'yes' || raw === 'on' || raw === true,
    confirmedNotDuplicate: payload.confirmNotDuplicate === 'yes'
  }
}

function formFromPerson(person) {
  return {
    name: person.name ?? '',
    email: person.email ?? '',
    role: person.role ?? '',
    managerId: person.managerId ?? NO_MANAGER,
    isLineManager: Boolean(person.isLineManager)
  }
}

/**
 * Returns a map of field name -> message. `existing` is the person being
 * changed (null when adding), `people` everyone on the list.
 */
export function validateTeamMemberForm(form, { existing, people, user }) {
  const errors = {}

  if (!form.name) {
    errors.name = 'Enter their full name'
  } else if (form.name.length > MAX_NAME_LENGTH) {
    errors.name = `Full name must be ${MAX_NAME_LENGTH} characters or fewer`
  }

  if (!form.email) {
    errors.email = 'Enter their Defra email address'
  } else if (!DEFRA_EMAIL_PATTERN.test(form.email)) {
    errors.email =
      'Enter a Defra email address ending in @defra.gov.uk, like name@defra.gov.uk'
  }

  const role = normaliseAllowedRole(form.role)
  if (!role) {
    errors.role = 'Select their job title'
  } else if (
    role === 'Head of Design' &&
    !errors.email &&
    !getHeadOfDesignEmails().includes(form.email)
  ) {
    errors.role =
      'The Head of Design job title is reserved for the Head of Design. Choose a different job title'
  }

  // Changing your own email or job title would remove your Head of Design
  // access mid-session, so the form will not do it.
  if (existing && existing.id === user.id) {
    if (!errors.email && form.email !== normaliseEmailInput(existing.email)) {
      errors.email =
        'You cannot change your own email address here, because you would lose Head of Design access'
    }
    if (!errors.role && role !== existing.role) {
      errors.role =
        'You cannot change your own job title here, because you would lose Head of Design access'
    }
  }

  if (form.managerId) {
    if (existing && form.managerId === existing.id) {
      errors.managerId = 'A person cannot be their own line manager'
    } else {
      const manager = people.find((person) => person.id === form.managerId)
      if (!manager?.isLineManager) {
        errors.managerId =
          'Select a line manager from the list, or "No manager yet"'
      }
    }
  }

  return errors
}

const FIELD_ORDER = ['name', 'email', 'role', 'managerId']

function errorList(errors) {
  return FIELD_ORDER.filter((field) => errors[field]).map((field) => ({
    text: errors[field],
    href: `#${field}`
  }))
}

function viewContext({
  existing,
  form,
  people,
  errors = {},
  duplicateChangeHref = null,
  possibleDuplicates = []
}) {
  const managerOptions = people
    .filter((person) => person.isLineManager && person.id !== existing?.id)
    .sort(byName)
    .map((person) => ({
      value: person.id,
      text: managerLabel(person),
      selected: form.managerId === person.id
    }))

  const reportCount = existing
    ? people.filter((person) => person.managerId === existing.id).length
    : 0

  const title = existing ? 'Change team member' : 'Set up a team member'

  return {
    pageTitle: Object.keys(errors).length ? `Error: ${title}` : title,
    heading: title,
    formAction: existing
      ? `/admin/team-member/${existing.id}`
      : '/admin/team-member/new',
    isEdit: Boolean(existing),
    form,
    roleItems: [
      { value: '', text: 'Select a job title' },
      ...ALLOWED_ROLES.map((role) => ({
        value: role,
        text: role,
        selected: normaliseAllowedRole(form.role) === role
      }))
    ],
    managerItems: [
      {
        value: NO_MANAGER,
        text: 'No manager yet',
        selected: !form.managerId
      },
      ...managerOptions
    ],
    reportCount,
    wasLineManager: Boolean(existing?.isLineManager),
    errors,
    errorList: errorList(errors),
    duplicateChangeHref,
    possibleDuplicates: possibleDuplicates.sort(byName).map((person) => ({
      name: person.name || null,
      email: person.email,
      href: `/admin/team-member/${person.id}`
    }))
  }
}

/** Add or remove one person from the line-manager set, leaving others alone. */
function lineManagerIdsWith(people, personId, isLineManager) {
  const ids = new Set(
    people.filter((person) => person.isLineManager).map((person) => person.id)
  )
  if (isLineManager) {
    ids.add(personId)
  } else {
    ids.delete(personId)
  }
  return [...ids]
}

/** Apply the line-manager flag and manager allocation after create/update. */
async function applyManagement(people, personId, before, form) {
  if (Boolean(before.isLineManager) !== form.isLineManager) {
    await backendApi.replaceLineManagers(
      lineManagerIdsWith(people, personId, form.isLineManager)
    )
  }
  const wantedManagerId = form.managerId || null
  if (wantedManagerId !== (before.managerId ?? null)) {
    await backendApi.setManager(personId, wantedManagerId)
  }
}

const DUPLICATE_EMAIL_MESSAGE =
  'That email address is already on the list. Change their details instead of adding them again'

/** Where to change the person who already has this email, if we can find them. */
async function duplicateChangeHrefFor(email) {
  const clash = await backendApi.getPersonByEmail(email).catch(() => null)
  return clash?.id ? `/admin/team-member/${clash.id}` : null
}

function savedRedirect(h, personId, kind) {
  return h.redirect(
    `/admin/users?saved=${encodeURIComponent(kind)}&person=${encodeURIComponent(personId)}`
  )
}

export const teamMemberRoutes = [
  {
    method: 'GET',
    path: '/admin/team-member/new',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }
      const people = await backendApi.listPeople()
      return h.view(
        'admin/team-member',
        viewContext({ existing: null, form: readForm(), people })
      )
    }
  },
  {
    method: 'POST',
    path: '/admin/team-member/new',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }
      const people = await backendApi.listPeople()
      const form = readForm(request.payload)
      const errors = validateTeamMemberForm(form, {
        existing: null,
        people,
        user: request.app.user
      })
      const repaint = (errs, extra = {}) =>
        h
          .view(
            'admin/team-member',
            viewContext({
              existing: null,
              form,
              people,
              errors: errs,
              ...extra
            })
          )
          .code(400)

      if (Object.keys(errors).length) {
        return repaint(errors)
      }

      // Ask before adding someone who might already be on the list.
      if (!form.confirmedNotDuplicate) {
        const possibleDuplicates = findPossibleDuplicates(form, people)
        if (possibleDuplicates.length) {
          return h.view(
            'admin/team-member',
            viewContext({ existing: null, form, people, possibleDuplicates })
          )
        }
      }

      let created
      try {
        created = await backendApi.createPerson({
          email: form.email,
          name: form.name,
          role: normaliseAllowedRole(form.role)
        })
      } catch (err) {
        if (err instanceof BackendApiError && err.statusCode === 409) {
          return repaint(
            { email: DUPLICATE_EMAIL_MESSAGE },
            { duplicateChangeHref: await duplicateChangeHrefFor(form.email) }
          )
        }
        throw err
      }

      await applyManagement(
        people,
        created.id,
        { isLineManager: false, managerId: null },
        form
      )
      return savedRedirect(h, created.id, 'created')
    }
  },
  {
    method: 'GET',
    path: '/admin/team-member/{id}',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }
      const people = await backendApi.listPeople()
      const existing = people.find((person) => person.id === request.params.id)
      if (!existing) {
        return Boom.notFound('Team member not found')
      }
      return h.view(
        'admin/team-member',
        viewContext({ existing, form: formFromPerson(existing), people })
      )
    }
  },
  {
    method: 'POST',
    path: '/admin/team-member/{id}',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }
      const people = await backendApi.listPeople()
      const existing = people.find((person) => person.id === request.params.id)
      if (!existing) {
        return Boom.notFound('Team member not found')
      }

      const form = readForm(request.payload)
      const errors = validateTeamMemberForm(form, {
        existing,
        people,
        user: request.app.user
      })
      const repaint = (errs, extra = {}) =>
        h
          .view(
            'admin/team-member',
            viewContext({ existing, form, people, errors: errs, ...extra })
          )
          .code(400)

      if (Object.keys(errors).length) {
        return repaint(errors)
      }

      const update = { name: form.name, role: normaliseAllowedRole(form.role) }
      if (form.email !== normaliseEmailInput(existing.email)) {
        update.email = form.email
      }

      try {
        await backendApi.updatePerson(existing.id, update)
      } catch (err) {
        if (err instanceof BackendApiError && err.statusCode === 409) {
          return repaint(
            { email: DUPLICATE_EMAIL_MESSAGE },
            { duplicateChangeHref: await duplicateChangeHrefFor(form.email) }
          )
        }
        throw err
      }

      await applyManagement(people, existing.id, existing, form)
      return savedRedirect(h, existing.id, 'updated')
    }
  }
]
