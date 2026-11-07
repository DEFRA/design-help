import { buildNavigation } from './build-navigation.js'

const designer = { id: 'd', isAdmin: false, isLineManager: false }
const lineManager = { id: 'm', isAdmin: false, isLineManager: true }
const headOfDesign = {
  id: 'h',
  isAdmin: true,
  isHeadOfDesignSuperUser: true,
  isLineManager: false
}
const plainAdmin = { id: 'a', isAdmin: true, isLineManager: false }

const texts = (items) => items.map((item) => item.text)

describe('#buildNavigation', () => {
  test('Designers get GDaD, Find help and My profile', () => {
    expect(texts(buildNavigation({ path: '/' }, designer))).toEqual([
      'GDaD',
      'Find help',
      'My profile'
    ])
  })

  test('Admins who are not managers do not get My team', () => {
    expect(texts(buildNavigation({ path: '/' }, plainAdmin))).toEqual([
      'GDaD',
      'Find help',
      'My profile'
    ])
  })

  test.each([
    ['line manager', lineManager],
    ['Head of Design', headOfDesign]
  ])('A %s gets My team first', (_label, user) => {
    expect(texts(buildNavigation({ path: '/' }, user))).toEqual([
      'My team',
      'GDaD',
      'Find help',
      'My profile'
    ])
  })

  test('Signed out, there is no My team', () => {
    expect(texts(buildNavigation({ path: '/' }))).not.toContain('My team')
  })

  test('Links go to the right places', () => {
    expect(
      buildNavigation({ path: '/' }, lineManager).map((item) => item.href)
    ).toEqual(['/my-team', '/my-gdad-evidence', '/find-help', '/my-profile'])
  })

  test('Marks the current page with aria-current="page"', () => {
    const items = buildNavigation({ path: '/my-gdad-evidence' }, designer)
    expect(items[0]).toEqual({
      text: 'GDaD',
      href: '/my-gdad-evidence',
      current: true,
      ariaCurrent: 'page'
    })
    expect(items[1].current).toBe(false)
    expect(items[1].ariaCurrent).toBeNull()
  })

  test.each([
    ['/my-gdad-evidence/design_communication', 'GDaD'],
    ['/review/gdad-evidence/abc', 'My team'],
    ['/browse', 'Find help'],
    ['/offers', 'Find help'],
    ['/requests', 'Find help'],
    ['/profile/some-one', 'Find help'],
    ['/my-profile/edit', 'My profile']
  ])('Marks %s as part of %s', (path, text) => {
    const current = buildNavigation({ path }, lineManager).filter(
      (item) => item.current
    )
    expect(current).toHaveLength(1)
    expect(current[0].text).toBe(text)
    expect(current[0].ariaCurrent).toBe('true')
  })

  test('Nothing is current on unrelated pages', () => {
    expect(
      buildNavigation({ path: '/about' }, lineManager).some((i) => i.current)
    ).toBe(false)
  })
})
