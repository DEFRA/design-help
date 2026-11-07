import { backendApi } from '#/server/common/helpers/backend-api.js'
import { requireAdmin } from './access.js'
import {
  inviteLabel,
  inviteLinkLifetimeText,
  inviteResultBanner,
  isInvitable,
  sendInvites
} from './invites.js'

export const INVITE_RESULT_FLASH = 'inviteResult'

function sortByLabel(people) {
  return [...people].sort((a, b) =>
    inviteLabel(a).toLowerCase().localeCompare(inviteLabel(b).toLowerCase())
  )
}

/** Everyone on the list who has an email address and has never signed in. */
async function listInvitablePeople() {
  const people = await backendApi.listPeople()
  return sortByLabel(people.filter(isInvitable))
}

export const invitesRoutes = [
  {
    method: 'POST',
    path: '/admin/users/{id}/invite',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      // Look the person up again rather than trusting the form
      const person = await backendApi.getPerson(request.params.id)
      if (!isInvitable(person)) {
        return h.redirect('/admin/users?adminMsg=invite-not-pending')
      }

      const { sent } = await sendInvites(request.server, [person])
      const label = inviteLabel(person)
      request.yar.flash(
        INVITE_RESULT_FLASH,
        sent
          ? { isSuccess: true, text: `Invite sent to ${label}.` }
          : {
              isSuccess: false,
              text: `Couldn’t send an invite to ${label}. Try again later.`
            }
      )
      return h.redirect('/admin/users')
    }
  },
  {
    method: 'GET',
    path: '/admin/users/invite-pending',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const people = await listInvitablePeople()
      return h.view('admin/confirm-invite-all', {
        pageTitle: 'Invite everyone who’s pending',
        people: people.map((person) => ({
          name: person.name || null,
          email: person.email
        })),
        count: people.length,
        inviteLinkLifetime: inviteLinkLifetimeText()
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/users/invite-pending',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      // Work out who is pending now, not from the confirmation page
      const people = await listInvitablePeople()
      if (!people.length) {
        return h.redirect('/admin/users?adminMsg=invite-none-pending')
      }

      const { sent, failed } = await sendInvites(request.server, people)
      request.yar.flash(
        INVITE_RESULT_FLASH,
        inviteResultBanner({ sent, failedLabels: failed.map(inviteLabel) })
      )
      return h.redirect('/admin/users')
    }
  }
]
