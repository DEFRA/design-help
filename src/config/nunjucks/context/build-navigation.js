export function buildNavigation(request) {
  return [
    {
      text: 'Design help',
      href: '/',
      current: request?.path === '/'
    },
    {
      text: 'Team members',
      href: '/browse',
      current: request?.path === '/browse'
    },
    {
      text: 'Offers',
      href: '/offers',
      current: request?.path === '/offers'
    },
    {
      text: 'Requests',
      href: '/requests',
      current: request?.path === '/requests'
    }
  ]
}
