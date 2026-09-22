import {
  adminMessageFor,
  buildAdminUserRows,
  getNextStep,
  getPreviousStep,
  getWizardStep,
  normaliseAllowedRole,
  normaliseAvailabilityStatus,
  parseLineManagerIdsFromBody
} from './helpers.js'

describe('#parseLineManagerIdsFromBody', () => {
  test('Should collect line_manager values as a set', () => {
    expect(
      parseLineManagerIdsFromBody({ line_manager: ['abc', 'def', ''] })
    ).toEqual(new Set(['abc', 'def']))
  })

  test('Should accept a single (non-array) value', () => {
    expect(parseLineManagerIdsFromBody({ line_manager: 'abc' })).toEqual(
      new Set(['abc'])
    )
  })

  test('Should accept legacy lm_<id> checkbox keys', () => {
    expect(
      parseLineManagerIdsFromBody({ lm_abc: 'yes', lm_def: 'no', other: 'yes' })
    ).toEqual(new Set(['abc']))
  })

  test('Should return an empty set for missing bodies', () => {
    expect(parseLineManagerIdsFromBody(undefined)).toEqual(new Set())
  })
})

describe('#buildAdminUserRows', () => {
  test('Should mark allow-list-only entries as pending and sort by name or email', () => {
    const rows = buildAdminUserRows([
      {
        id: '2',
        email: 'zed@example.com',
        name: 'Zed',
        role: 'Service Designer',
        isAdmin: false,
        activatedAt: '2024-01-01T00:00:00.000Z'
      },
      { id: '1', email: 'anna@example.com', name: null, activatedAt: null }
    ])

    expect(rows.map((row) => row.id)).toEqual(['1', '2'])
    expect(rows[0]).toMatchObject({
      hasProfile: false,
      pendingActivation: true
    })
    expect(rows[1]).toMatchObject({
      hasProfile: true,
      pendingActivation: false
    })
  })

  test('Should flag people who have a profile but never signed in as pending', () => {
    const [row] = buildAdminUserRows([
      {
        id: '1',
        email: 'new@example.com',
        name: 'New Person',
        activatedAt: null
      }
    ])
    expect(row.pendingActivation).toBe(true)
    expect(row.hasProfile).toBe(true)
  })
})

describe('#adminMessageFor', () => {
  test('Should return success flags for grant and revoke codes', () => {
    expect(adminMessageFor('admin-granted')).toEqual({
      text: 'Admin access was granted.',
      isSuccess: true
    })
    expect(adminMessageFor('duplicate')).toEqual({
      text: 'That address is already on the allowed list.',
      isSuccess: false
    })
  })

  test('Should return null for unknown codes', () => {
    expect(adminMessageFor('nope')).toBeNull()
    expect(adminMessageFor(undefined)).toBeNull()
  })
})

describe('#wizard step helpers', () => {
  test('Should default to the details step', () => {
    expect(getWizardStep('bogus')).toBe('details')
    expect(getWizardStep(undefined)).toBe('details')
  })

  test('Should walk steps in order: details, about, can-help, development-goals', () => {
    expect(getNextStep('details')).toBe('about')
    expect(getNextStep('about')).toBe('can-help')
    expect(getNextStep('can-help')).toBe('development-goals')
    expect(getNextStep('development-goals')).toBeNull()
    expect(getPreviousStep('about')).toBe('details')
    expect(getPreviousStep('details')).toBeNull()
  })
})

describe('#normalisers', () => {
  test('Should match roles and availability case-insensitively', () => {
    expect(normaliseAllowedRole('service designer')).toBe('Service Designer')
    expect(normaliseAllowedRole('Not A Role')).toBeUndefined()
    expect(normaliseAvailabilityStatus('bUSY')).toBe('Busy')
    expect(normaliseAvailabilityStatus('nope')).toBeUndefined()
  })
})
