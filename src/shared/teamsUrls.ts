import { DEFAULT_TEAMS_URL } from './types'

/** Hosts allowed to load inside a Teams profile partition (https only). */
const ALLOWED_HOSTS = [
  /(?:^|\.)microsoft\.com$/i,
  /(?:^|\.)microsoftonline\.com$/i,
  /(?:^|\.)microsoftonline-p\.com$/i,
  /(?:^|\.)msauth\.net$/i,
  /(?:^|\.)msauthimages\.net$/i,
  /(?:^|\.)live\.com$/i,
  /(?:^|\.)office\.com$/i,
  /(?:^|\.)office365\.com$/i,
  /(?:^|\.)office\.net$/i,
  /(?:^|\.)sharepoint\.com$/i,
  /(?:^|\.)sharepointonline\.com$/i,
  /(?:^|\.)cloud\.microsoft$/i,
  /(?:^|\.)static\.microsoft$/i,
  /(?:^|\.)microsoft365\.com$/i,
  /(?:^|\.)skype\.com$/i,
  /(?:^|\.)svc\.ms$/i,
  /(?:^|\.)microsoftpersonalcontent\.com$/i,
  /(?:^|\.)msftauth\.net$/i,
  /(?:^|\.)msftauthimages\.net$/i,
  /(?:^|\.)dynamics\.com$/i,
  /(?:^|\.)dynamics365\.com$/i,
  /(?:^|\.)powerapps\.com$/i,
  /(?:^|\.)powerplatform\.com$/i,
  /(?:^|\.)windows\.net$/i,
  /(?:^|\.)microsoftazuread-sso\.com$/i,
  /(?:^|\.)msidentity\.com$/i,
  /(?:^|\.)microsoftonline\.us$/i,
  /(?:^|\.)azureedge\.net$/i,
  /(?:^|\.)msecnd\.net$/i,
  /(?:^|\.)azure\.net$/i,
  /(?:^|\.)akamaized\.net$/i,
  /(?:^|\.)akamaihd\.net$/i
]

export function isAllowedTeamsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') {
    return false
  }

  return ALLOWED_HOSTS.some((pattern) => pattern.test(parsed.hostname))
}

/** Only https/mailto/tel may leave the app via the OS handler. */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'mailto:' || parsed.protocol === 'tel:'
}

/** Hidden Teams probes (third-party cookie check). Must not open in the OS browser. */
export function isTeamsDiagnosticsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return /report-third-party-cookies/i.test(parsed.pathname)
}

export function sanitizeProfileUrl(url?: string): string {
  const candidate = url?.trim() || DEFAULT_TEAMS_URL
  return isAllowedTeamsUrl(candidate) ? candidate : DEFAULT_TEAMS_URL
}
