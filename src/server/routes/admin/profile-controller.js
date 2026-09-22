import Boom from '@hapi/boom'

import {
  backendApi,
  BackendApiError
} from '#/server/common/helpers/backend-api.js'
import { validateProfilePayload } from '#/server/routes/my-profile/controller.js'
import { getHeadOfDesignEmails } from '#/server/common/helpers/auth/user-session.js'
import {
  AVAILABILITY_STATUSES,
  AVAILABLE_TAGS,
  MAX_FREE_TEXT_WORDS,
  ROLE_GROUPS,
  countWords,
  personPath
} from '#/server/common/constants/design-help.js'
import { requireAdmin } from './access.js'
import {
  ADMIN_PROFILE_WIZARD_STEPS,
  getNextStep,
  getPreviousStep,
  getWizardStep,
  isAcceptableAdminEmail,
  normaliseAllowedRole,
  normaliseAvailabilityStatus,
  normaliseEmailInput,
  parseTagList
} from './helpers.js'

const DRAFT_SESSION_KEY = 'adminProfileDraft'

const formDefaults = {
  availableTags: AVAILABLE_TAGS,
  roleGroups: ROLE_GROUPS,
  availabilityStatuses: AVAILABILITY_STATUSES
}

function editViewContext(profileId, extra = {}) {
  return {
    ...formDefaults,
    pageTitle: 'Edit team member profile',
    formTitle: 'Edit team member profile',
    formAction: `/admin/users/${profileId}/edit`,
    adminReturnUrl: '/admin/users',
    isAdminMode: true,
    isWizardMode: false,
    ...extra
  }
}

/** Repaint the form from a rejected POST without losing the admin's input. */
function paintProfileFromPayload(person, payload, email) {
  return {
    ...person,
    name: payload.name,
    projectTeam: payload.projectTeam,
    deliveryGroup: payload.deliveryGroup,
    role: payload.role,
    location: payload.location,
    experience: payload.experience,
    availabilityStatus: payload.availabilityStatus,
    canHelpWith: parseTagList(payload.canHelpWithTags),
    canHelpWithText: payload.canHelpWithText,
    developmentGoalsText: payload.developmentGoalsText,
    bio: payload.about,
    linkedinProfile: payload.linkedinProfile,
    email
  }
}

function wizardViewContext(draft, step, extra = {}) {
  return {
    ...formDefaults,
    pageTitle: 'Add team member profile',
    formTitle: 'Add team member profile',
    formAction: '/admin/add-profile',
    adminReturnUrl: '/admin/users',
    isAdminMode: true,
    isWizardMode: true,
    wizardStep: step,
    wizardStepIndex: ADMIN_PROFILE_WIZARD_STEPS.indexOf(step) + 1,
    wizardStepCount: ADMIN_PROFILE_WIZARD_STEPS.length,
    profile: draft,
    ...extra
  }
}

/** Merge one step's posted fields into the yar-held wizard draft. */
export function mergeWizardDraft(draft, payload) {
  const updated = { ...draft }
  const setIfPosted = (key, value, transform = (v) => v) => {
    if (value !== undefined) {
      updated[key] = transform(value)
    }
  }

  setIfPosted('name', payload.name)
  setIfPosted('projectTeam', payload.projectTeam)
  setIfPosted('deliveryGroup', payload.deliveryGroup)
  setIfPosted('role', payload.role, (v) => normaliseAllowedRole(v) || v)
  setIfPosted('location', payload.location)
  setIfPosted(
    'availabilityStatus',
    payload.availabilityStatus,
    (v) => normaliseAvailabilityStatus(v) || v
  )
  setIfPosted('experience', payload.experience)
  setIfPosted('bio', payload.about)
  setIfPosted('linkedinProfile', payload.linkedinProfile)
  setIfPosted('canHelpWithText', payload.canHelpWithText)
  setIfPosted('developmentGoalsText', payload.developmentGoalsText)
  if (payload.canHelpWithTags !== undefined) {
    updated.canHelpWith = parseTagList(payload.canHelpWithTags)
  }
  if (payload.contactEmail !== undefined) {
    const email = normaliseEmailInput(payload.contactEmail)
    if (email) {
      updated.email = email
    }
  }
  return updated
}

/**
 * Wizard-step validation, ported from the prototype (details-step field
 * checks; word counts once free text is in play). Returns an error string
 * or null. The final step re-validates everything before the person is
 * created, so a draft broken by skipping steps cannot be saved.
 */
export function validateWizardStep(draft, step, { finalising = false } = {}) {
  const checkDetails = step === 'details' || finalising
  const checkFreeText =
    step === 'can-help' || step === 'development-goals' || finalising

  if (checkFreeText) {
    if (
      countWords(draft.canHelpWithText) > MAX_FREE_TEXT_WORDS ||
      countWords(draft.developmentGoalsText) > MAX_FREE_TEXT_WORDS
    ) {
      return 'Additional details must be 150 words or fewer for both "Can help with" and "Development goals".'
    }
  }

  if (checkDetails) {
    if (!normaliseAllowedRole(draft.role)) {
      return 'Select a valid GDaD job title from the list.'
    }
    if (
      normaliseAllowedRole(draft.role) === 'Head of Design' &&
      !getHeadOfDesignEmails().includes(normaliseEmailInput(draft.email))
    ) {
      return 'Only the designated Head of Design account can use the "Head of Design" job title.'
    }
    if (!normaliseAvailabilityStatus(draft.availabilityStatus)) {
      return 'Select a valid availability status from the list.'
    }
    if (!draft.name || !draft.location || !draft.experience) {
      return 'Name, job title, location and experience are required.'
    }
    if (!isAcceptableAdminEmail(String(draft.email ?? ''))) {
      return "Enter the team member's @defra.gov.uk email so they can register and appear on the approved list."
    }
  }

  return null
}

export const profileRoutes = [
  {
    method: 'GET',
    path: '/admin/users/{id}/edit',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const person = await backendApi.getPerson(request.params.id)
      if (!person) {
        return Boom.notFound('Profile not found')
      }

      return h.view(
        'admin/profile-form',
        editViewContext(person.id, { profile: person })
      )
    }
  },
  {
    method: 'POST',
    path: '/admin/users/{id}/edit',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const person = await backendApi.getPerson(request.params.id)
      if (!person) {
        return Boom.notFound('Profile not found')
      }

      const payload = request.payload ?? {}
      const emailInput = normaliseEmailInput(payload.contactEmail)
      const targetEmail = emailInput || person.email

      // The Head of Design title check runs against the profile owner's
      // (possibly updated) sign-in address, not the signed-in admin's.
      const { fields, error } = validateProfilePayload(payload, {
        email: targetEmail
      })

      let formError = error ?? null
      if (!formError && emailInput && !isAcceptableAdminEmail(emailInput)) {
        formError =
          'Defra email must be a valid @defra.gov.uk address (or leave blank).'
      }

      if (formError) {
        return h
          .view(
            'admin/profile-form',
            editViewContext(person.id, {
              error: formError,
              profile: paintProfileFromPayload(person, payload, targetEmail)
            })
          )
          .code(400)
      }

      const update = { ...fields }
      if (emailInput && emailInput !== person.email) {
        update.email = emailInput
      }

      try {
        await backendApi.updatePerson(person.id, update)
      } catch (err) {
        if (err instanceof BackendApiError && err.statusCode === 409) {
          return h
            .view(
              'admin/profile-form',
              editViewContext(person.id, {
                error:
                  'That email address is already used by another person on the list.',
                profile: paintProfileFromPayload(person, payload, targetEmail)
              })
            )
            .code(400)
        }
        throw err
      }

      return h.redirect('/admin/users')
    }
  },
  {
    method: 'GET',
    path: '/admin/add-profile',
    handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      if (String(request.query.new ?? '') === '1') {
        request.yar.clear(DRAFT_SESSION_KEY)
      }
      const step = getWizardStep(request.query.step)
      const draft = request.yar.get(DRAFT_SESSION_KEY) ?? {}
      return h.view('admin/profile-form', wizardViewContext(draft, step))
    }
  },
  {
    method: 'POST',
    path: '/admin/add-profile',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const payload = request.payload ?? {}
      const step = getWizardStep(payload.step)
      const draft = mergeWizardDraft(
        request.yar.get(DRAFT_SESSION_KEY) ?? {},
        payload
      )
      request.yar.set(DRAFT_SESSION_KEY, draft)

      if (payload.action === 'previous') {
        const prev = getPreviousStep(step) || 'details'
        return h.redirect(`/admin/add-profile?step=${prev}`)
      }

      const stepError = validateWizardStep(draft, step)
      if (stepError) {
        return h
          .view(
            'admin/profile-form',
            wizardViewContext(draft, step, { error: stepError })
          )
          .code(400)
      }

      const nextStep = getNextStep(step)
      if (nextStep) {
        return h.redirect(`/admin/add-profile?step=${nextStep}`)
      }

      const finalError = validateWizardStep(draft, step, { finalising: true })
      if (finalError) {
        return h
          .view(
            'admin/profile-form',
            wizardViewContext(draft, step, { error: finalError })
          )
          .code(400)
      }

      let created
      try {
        created = await backendApi.createPerson({
          email: draft.email,
          name: draft.name,
          role: normaliseAllowedRole(draft.role),
          location: draft.location,
          experience: draft.experience,
          availabilityStatus: normaliseAvailabilityStatus(
            draft.availabilityStatus
          ),
          bio: draft.bio || null,
          linkedinProfile: draft.linkedinProfile || null,
          projectTeam: draft.projectTeam || null,
          deliveryGroup: draft.deliveryGroup || null,
          canHelpWith: draft.canHelpWith ?? [],
          canHelpWithText: draft.canHelpWithText || null,
          developmentGoalsText: draft.developmentGoalsText || null
        })
      } catch (err) {
        const message =
          err instanceof BackendApiError && err.statusCode === 409
            ? 'A person with that email address is already on the list.'
            : 'Error saving profile'
        return h
          .view(
            'admin/profile-form',
            wizardViewContext(draft, step, { error: message })
          )
          .code(err instanceof BackendApiError ? 400 : 500)
      }

      request.yar.clear(DRAFT_SESSION_KEY)
      return h.view(
        'admin/profile-form',
        wizardViewContext({}, 'details', {
          success: true,
          newProfilePath: personPath(created)
        })
      )
    }
  }
]
