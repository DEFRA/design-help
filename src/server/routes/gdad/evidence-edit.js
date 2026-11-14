import Boom from '@hapi/boom'

import {
  BackendApiError,
  backendApi
} from '#/server/common/helpers/backend-api.js'
import { canEditGdadEvidenceForTarget } from '#/server/common/helpers/gdad/access.js'
import {
  MAX_EVIDENCE_LENGTH,
  SKILL_KEY_SET,
  getFrameworkRolePageLabel,
  roleFrameworkPageUrl
} from '#/server/common/helpers/gdad/constants.js'
import {
  buildSkillRows,
  requireOwnApplicablePerson,
  requireReviewableTarget
} from './helpers.js'
import { possessive } from './scores-notify.js'

/*
 * Writing a skill's evidence: editing the current evidence, starting or
 * editing new evidence (towards the next review) and discarding new
 * evidence. The same pages serve the designer (/my-gdad-evidence/...) and
 * the Head of Design working on their behalf (/review/gdad-evidence/...).
 */

/** Line endings and surrounding spaces don’t count as a change. */
export function normaliseForCompare(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
}

/**
 * Whether the backend records who saved evidence. The live backend may be
 * older than this frontend, and an older one refuses a save that says who
 * made it. A newer one always returns `evidenceUpdatedById` (even as null)
 * on every skill, so only send it when the person record shows that key.
 */
export function backendRecordsUpdatedBy(person) {
  return Object.values(person?.gdad ?? {}).some(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      Object.hasOwn(entry, 'evidenceUpdatedById')
  )
}

/** The signed-in user's id, if the backend can take it. */
export function updatedByIdFor(request, person) {
  return backendRecordsUpdatedBy(person) ? request.app.user.id : undefined
}

/** Where each save goes back to, as a query string on the reading page. */
const OWN_RESULTS = {
  saved: 'saved=1',
  unchanged: 'unchanged=1',
  newSaved: 'saved=new',
  newUnchanged: 'unchanged=new',
  newDiscarded: 'discarded=new'
}

const BEHALF_RESULTS = {
  saved: 'evidence=saved',
  unchanged: 'evidence=unchanged',
  newSaved: 'evidence=new-saved',
  newUnchanged: 'evidence=new-unchanged',
  newDiscarded: 'evidence=new-discarded'
}

const BANNERS = {
  saved: { success: true, own: 'Evidence saved', behalf: 'Evidence saved' },
  unchanged: {
    own: 'Your evidence was not changed.',
    behalf: 'The evidence was not changed.'
  },
  newSaved: {
    success: true,
    own: 'New evidence saved',
    behalf: 'New evidence saved'
  },
  newUnchanged: {
    own: 'Your new evidence was not changed.',
    behalf: 'The new evidence was not changed.'
  },
  newDiscarded: {
    success: true,
    own: 'New evidence discarded',
    behalf: 'New evidence discarded'
  }
}

/**
 * The banner to show on a skill's reading page after an evidence save,
 * or null. `{ success, text }`.
 */
export function evidenceBannerFromQuery(query, { isOwn }) {
  const results = isOwn ? OWN_RESULTS : BEHALF_RESULTS
  for (const [result, pair] of Object.entries(results)) {
    const [key, value] = pair.split('=')
    if (query?.[key] === value) {
      const banner = BANNERS[result]
      return {
        success: Boolean(banner.success),
        text: isOwn ? banner.own : banner.behalf
      }
    }
  }
  return null
}

function contextFor(request, person, skillKey, { isOwn, skillUrl }) {
  const skill = buildSkillRows(person.gdad, person.role).find(
    (s) => s.key === skillKey
  )
  return {
    request,
    person,
    skill,
    skillKey,
    skillUrl,
    isOwn,
    personName: person.name,
    results: isOwn ? OWN_RESULTS : BEHALF_RESULTS
  }
}

function validSkillKey(request) {
  const skillKey = String(request.params.skillKey ?? '').trim()
  return SKILL_KEY_SET.has(skillKey) ? skillKey : null
}

/** The signed-in designer's own skill. */
export async function resolveOwnSkill(request, h) {
  const skillKey = validSkillKey(request)
  if (!skillKey) {
    return { response: Boom.notFound() }
  }
  const { person, response } = await requireOwnApplicablePerson(request, h)
  if (response) {
    return { response }
  }
  return {
    ctx: contextFor(request, person, skillKey, {
      isOwn: true,
      skillUrl: `/my-gdad-evidence/${encodeURIComponent(skillKey)}`
    })
  }
}

/** Someone else's skill, for the Head of Design only. */
export async function resolveBehalfSkill(request, h) {
  const skillKey = validSkillKey(request)
  if (!skillKey) {
    return { response: Boom.notFound() }
  }
  const { target, response } = await requireReviewableTarget(request, h)
  if (response) {
    return { response }
  }
  if (!canEditGdadEvidenceForTarget(request.app.user, target)) {
    return {
      response: Boom.forbidden(
        'Only the Head of Design can change GDaD evidence for someone else.'
      )
    }
  }
  return {
    ctx: contextFor(request, target, skillKey, {
      isOwn: false,
      skillUrl: `/review/gdad-evidence/${target.id}/${encodeURIComponent(skillKey)}`
    })
  }
}

function backTo(h, ctx, result) {
  return h.redirect(
    result ? `${ctx.skillUrl}?${ctx.results[result]}` : ctx.skillUrl
  )
}

function pageContext(ctx) {
  return {
    skill: ctx.skill,
    skillUrl: ctx.skillUrl,
    isOwn: ctx.isOwn,
    personName: ctx.personName,
    personNamePossessive: possessive(ctx.personName),
    frameworkRolePageUrl: roleFrameworkPageUrl(ctx.person.role),
    frameworkRoleLabel: getFrameworkRolePageLabel(ctx.person.role)
  }
}

function evidenceLabel(isOwn, isNew) {
  if (isOwn) {
    return isNew ? 'Your new evidence' : 'Your evidence'
  }
  return isNew ? 'New evidence' : 'Evidence'
}

/**
 * The page with the evidence box. `mode` is 'current' or 'new'.
 * `evidenceValue` is what was typed, when the form comes back with an
 * error; otherwise the saved evidence is shown.
 */
function editView(h, ctx, mode, { error = null, evidenceValue } = {}) {
  const isNew = mode === 'new'
  const saved = isNew ? ctx.skill.newEvidenceText : ctx.skill.evidenceText
  const heading = isNew ? 'New evidence' : 'Edit evidence'
  return h
    .view('gdad/skill-edit', {
      ...pageContext(ctx),
      pageTitle: `${heading}: ${ctx.skill.label} — GDaD evidence`,
      mode,
      isNewEvidence: isNew,
      captionText: heading,
      evidenceLabel: evidenceLabel(ctx.isOwn, isNew),
      formAction: `${ctx.skillUrl}/${isNew ? 'new' : 'edit'}`,
      error,
      evidenceValue: evidenceValue ?? saved
    })
    .code(error ? 400 : 200)
}

/** The typed evidence, or `{ response }` when it is too long. */
function readEvidence(h, ctx, mode) {
  const raw = ctx.request.payload?.[`evidence_${ctx.skillKey}`]
  const text = String(raw ?? '').trim()
  if (text.length > MAX_EVIDENCE_LENGTH) {
    return {
      response: editView(h, ctx, mode, {
        error: `Evidence must be ${MAX_EVIDENCE_LENGTH.toLocaleString('en-GB')} characters or fewer`,
        evidenceValue: text
      })
    }
  }
  return { text }
}

/** New evidence can be written once the current evidence is scored. */
function canWriteNewEvidence(skill) {
  return skill.hasNewEvidence || skill.canStartNewEvidence
}

/**
 * A refused new-evidence save (for example the current evidence was
 * removed meanwhile) goes back to the reading page, which shows what is
 * there now.
 */
function isRefusal(error) {
  return (
    error instanceof BackendApiError &&
    (error.statusCode === 400 || error.statusCode === 409)
  )
}

function withResolve(resolve, handler) {
  return async (request, h) => {
    const { ctx, response } = await resolve(request, h)
    return response ?? handler(ctx, h)
  }
}

const handlers = {
  getEdit(ctx, h) {
    // While there is new evidence, the current evidence is read-only
    if (ctx.skill.hasNewEvidence) {
      return backTo(h, ctx)
    }
    return editView(h, ctx, 'current')
  },
  async postEdit(ctx, h) {
    if (ctx.skill.hasNewEvidence) {
      return backTo(h, ctx)
    }
    const { text, response } = readEvidence(h, ctx, 'current')
    if (response) {
      return response
    }
    // Saving the same text again would still mark the skill as updated and
    // ask the reviewer to score it again, so leave it alone
    if (
      normaliseForCompare(ctx.skill.evidenceText) === normaliseForCompare(text)
    ) {
      return backTo(h, ctx, 'unchanged')
    }
    await backendApi.saveGdadEvidence(
      ctx.person.id,
      { [ctx.skillKey]: text },
      updatedByIdFor(ctx.request, ctx.person)
    )
    return backTo(h, ctx, 'saved')
  },
  getNew(ctx, h) {
    if (!canWriteNewEvidence(ctx.skill)) {
      return backTo(h, ctx)
    }
    return editView(h, ctx, 'new')
  },
  async postNew(ctx, h) {
    if (!canWriteNewEvidence(ctx.skill)) {
      return backTo(h, ctx)
    }
    const { text, response } = readEvidence(h, ctx, 'new')
    if (response) {
      return response
    }
    if (
      normaliseForCompare(ctx.skill.newEvidenceText) ===
      normaliseForCompare(text)
    ) {
      return backTo(h, ctx, 'newUnchanged')
    }
    try {
      await backendApi.saveGdadNewEvidence(
        ctx.person.id,
        { [ctx.skillKey]: text },
        ctx.request.app.user.id
      )
    } catch (error) {
      if (isRefusal(error)) {
        return backTo(h, ctx)
      }
      throw error
    }
    // Saving it blank discards the new evidence
    return backTo(h, ctx, text ? 'newSaved' : 'newDiscarded')
  },
  getDiscard(ctx, h) {
    if (!ctx.skill.hasNewEvidence) {
      return backTo(h, ctx)
    }
    return h.view('gdad/skill-discard-new', {
      ...pageContext(ctx),
      pageTitle: `Discard new evidence: ${ctx.skill.label} — GDaD evidence`
    })
  },
  async postDiscard(ctx, h) {
    if (!ctx.skill.hasNewEvidence) {
      return backTo(h, ctx)
    }
    try {
      await backendApi.saveGdadNewEvidence(
        ctx.person.id,
        { [ctx.skillKey]: '' },
        ctx.request.app.user.id
      )
    } catch (error) {
      if (isRefusal(error)) {
        return backTo(h, ctx)
      }
      throw error
    }
    return backTo(h, ctx, 'newDiscarded')
  }
}

/**
 * The edit, new and discard-new routes under `basePath` (which ends in
 * `{skillKey}`), checked by `resolve`.
 */
export function buildEvidenceWriteRoutes(basePath, resolve) {
  return [
    { method: 'GET', path: `${basePath}/edit`, handler: handlers.getEdit },
    { method: 'POST', path: `${basePath}/edit`, handler: handlers.postEdit },
    { method: 'GET', path: `${basePath}/new`, handler: handlers.getNew },
    { method: 'POST', path: `${basePath}/new`, handler: handlers.postNew },
    {
      method: 'GET',
      path: `${basePath}/discard-new`,
      handler: handlers.getDiscard
    },
    {
      method: 'POST',
      path: `${basePath}/discard-new`,
      handler: handlers.postDiscard
    }
  ].map((route) => ({ ...route, handler: withResolve(resolve, route.handler) }))
}

/** Saving current evidence from the old form address. */
export const saveOwnEvidenceHandler = withResolve(
  resolveOwnSkill,
  handlers.postEdit
)
