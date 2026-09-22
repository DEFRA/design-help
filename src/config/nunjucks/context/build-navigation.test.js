import { buildNavigation } from './build-navigation.js'

function mockRequest(options) {
  return { ...options }
}

describe('#buildNavigation', () => {
  test('Should provide expected navigation details', () => {
    expect(
      buildNavigation(mockRequest({ path: '/non-existent-path' }))
    ).toEqual([
      {
        current: false,
        text: 'Design help',
        href: '/'
      },
      {
        current: false,
        text: 'Team members',
        href: '/browse'
      },
      {
        current: false,
        text: 'Offers',
        href: '/offers'
      },
      {
        current: false,
        text: 'Requests',
        href: '/requests'
      }
    ])
  })

  test('Should provide expected highlighted navigation details', () => {
    expect(buildNavigation(mockRequest({ path: '/browse' }))).toEqual([
      {
        current: false,
        text: 'Design help',
        href: '/'
      },
      {
        current: true,
        text: 'Team members',
        href: '/browse'
      },
      {
        current: false,
        text: 'Offers',
        href: '/offers'
      },
      {
        current: false,
        text: 'Requests',
        href: '/requests'
      }
    ])
  })
})
