import { backendApi } from '#/server/common/helpers/backend-api.js'
import {
  personPath,
  professionGroupFor
} from '#/server/common/constants/design-help.js'

const PROFESSION_ORDER = [
  'Service design',
  'Interaction design',
  'Leadership',
  'Accessibility',
  'Other'
]

function toMemberViewModel(person, user) {
  return {
    ...person,
    path: personPath(person),
    isOwnProfile: person.id === user?.id
  }
}

export const browseController = {
  async handler(request, h) {
    const filterText = String(request.query.filter ?? '').trim()
    const sort = ['a-z', 'z-a', 'profession'].includes(request.query.sort)
      ? request.query.sort
      : 'a-z'

    const people = await backendApi.listPeople({
      filter: filterText || undefined,
      sort: sort === 'z-a' ? 'z-a' : 'a-z'
    })

    // Only people with profiles appear in the directory; allow-list only
    // entries have no name yet.
    const members = people
      .filter((person) => person.name)
      .map((person) => toMemberViewModel(person, request.app.user))

    let groupedMembers = []
    if (sort === 'profession') {
      const byGroup = new Map()
      for (const member of members) {
        const groupName = professionGroupFor(member.role)
        if (!byGroup.has(groupName)) {
          byGroup.set(groupName, [])
        }
        byGroup.get(groupName).push(member)
      }
      groupedMembers = PROFESSION_ORDER.filter((name) => byGroup.has(name)).map(
        (name) => ({ groupName: name, members: byGroup.get(name) })
      )
    }

    return h.view('browse/index', {
      pageTitle: filterText
        ? `Team members who can help with ${filterText}`
        : 'Browse team members',
      filterText,
      sort,
      filteredMembers: members,
      groupedMembers
    })
  }
}
