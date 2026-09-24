import path from 'node:path'
import { readFileSync } from 'node:fs'

import { config } from '#/config/config.js'
import { buildNavigation } from './build-navigation.js'
import { createLogger } from '#/server/common/helpers/logging/logger.js'
import { isSignInAvailable } from '#/server/common/helpers/auth/sign-in-availability.js'

const logger = createLogger()
const assetPath = config.get('assetPath')
const manifestPath = path.join(
  config.get('root'),
  '.public/.vite/manifest.json'
)

let viteManifest

/**
 * The context builder also runs for error pages (404/500), where request.yar
 * can be uninitialised and reading it throws — which would turn every 404
 * into a 500. Read the session defensively.
 */
function getSessionUser(request) {
  try {
    return request?.yar?.get('user') ?? null
  } catch {
    return null
  }
}

export function context(request) {
  if (config.get('isProduction') && !viteManifest) {
    try {
      viteManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      logger.error(`Vite ${path.basename(manifestPath)} not found`)
    }
  }

  const user = getSessionUser(request)
  const feedbackLinkHref = `/feedback?return=${encodeURIComponent(request?.path ?? '/')}`

  return {
    assetPath: `${assetPath}/assets`,
    serviceName: config.get('serviceName'),
    serviceUrl: '/',
    breadcrumbs: [],
    navigation: buildNavigation(request),
    user,
    isAdmin: Boolean(user?.isAdmin),
    currentPath: request?.path ?? '/',
    appVersion: config.get('serviceVersion') ?? 'dev',
    signInAvailable: isSignInAvailable(),
    feedbackLinkHref,
    showFeedbackFooter: request?.path !== '/feedback',
    getAssetPath(asset) {
      if (!config.get('isProduction')) {
        return `${assetPath}/${asset}`
      }

      const viteAssetPath = viteManifest?.[asset]?.file
      return `${assetPath}/${viteAssetPath ?? asset}`
    }
  }
}
