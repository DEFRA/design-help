import { backendApi } from '#/server/common/helpers/backend-api.js'
import { personPath } from '#/server/common/constants/design-help.js'
import { requireAdmin, requireHeadOfDesign } from './access.js'
import { parseLineManagerIdsFromBody } from './helpers.js'

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, {
    sensitivity: 'base'
  })
}

function toManagerRow(person) {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    path: personPath(person),
    isLineManager: Boolean(person.isLineManager),
    managerId: person.managerId ?? null
  }
}

async function listPeopleWithProfiles() {
  const people = await backendApi.listPeople()
  return people.filter((person) => person.name)
}

export const managersRoutes = [
  {
    method: 'GET',
    path: '/admin/long-term-helping',
    async handler(request, h) {
      const denied = requireAdmin(request)
      if (denied) {
        return denied
      }

      const pairs = await backendApi.listHelpingPairs()
      const relationships = pairs
        .map((pair) => ({
          helperName: pair.helper.name,
          helperPath: personPath(pair.helper),
          helpeeName: pair.helpee.name,
          helpeePath: personPath(pair.helpee),
          since: pair.since
        }))
        .sort((a, b) => new Date(b.since ?? 0) - new Date(a.since ?? 0))

      return h.view('admin/long-term-helping', {
        pageTitle: 'Long-term help',
        relationships
      })
    }
  },
  {
    method: 'GET',
    path: '/admin/identify-managers',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const people = await listPeopleWithProfiles()
      const rows = people.map(toManagerRow)
      const lineManagerRows = rows
        .filter((row) => row.isLineManager)
        .sort(byName)
      const addCandidateRows = rows
        .filter((row) => !row.isLineManager)
        .sort(byName)

      return h.view('admin/identify-managers', {
        pageTitle: 'Identify managers',
        lineManagerRows,
        addCandidateRows,
        lineManagerCount: lineManagerRows.length,
        saved: request.query.saved === '1'
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/identify-managers',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const people = await listPeopleWithProfiles()
      const validIds = new Set(people.map((person) => person.id))
      const selected = [...parseLineManagerIdsFromBody(request.payload)].filter(
        (id) => validIds.has(id)
      )

      await backendApi.replaceLineManagers(selected)
      return h.redirect('/admin/identify-managers?saved=1')
    }
  },
  {
    method: 'GET',
    path: '/admin/management-allocations',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const people = await listPeopleWithProfiles()
      const staffRows = people.map(toManagerRow).sort(byName)
      const managerOptions = staffRows.filter((row) => row.isLineManager)

      return h.view('admin/management-allocations', {
        pageTitle: 'Responsible managers',
        staffRows,
        managerOptions,
        saved: request.query.saved === '1'
      })
    }
  },
  {
    method: 'POST',
    path: '/admin/management-allocations',
    async handler(request, h) {
      const denied = requireHeadOfDesign(request)
      if (denied) {
        return denied
      }

      const payload = request.payload ?? {}
      const people = await listPeopleWithProfiles()
      const validManagerIds = new Set(
        people.filter((person) => person.isLineManager).map((p) => p.id)
      )

      for (const person of people) {
        const raw = payload[`m_${person.id}`]
        const trimmed = raw == null ? '' : String(raw).trim()
        const wanted =
          trimmed && validManagerIds.has(trimmed) && trimmed !== person.id
            ? trimmed
            : null
        if (wanted !== (person.managerId ?? null)) {
          await backendApi.setManager(person.id, wanted)
        }
      }

      return h.redirect('/admin/management-allocations?saved=1')
    }
  }
]
