import { backendApi } from '#/server/common/helpers/backend-api.js'
import { getHeadOfDesignEmails } from '#/server/common/helpers/auth/user-session.js'
import { isGdadEvidenceApplicableRole } from '#/server/common/helpers/gdad/constants.js'
import {
  ALLOWED_ROLES,
  AVAILABILITY_STATUSES,
  AVAILABLE_TAGS,
  MAX_FREE_TEXT_WORDS,
  ROLE_GROUPS,
  countWords,
  personPath
} from '#/server/common/constants/design-help.js'

function parseTagList(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  return value ? [value] : []
}

/**
 * Shared with the admin edit form: validates a posted profile and returns
 * { fields, error }. The Head of Design job title is reserved for the
 * configured emails.
 */
export function validateProfilePayload(payload, { email }) {
  const name = String(payload.name ?? '').trim()
  const role = String(payload.role ?? '').trim()
  const location = String(payload.location ?? '').trim()
  const experience = String(payload.experience ?? '').trim()
  const availabilityStatus = String(payload.availabilityStatus ?? '').trim()
  const canHelpWithText = String(payload.canHelpWithText ?? '').trim()
  const developmentGoalsText = String(payload.developmentGoalsText ?? '').trim()
  const bio = String(payload.about ?? '').trim()
  const linkedinProfile = String(payload.linkedinProfile ?? '').trim()

  if (!name || !role || !location || !experience || !availabilityStatus) {
    return { error: 'Fill in all required fields.' }
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return { error: 'Select a job title from the list.' }
  }
  if (!AVAILABILITY_STATUSES.includes(availabilityStatus)) {
    return { error: 'Select an availability from the list.' }
  }
  if (
    role === 'Head of Design' &&
    !getHeadOfDesignEmails().includes(String(email ?? '').toLowerCase())
  ) {
    return {
      error:
        'The Head of Design job title is reserved. Choose a different job title.'
    }
  }
  if (countWords(canHelpWithText) > MAX_FREE_TEXT_WORDS) {
    return {
      error: `“Can help with” free text must be ${MAX_FREE_TEXT_WORDS} words or fewer.`
    }
  }
  if (countWords(developmentGoalsText) > MAX_FREE_TEXT_WORDS) {
    return {
      error: `“What I would like help with” must be ${MAX_FREE_TEXT_WORDS} words or fewer.`
    }
  }
  if (linkedinProfile && !/^https?:\/\//i.test(linkedinProfile)) {
    return { error: 'LinkedIn profile link must start with http or https.' }
  }

  return {
    fields: {
      name,
      role,
      location,
      experience,
      availabilityStatus,
      canHelpWith: parseTagList(payload.canHelpWithTags),
      canHelpWithText: canHelpWithText || null,
      developmentGoalsText: developmentGoalsText || null,
      bio: bio || null,
      linkedinProfile: linkedinProfile || null,
      projectTeam: String(payload.projectTeam ?? '').trim() || null,
      deliveryGroup: String(payload.deliveryGroup ?? '').trim() || null
    }
  }
}

async function getOwnPerson(request) {
  return backendApi.getPerson(request.app.user.id)
}

export const myProfileRoutes = [
  {
    method: 'GET',
    path: '/my-profile',
    async handler(request, h) {
      const person = await getOwnPerson(request)
      const hasProfile = Boolean(person?.name)

      let helpingPeople = []
      if (hasProfile && person.helping.length > 0) {
        const everyone = await backendApi.listPeople()
        const byId = new Map(everyone.map((p) => [p.id, p]))
        helpingPeople = person.helping
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((p) => ({ name: p.name, path: personPath(p) }))
      }

      return h.view('my-profile/index', {
        pageTitle: 'My profile',
        profile: hasProfile ? person : null,
        helpingPeople,
        gdadEvidenceApplicable:
          hasProfile && isGdadEvidenceApplicableRole(person.role)
      })
    }
  },
  {
    method: 'GET',
    path: '/add-profile',
    handler(_request, h) {
      return h.redirect('/my-profile/edit')
    }
  },
  {
    method: 'GET',
    path: '/my-profile/edit',
    async handler(request, h) {
      const person = await getOwnPerson(request)
      return h.view('my-profile/edit', {
        pageTitle: person?.name ? 'Update your profile' : 'Create my profile',
        profile: person?.name ? person : null,
        availableTags: AVAILABLE_TAGS,
        roleGroups: ROLE_GROUPS,
        availabilityStatuses: AVAILABILITY_STATUSES
      })
    }
  },
  {
    method: 'POST',
    path: '/my-profile/edit',
    async handler(request, h) {
      const person = await getOwnPerson(request)
      const { fields, error } = validateProfilePayload(request.payload, {
        email: request.app.user.email
      })

      const viewContext = {
        pageTitle: person?.name ? 'Update your profile' : 'Create my profile',
        availableTags: AVAILABLE_TAGS,
        roleGroups: ROLE_GROUPS,
        availabilityStatuses: AVAILABILITY_STATUSES
      }

      if (error) {
        return h
          .view('my-profile/edit', {
            ...viewContext,
            error,
            profile: { ...person, ...request.payload }
          })
          .code(400)
      }

      const updated = await backendApi.updatePerson(request.app.user.id, fields)
      return h.view('my-profile/edit', {
        ...viewContext,
        success: true,
        profile: updated
      })
    }
  },
  {
    method: 'GET',
    path: '/my-profile/helping',
    async handler(request, h) {
      const person = await getOwnPerson(request)
      if (!person?.name) {
        return h.redirect('/my-profile/edit')
      }
      const everyone = await backendApi.listPeople()
      const designerOptions = everyone
        .filter((p) => p.name && p.id !== person.id)
        .map((p) => ({ id: p.id, name: p.name }))

      const helpingRows = person.helping.map((id, index) => ({
        index,
        selectedId: id
      }))
      if (helpingRows.length === 0) {
        helpingRows.push({ index: 0, selectedId: null })
      }

      return h.view('my-profile/helping', {
        pageTitle: 'Who I’m helping',
        profile: person,
        designerOptions,
        helpingRows,
        saved: Boolean(request.query.saved)
      })
    }
  },
  {
    method: 'POST',
    path: '/my-profile/helping',
    async handler(request, h) {
      const availabilityStatus = String(
        request.payload.availabilityStatus ?? ''
      ).trim()
      if (!AVAILABILITY_STATUSES.includes(availabilityStatus)) {
        return h.redirect('/my-profile/helping')
      }

      const helpeeIds = parseTagList(request.payload.helpeeProfileId).filter(
        (id) => /^[a-f0-9]{24}$/.test(id)
      )

      await backendApi.setHelping(
        request.app.user.id,
        availabilityStatus,
        helpeeIds
      )
      return h.redirect('/my-profile/helping?saved=1')
    }
  }
]
