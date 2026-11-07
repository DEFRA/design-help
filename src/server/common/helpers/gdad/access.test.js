import { vi } from 'vitest'

import {
  canAccessGdadReviewSection,
  canReviewGdadEvidenceForTarget,
  getGdadReviewerRole,
  listReviewablePeople
} from './access.js'

const mockListPeople = vi.fn()

vi.mock('#/server/common/helpers/backend-api.js', () => ({
  backendApi: { listPeople: (...args) => mockListPeople(...args) }
}))

const headOfDesign = {
  id: 'hod',
  isAdmin: true,
  isHeadOfDesignSuperUser: true,
  isLineManager: false
}
const lineManager = {
  id: 'lm',
  isAdmin: false,
  isHeadOfDesignSuperUser: false,
  isLineManager: true
}
const adminLineManager = { ...lineManager, id: 'alm', isAdmin: true }
const plainAdmin = {
  id: 'admin',
  isAdmin: true,
  isHeadOfDesignSuperUser: false,
  isLineManager: false
}
const designer = {
  id: 'designer',
  isAdmin: false,
  isHeadOfDesignSuperUser: false,
  isLineManager: false
}

const ownReport = { id: 'p1', name: 'Own report', managerId: 'lm' }
const otherReport = { id: 'p2', name: 'Other report', managerId: 'someone' }
const unallocated = { id: 'p3', name: 'Unallocated', managerId: null }

describe('#getGdadReviewerRole', () => {
  test('Head of Design is hod', () => {
    expect(getGdadReviewerRole(headOfDesign)).toBe('hod')
    expect(getGdadReviewerRole({ ...headOfDesign, isLineManager: true })).toBe(
      'hod'
    )
  })

  test('Line managers are line_manager whether or not they are admins', () => {
    expect(getGdadReviewerRole(lineManager)).toBe('line_manager')
    expect(getGdadReviewerRole(adminLineManager)).toBe('line_manager')
  })

  test('Admins who are not Head of Design or a line manager get no access', () => {
    expect(getGdadReviewerRole(plainAdmin)).toBe('none')
    expect(canAccessGdadReviewSection(plainAdmin)).toBe(false)
  })

  test('Everyone else gets no access', () => {
    expect(getGdadReviewerRole(designer)).toBe('none')
    expect(getGdadReviewerRole(null)).toBe('none')
    expect(getGdadReviewerRole(undefined)).toBe('none')
    expect(canAccessGdadReviewSection(designer)).toBe(false)
  })
})

describe('#canReviewGdadEvidenceForTarget', () => {
  test('Non-admin line manager may review only their own reports', () => {
    expect(canReviewGdadEvidenceForTarget(lineManager, ownReport)).toBe(true)
    expect(canReviewGdadEvidenceForTarget(lineManager, otherReport)).toBe(false)
    expect(canReviewGdadEvidenceForTarget(lineManager, unallocated)).toBe(false)
  })

  test('Admin line manager has the same scope as any line manager', () => {
    const report = { ...ownReport, managerId: 'alm' }
    expect(canReviewGdadEvidenceForTarget(adminLineManager, report)).toBe(true)
    expect(canReviewGdadEvidenceForTarget(adminLineManager, unallocated)).toBe(
      false
    )
  })

  test('Plain admin may review nobody, including unallocated people', () => {
    for (const target of [ownReport, otherReport, unallocated]) {
      expect(canReviewGdadEvidenceForTarget(plainAdmin, target)).toBe(false)
    }
  })

  test('Head of Design may review everyone, including unallocated people', () => {
    for (const target of [ownReport, otherReport, unallocated]) {
      expect(canReviewGdadEvidenceForTarget(headOfDesign, target)).toBe(true)
    }
  })

  test('Non-manager non-admin may review nobody', () => {
    expect(
      canReviewGdadEvidenceForTarget(designer, {
        ...ownReport,
        managerId: 'designer'
      })
    ).toBe(false)
  })
})

describe('#listReviewablePeople', () => {
  const everyone = [
    ownReport,
    otherReport,
    unallocated,
    { id: 'lm', name: 'The manager', managerId: 'lm' },
    { id: 'hod', name: 'Head of Design', managerId: null },
    { id: 'p4', name: '', managerId: 'lm' }
  ]

  beforeEach(() => {
    mockListPeople.mockResolvedValue(everyone)
  })

  test('Line manager sees only named reports, never themselves', async () => {
    const people = await listReviewablePeople(lineManager)
    expect(people.map((p) => p.id)).toEqual(['p1'])
  })

  test('Head of Design sees everyone named except themselves', async () => {
    const people = await listReviewablePeople(headOfDesign)
    expect(people.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'lm'])
  })

  test('Plain admin sees nobody', async () => {
    expect(await listReviewablePeople(plainAdmin)).toEqual([])
  })
})
