import { backendApi } from '#/server/common/helpers/backend-api.js'
import { personPath } from '#/server/common/constants/design-help.js'

const SCOPES = {
  offers: {
    field: 'canHelpWithText',
    pageTitle: 'Offers',
    pageIntro:
      'What team members have written they can help with, in their own words.',
    formAction: '/offers',
    emptyMessage: 'No offers found. Try a different keyword.'
  },
  requests: {
    field: 'developmentGoalsText',
    pageTitle: 'Requests',
    pageIntro: 'What team members would like help with, in their own words.',
    formAction: '/requests',
    emptyMessage: 'No requests found. Try a different keyword.'
  }
}

function makeHandler(scopeName) {
  const scope = SCOPES[scopeName]
  return async function handler(request, h) {
    const freeTextQuery = String(request.query.freeTextQuery ?? '').trim()
    const people = await backendApi.listPeople()

    const entries = people
      .filter((person) => person.name && person[scope.field])
      .filter((person) => {
        if (!freeTextQuery) {
          return true
        }
        const haystack = `${person.name} ${person[scope.field]}`.toLowerCase()
        return haystack.includes(freeTextQuery.toLowerCase())
      })
      .map((person) => ({
        ...person,
        path: personPath(person),
        isOwnProfile: person.id === request.app.user?.id
      }))

    return h.view('requests-offers/index', {
      pageTitle: scope.pageTitle,
      pageIntro: scope.pageIntro,
      formAction: scope.formAction,
      emptyMessage: scope.emptyMessage,
      freeTextQuery,
      freeTextScope: scopeName === 'offers' ? 'can-help' : 'development-goals',
      freeTextEntries: entries
    })
  }
}

export const requestsOffersRoutes = [
  {
    method: 'GET',
    path: '/offers',
    handler: makeHandler('offers')
  },
  {
    method: 'GET',
    path: '/requests',
    handler: makeHandler('requests')
  },
  {
    method: 'GET',
    path: '/requests-offers',
    handler: (_request, h) => h.redirect('/offers')
  }
]
