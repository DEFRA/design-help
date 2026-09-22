import { config } from '#/config/config.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'

const logger = createLogger()

export class BackendApiError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

/**
 * Thin JSON client for design-help-backend. Service-to-service calls stay
 * inside the CDP network (NO_PROXY covers .cdp-int.defra.cloud), so plain
 * fetch is enough.
 */
async function call(method, path, payload) {
  const url = `${config.get('backendApiUrl')}${path}`
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  })

  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    let message = response.statusText
    try {
      const body = await response.json()
      message = body.message ?? message
    } catch {
      // non-JSON error body; keep the status text
    }
    logger.error(
      `Backend ${method} ${path} failed: ${response.status} ${message}`
    )
    throw new BackendApiError(response.status, message)
  }
  if (response.status === 204) {
    return null
  }
  return response.json()
}

export const backendApi = {
  listPeople({ filter, sort } = {}) {
    const params = new URLSearchParams()
    if (filter) {
      params.set('filter', filter)
    }
    if (sort) {
      params.set('sort', sort)
    }
    const query = params.toString()
    return call('GET', `/people${query ? `?${query}` : ''}`)
  },
  getPerson(idOrSlug) {
    return call('GET', `/people/${encodeURIComponent(idOrSlug)}`)
  },
  getPersonByEmail(email) {
    return call('GET', `/people/by-email/${encodeURIComponent(email)}`)
  },
  createPerson(payload) {
    return call('POST', '/people', payload)
  },
  updatePerson(id, payload) {
    return call('PATCH', `/people/${encodeURIComponent(id)}`, payload)
  },
  deletePerson(id, mode = 'full') {
    return call('DELETE', `/people/${encodeURIComponent(id)}?mode=${mode}`)
  },
  activatePerson(id) {
    return call('POST', `/people/${encodeURIComponent(id)}/activate`)
  },
  setAdmin(id, isAdmin) {
    return call('POST', `/people/${encodeURIComponent(id)}/admin`, { isAdmin })
  },
  setHelping(id, availabilityStatus, helpeeIds) {
    return call('PUT', `/people/${encodeURIComponent(id)}/helping`, {
      availabilityStatus,
      helpeeIds
    })
  },
  setManager(id, managerId) {
    return call('PUT', `/people/${encodeURIComponent(id)}/manager`, {
      managerId
    })
  },
  saveGdadEvidence(id, evidence) {
    return call('PUT', `/people/${encodeURIComponent(id)}/gdad/evidence`, {
      evidence
    })
  },
  saveGdadScores(id, scores, scoredById) {
    return call('PUT', `/people/${encodeURIComponent(id)}/gdad/scores`, {
      scores,
      scoredById
    })
  },
  listHelpingPairs() {
    return call('GET', '/helping-pairs')
  },
  replaceLineManagers(personIds) {
    return call('PUT', '/line-managers', { personIds })
  }
}
