import Boom from '@hapi/boom'

import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'
import { isBootstrapAdminEmail } from '#/server/common/helpers/auth/user-session.js'
import { requireAdmin, requireHeadOfDesign } from './access.js'
import {
  adminMessageFor,
  buildAdminUserRows,
  isAcceptableAdminEmail,
  normaliseEmailInput
} from './helpers.js'

export const usersRoutes = [
  {
    method: 'GET',
    path: '/admin/users',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const people = await backendApi.listPeople()
      const rows = buildAdminUserRows(people)
      const adminMsg = adminMessageFor(request.query.adminMsg)

      return h.view('admin/users', {
        pageTitle: 'Admin',
        rows,
        adminMsg
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/users/grant-admin',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const email = normaliseEmailInput(request.payload?.email)
      if (!email) {
        return h.redirect('/admin/users?adminMsg=admin-no-email')
      }
      if (!isAcceptableAdminEmail(email)) {
        return h.redirect('/admin/users?adminMsg=not-defra')
      }
      if (isBootstrapAdminEmail(email)) {
        return h.redirect('/admin/users?adminMsg=admin-already')
      }

      const person = await backendApi.getPersonByEmail(email)
      if (!person) {
        return h.redirect('/admin/users?adminMsg=admin-not-listed')
      }
      if (person.isAdmin) {
        return h.redirect('/admin/users?adminMsg=admin-already')
      }

      await backendApi.setAdmin(person.id, true)
      return h.redirect('/admin/users?adminMsg=admin-granted')
    }
  },
  {
    method: 'POST',
    path: '/admin/users/revoke-admin',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const email = normaliseEmailInput(request.payload?.email)
      if (!email) {
        return h.redirect('/admin/users?adminMsg=admin-no-email')
      }
      if (isBootstrapAdminEmail(email)) {
        return h.redirect('/admin/users?adminMsg=admin-protected')
      }

      const person = await backendApi.getPersonByEmail(email)
      if (person?.isAdmin) {
        await backendApi.setAdmin(person.id, false)
      }
      return h.redirect('/admin/users?adminMsg=admin-revoked')
    }
  },
  {
    method: 'POST',
    path: '/admin/approved-emails',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const email = normaliseEmailInput(request.payload?.email)
      if (!email) {
        return h.redirect('/admin/users?adminMsg=missing')
      }
      if (!isAcceptableAdminEmail(email)) {
        return h.redirect('/admin/users?adminMsg=not-defra')
      }

      try {
        await backendApi.createPerson({ email })
      } catch (error) {
        if (error instanceof BackendApiError && error.statusCode === 409) {
          return h.redirect('/admin/users?adminMsg=duplicate')
        }
        throw error
      }
      return h.redirect('/admin/users')
    }
  },
  {
    method: 'GET',
    path: '/admin/approved-emails/{id}/confirm-delete',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const person = await backendApi.getPerson(request.params.id)
      if (!person) {
        return Boom.notFound('Not found')
      }

      return h.view('admin/confirm-remove', {
        pageTitle: 'Remove email',
        kind: 'email',
        emailRow: { id: person.id, email: person.email }
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/approved-emails/{id}/delete',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      await backendApi.deletePerson(request.params.id, 'full')
      return h.redirect('/admin/users')
    }
  },
  {
    method: 'GET',
    path: '/admin/profile/{id}/confirm-delete',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const person = await backendApi.getPerson(request.params.id)
      if (!person?.name) {
        return Boom.notFound('Profile not found')
      }

      return h.view('admin/confirm-remove', {
        pageTitle: 'Remove person',
        kind: 'profile',
        profile: person,
        displayEmail: person.email,
        profileId: person.id
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/profile/{id}/delete',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const person = await backendApi.getPerson(request.params.id)
      if (!person) {
        return Boom.notFound('Profile not found')
      }

      const removeApproved =
        String(request.payload?.remove_approved ?? '') === 'yes'
      const mode = removeApproved && person.email ? 'full' : 'profile'
      await backendApi.deletePerson(person.id, mode)
      return h.redirect('/admin/users')
    }
  }
]
