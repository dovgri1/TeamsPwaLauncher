import {
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  session,
  shell,
  type HandlerDetails,
  type Session,
  type WebContents,
  type CookiesSetDetails
} from 'electron'
import icon from '../../resources/icon.png?asset'
import { pickDisplaySource } from './screenPicker'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
  type Profile,
  type UnreadBadge,
  type UnreadMap
} from '../shared/types'
import { isAllowedTeamsUrl, isSafeExternalUrl, isTeamsDiagnosticsUrl, sanitizeProfileUrl } from '../shared/teamsUrls'

const views = new Map<string, WebContentsView>()
const popouts = new Map<string, BrowserWindow>()
const configuredSessions = new Set<string>()
const titleUnread = new Map<string, UnreadBadge>()
const badgeUnread = new Map<string, number>()

let mainWindow: BrowserWindow | null = null
let activeProfileId: string | null = null
let onSwitchIndex: ((index: number) => void) | null = null
let onUnreadChange: ((unread: UnreadMap) => void) | null = null
let onToggleSidebar: (() => void) | null = null
let onDetachedChange: ((ids: string[]) => void) | null = null
let onActiveCleared: (() => void) | null = null
let unreadPoll: ReturnType<typeof setInterval> | null = null
let sidebarOffset = SIDEBAR_WIDTH
let stageBounds: { x: number; y: number; width: number; height: number } | null = null
const guestResizeTimers = new WeakMap<WebContents, ReturnType<typeof setTimeout>>()

const BADGE_SCRIPT = `(() => {
  if (window.__teamsLauncherBadgeHook) return;
  window.__teamsLauncherBadgeHook = true;
  const emit = (n) => console.log('__TEAMS_BADGE__:' + String(n));
  const parse = (title) => {
    const match = String(title).match(/\\((\\d+)\\+?\\)/);
    return match ? Number(match[1]) : 0;
  };
  if (navigator.setAppBadge) {
    const original = navigator.setAppBadge.bind(navigator);
    navigator.setAppBadge = (n) => {
      emit(typeof n === 'number' ? n : parse(document.title) || 1);
      return original(n);
    };
  }
  if (navigator.clearAppBadge) {
    const original = navigator.clearAppBadge.bind(navigator);
    navigator.clearAppBadge = () => {
      emit(0);
      return original();
    };
  }
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => emit(parse(document.title))).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  emit(parse(document.title));
})();`

export function setSwitchIndexHandler(handler: (index: number) => void): void {
  onSwitchIndex = handler
}

export function setUnreadHandler(handler: (unread: UnreadMap) => void): void {
  onUnreadChange = handler
}

export function setToggleSidebarHandler(handler: () => void): void {
  onToggleSidebar = handler
}

export function setDetachedChangeHandler(handler: (ids: string[]) => void): void {
  onDetachedChange = handler
}

export function setActiveClearedHandler(handler: () => void): void {
  onActiveCleared = handler
}

export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarOffset = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH
  syncActiveBounds()
}

export function setStageBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  const next = roundBounds(bounds)
  if (!next) {
    return
  }
  if (
    stageBounds &&
    stageBounds.x === next.x &&
    stageBounds.y === next.y &&
    stageBounds.width === next.width &&
    stageBounds.height === next.height
  ) {
    return
  }
  stageBounds = next
  syncActiveBounds()
}

export function getUnreadMap(): UnreadMap {
  return publishUnread(false)
}

export function getDetachedIds(): string[] {
  return [...popouts.keys()]
}

export function isDetached(id: string): boolean {
  return popouts.has(id)
}

export function initTeamsViews(win: BrowserWindow): void {
  mainWindow = win
  const schedule = (): void => {
    syncActiveBounds()
    setImmediate(syncActiveBounds)
  }
  win.on('resize', schedule)
  win.on('resized', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('enter-html-full-screen', schedule)
  win.on('leave-html-full-screen', schedule)

  if (!unreadPoll) {
    unreadPoll = setInterval(() => {
      for (const [id, view] of views) {
        if (!view.webContents.isDestroyed()) {
          applyTitleUnread(id, view.webContents.getTitle())
        }
      }
    }, 2500)
  }
}

export function showProfile(profile: Profile): void {
  if (!mainWindow) {
    return
  }

  if (popouts.has(profile.id)) {
    focusDetached(profile.id)
    return
  }

  let view = views.get(profile.id)
  if (!view) {
    view = createView(profile)
    views.set(profile.id, view)
    mainWindow.contentView.addChildView(view)
  } else if (!isViewInMain(view)) {
    mainWindow.contentView.addChildView(view)
  }

  for (const [id, existing] of views) {
    if (popouts.has(id)) {
      continue
    }
    existing.setVisible(id === profile.id)
  }

  activeProfileId = profile.id
  view.setVisible(true)
  syncActiveBounds()
  view.webContents.focus()
}

export function hideAllViews(): void {
  activeProfileId = null
  hideEmbeddedViews()
}

export function hideEmbeddedViews(): void {
  for (const [id, view] of views) {
    if (!popouts.has(id)) {
      view.setVisible(false)
    }
  }
}

export function reloadProfile(id: string): void {
  views.get(id)?.webContents.reload()
}

export function toggleActiveDevTools(): void {
  activeEmbeddedView()?.webContents.toggleDevTools()
}

export function detachProfile(profile: Profile): void {
  if (!mainWindow || popouts.has(profile.id)) {
    focusDetached(profile.id)
    return
  }

  let view = views.get(profile.id)
  if (!view) {
    view = createView(profile)
    views.set(profile.id, view)
    mainWindow.contentView.addChildView(view)
  }

  mainWindow.contentView.removeChildView(view)

  const popout = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#201F1E',
    title: profile.name,
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  popouts.set(profile.id, popout)
  popout.contentView.addChildView(view)
  view.setVisible(true)
  syncPopoutBounds(profile.id)

  popout.on('resize', () => syncPopoutBounds(profile.id))
  popout.on('resized', () => syncPopoutBounds(profile.id))
  popout.on('maximize', () => syncPopoutBounds(profile.id))
  popout.on('unmaximize', () => syncPopoutBounds(profile.id))
  popout.on('enter-full-screen', () => syncPopoutBounds(profile.id))
  popout.on('leave-full-screen', () => syncPopoutBounds(profile.id))
  popout.on('closed', () => {
    if (!popouts.has(profile.id)) {
      return
    }
    popouts.delete(profile.id)
    reattachView(profile.id, true)
    publishDetached()
  })

  if (activeProfileId === profile.id) {
    activeProfileId = null
    onActiveCleared?.()
  }

  popout.once('ready-to-show', () => {
    popout.show()
    popout.focus()
    view.webContents.focus()
  })
  popout.show()
  publishDetached()
}

export function focusDetached(id: string): void {
  const win = popouts.get(id)
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
  views.get(id)?.webContents.focus()
}

export function reattachProfile(id: string): void {
  const win = popouts.get(id)
  if (!win) {
    return
  }
  popouts.delete(id)
  if (!win.isDestroyed()) {
    win.removeAllListeners('closed')
    win.close()
  }
  reattachView(id, true)
  publishDetached()
}

function reattachView(id: string, makeActive: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  const view = views.get(id)
  if (!view || view.webContents.isDestroyed()) {
    return
  }

  try {
    mainWindow.contentView.addChildView(view)
  } catch {
    // Already attached.
  }

  if (makeActive) {
    for (const [otherId, existing] of views) {
      if (popouts.has(otherId)) {
        continue
      }
      existing.setVisible(otherId === id)
    }
    activeProfileId = id
    view.setVisible(true)
    syncActiveBounds()
    view.webContents.focus()
  } else {
    view.setVisible(false)
  }
}

export async function destroyProfileView(id: string): Promise<void> {
  await tearDownProfileView(id)
  await clearProfilePartition(id)
}

/** Close the view, wipe cookies/storage for this profile, then open a fresh Teams session. */
export async function clearProfileSession(profile: Profile): Promise<void> {
  await tearDownProfileView(profile.id)
  await clearProfilePartition(profile.id)
  showProfile(profile)
}

async function tearDownProfileView(id: string): Promise<void> {
  const popout = popouts.get(id)
  if (popout) {
    popouts.delete(id)
    if (!popout.isDestroyed()) {
      popout.removeAllListeners('closed')
      popout.close()
    }
    publishDetached()
  }

  const view = views.get(id)
  if (view) {
    view.setVisible(false)
    try {
      mainWindow?.contentView.removeChildView(view)
    } catch {
      // Not in main.
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }
    views.delete(id)
  }

  if (activeProfileId === id) {
    activeProfileId = null
  }

  titleUnread.delete(id)
  badgeUnread.delete(id)
  publishUnread(true)
}

async function clearProfilePartition(id: string): Promise<void> {
  const ses = session.fromPartition(`persist:${id}`)
  await ses.clearCache()
  await ses.clearStorageData({
    storages: [
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'shadercache',
      'websql',
      'serviceworkers',
      'cachestorage'
    ]
  })
  // Keep session hooks registered so clear+reopen does not stack webRequest handlers.
}

export function attachAppWebContentsHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler((details) => handleWindowOpen(details, contents))
    contents.on('will-navigate', (event, url) => {
      handleNavigation(event, contents, url)
    })
    contents.on('will-redirect', (event, url) => {
      handleNavigation(event, contents, url)
    })
    contents.on('will-frame-navigate', (event) => {
      handleNavigation(event, contents, event.url)
    })
    contents.on('context-menu', (_event, params) => {
      if (contents === mainWindow?.webContents) {
        return
      }
      showTeamsContextMenu(contents, params)
    })
    contents.on('before-input-event', (event, input) => {
      handleShortcut(event, input)
    })
    contents.on('did-create-window', (win) => {
      const ping = (): void => notifyGuestResize(win.webContents)
      win.on('resize', ping)
      win.on('resized', ping)
      win.on('maximize', ping)
      win.on('unmaximize', ping)
      win.on('enter-full-screen', ping)
      win.on('leave-full-screen', ping)
      win.webContents.once('did-finish-load', () => {
        if (isTeamsDiagnosticsUrl(win.webContents.getURL()) && !win.isDestroyed()) {
          setTimeout(() => {
            if (!win.isDestroyed()) {
              win.close()
            }
          }, 8000)
        }
      })
    })
    attachSignInHelpers(contents)
  })
}

function handleNavigation(
  event: { preventDefault: () => void },
  contents: WebContents,
  url: string
): void {
  if (isAppRendererUrl(contents, url)) {
    return
  }
  if (
    url === 'about:blank' ||
    url.startsWith('about:blank?') ||
    url.startsWith('about:blank#') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return
  }
  if (isAllowedTeamsUrl(url)) {
    return
  }
  event.preventDefault()
  openExternalSafely(url)
}

function openExternalSafely(url: string): void {
  if (isSafeExternalUrl(url)) {
    void shell.openExternal(url)
  }
}

export function syncBounds(): void {
  syncActiveBounds()
  for (const id of popouts.keys()) {
    syncPopoutBounds(id)
  }
}

function createView(profile: Profile): WebContentsView {
  const partition = `persist:${profile.id}`
  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  })

  configureSession(view.webContents.session, profile.id)
  view.webContents.setUserAgent(chromeUserAgent())
  attachUnreadTracking(profile.id, view.webContents)
  attachLoginRecovery(view.webContents, profile)
  view.setVisible(false)
  void (async () => {
    const pickAccount = await partitionHasNoCookies(profile.id)
    if (view.webContents.isDestroyed()) {
      return
    }
    void view.webContents.loadURL(
      teamsEntryUrl(sanitizeProfileUrl(profile.url), { pickAccount })
    )
  })()
  return view
}

function configureSession(ses: Session, profileId: string): void {
  if (configuredSessions.has(profileId)) {
    return
  }
  configuredSessions.add(profileId)

  ses.setUserAgent(chromeUserAgent())
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const chromeMajor = process.versions.chrome.split('.')[0]
    const platformHint =
      process.platform === 'darwin' ? '"macOS"' : process.platform === 'win32' ? '"Windows"' : '"Linux"'
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'User-Agent': chromeUserAgent(),
        'Sec-CH-UA': `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not.A/Brand";v="24"`,
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': platformHint
      }
    })
  })
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  ses.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))

  ses.setDisplayMediaRequestHandler((_request, callback) => {
    void pickDisplaySource(mainWindow)
      .then((source) => {
        if (!source) {
          callback({})
          return
        }
        callback({
          video: source,
          audio: 'loopback'
        })
      })
      .catch(() => {
        callback({})
      })
  })

  attachSessionCookiePersistence(ses)
}

const SESSION_COOKIE_TTL_SEC = 14 * 24 * 60 * 60
const PERSIST_SESSION_COOKIE_HOSTS = [
  /(?:^|\.)login\.microsoftonline\.com$/i,
  /(?:^|\.)microsoftonline\.com$/i,
  /(?:^|\.)teams\.microsoft\.com$/i,
  /(?:^|\.)login\.microsoft\.com$/i,
  /(?:^|\.)login\.live\.com$/i,
  /(?:^|\.)login\.windows\.net$/i
]

function attachSessionCookiePersistence(ses: Session): void {
  const rewriting = new Set<string>()
  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed || !cookie.session) {
      return
    }
    const host = (cookie.domain ?? '').replace(/^\./, '')
    if (!PERSIST_SESSION_COOKIE_HOSTS.some((pattern) => pattern.test(host))) {
      return
    }
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.secure}|${cookie.httpOnly}`
    if (rewriting.has(key)) {
      return
    }
    rewriting.add(key)
    const url = cookieSetUrl(cookie)
    const details: CookiesSetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: Math.floor(Date.now() / 1000) + SESSION_COOKIE_TTL_SEC,
      sameSite: cookie.sameSite
    }
    if (!cookie.hostOnly && cookie.domain) {
      details.domain = cookie.domain
    }
    void ses.cookies
      .set(details)
      .catch(() => undefined)
      .finally(() => {
        rewriting.delete(key)
      })
  })
}

function cookieSetUrl(cookie: Electron.Cookie): string {
  const host = (cookie.domain ?? 'localhost').replace(/^\./, '')
  const protocol = cookie.secure ? 'https' : 'http'
  const path = cookie.path || '/'
  return `${protocol}://${host}${path}`
}

async function partitionHasNoCookies(id: string): Promise<boolean> {
  const cookies = await session.fromPartition(`persist:${id}`).cookies.get({})
  return cookies.length === 0
}

export function switchAccount(profile: Profile): void {
  showProfile(profile)
  const view = views.get(profile.id)
  if (!view || view.webContents.isDestroyed()) {
    return
  }
  void view.webContents.loadURL(
    teamsEntryUrl(sanitizeProfileUrl(profile.url), { pickAccount: true })
  )
}

export async function flushProfileSessions(ids: string[]): Promise<void> {
  const unique = new Set([...ids, ...configuredSessions, ...views.keys()])
  await Promise.all(
    [...unique].map((id) =>
      session
        .fromPartition(`persist:${id}`)
        .cookies.flushStore()
        .catch(() => undefined)
    )
  )
}

/** Load Teams. Only force the account picker on first run (empty partition) or Switch account. */
function teamsEntryUrl(url: string, options?: { pickAccount?: boolean }): string {
  try {
    const parsed = new URL(url)
    if (!/(?:^|\.)teams\.microsoft\.com$/i.test(parsed.hostname)) {
      return url
    }
    if (options?.pickAccount) {
      parsed.searchParams.set('prompt', 'select_account')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

const SIGNIN_HELPER = `(() => {
  if (window.__teamsLauncherSigninHelper) return;
  window.__teamsLauncherSigninHelper = true;

  const reject = () =>
    Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
  try {
    if (navigator.credentials) {
      navigator.credentials.get = reject;
      navigator.credentials.create = reject;
    }
    if (window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () =>
        Promise.resolve(false);
      if (window.PublicKeyCredential.isConditionalMediationAvailable) {
        window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
      }
    }
  } catch {
    // Page may freeze the credentials API.
  }

  let clicked = false;
  const stuckOnPasskey = () => {
    const text = (document.body && document.body.innerText) || '';
    return (
      /Face, fingerprint, PIN or security key/i.test(text) ||
      /open a security window/i.test(text)
    );
  };
  const clickFallback = () => {
    const nodes = document.querySelectorAll('a, button, [role="button"]');
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 90) continue;
      if (
        /use (your |a )?password/i.test(t) ||
        /sign in another way/i.test(t) ||
        /other ways to sign in/i.test(t) ||
        /use a different (account|method)/i.test(t) ||
        /i can't use/i.test(t)
      ) {
        el.click();
        return true;
      }
    }
    return false;
  };
  const tick = () => {
    if (clicked || !stuckOnPasskey()) return;
    if (clickFallback()) clicked = true;
  };

  document.addEventListener('DOMContentLoaded', tick);
  if (document.readyState !== 'loading') tick();
  try {
    if (document.documentElement) {
      new MutationObserver(tick).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  } catch {}
  setTimeout(tick, 400);
  setTimeout(tick, 1400);
  setTimeout(tick, 3000);
})();`

function attachSignInHelpers(contents: WebContents): void {
  const inject = (): void => {
    if (contents.isDestroyed() || contents === mainWindow?.webContents) {
      return
    }
    void contents.executeJavaScript(SIGNIN_HELPER).catch(() => undefined)
  }

  contents.on('dom-ready', inject)
  contents.on('did-finish-load', inject)
  contents.on('frame-created', (_event, details) => {
    const frame = details.frame
    if (!frame || frame.isDestroyed()) {
      return
    }
    void frame.executeJavaScript(SIGNIN_HELPER).catch(() => undefined)
  })
}

function attachLoginRecovery(contents: WebContents, profile: Profile): void {
  let recoveries = 0
  contents.on('did-finish-load', () => {
    if (contents.isDestroyed() || recoveries >= 2) {
      return
    }
    void contents
      .executeJavaScript(
        `Boolean(document.body && /AADSTS900561/i.test(document.body.innerText || ''))`
      )
      .then((stuck: unknown) => {
        if (stuck !== true || contents.isDestroyed() || recoveries >= 2) {
          return
        }
        recoveries += 1
        void contents.loadURL(teamsEntryUrl(sanitizeProfileUrl(profile.url)))
      })
      .catch(() => undefined)
  })
}

export function chromeUserAgent(): string {
  const chrome = process.versions.chrome
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

function isAllowedPermission(permission: string): boolean {
  return [
    'media',
    'mediaKeySystem',
    'notifications',
    'display-capture',
    'clipboard-sanitized-write',
    'clipboard-read',
    'fullscreen',
    'pointerLock',
    'idle-detection',
    'storage-access',
    'window-management'
  ].includes(permission)
}

function handleWindowOpen(
  details: HandlerDetails,
  contents: WebContents
): {
  action: 'allow' | 'deny'
  overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions
} {
  if (isTeamsDiagnosticsUrl(details.url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        webPreferences: {
          session: contents.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    }
  }

  if (isAllowedTeamsUrl(details.url) || details.url === 'about:blank' || details.url.startsWith('about:blank?')) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 800,
        minWidth: 640,
        minHeight: 480,
        autoHideMenuBar: true,
        backgroundColor: '#201F1E',
        useContentSize: true,
        webPreferences: {
          session: contents.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          spellcheck: true
        }
      }
    }
  }

  void openExternalSafely(details.url)
  return { action: 'deny' }
}

function isAppRendererUrl(contents: WebContents, url: string): boolean {
  // Only the launcher UI (sidebar) may load local/dev renderer URLs — never Teams partitions.
  if (contents !== mainWindow?.webContents) {
    return false
  }

  if (url === 'about:blank' || url.startsWith('devtools:')) {
    return true
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    return true
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  }

  return false
}

function showTeamsContextMenu(contents: WebContents, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion)
      })
    }
    if (template.length > 0) {
      template.push({ type: 'separator' })
    }
  }

  template.push(
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    { type: 'separator' },
    { label: 'Reload Teams', click: () => contents.reload() }
  )

  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined })
}

function handleShortcut(event: Electron.Event, input: Electron.Input): void {
  if (input.type !== 'keyDown') {
    return
  }

  const ctrl = input.control || input.meta

  if (ctrl && !input.shift && !input.alt && /^[1-9]$/.test(input.key)) {
    event.preventDefault()
    onSwitchIndex?.(Number(input.key) - 1)
    return
  }

  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 'b') {
    event.preventDefault()
    onToggleSidebar?.()
    return
  }

  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
    event.preventDefault()
    const focused = BrowserWindow.getFocusedWindow()
    for (const [id, win] of popouts) {
      if (win === focused) {
        views.get(id)?.webContents.reload()
        return
      }
    }
    activeEmbeddedView()?.webContents.reload()
    return
  }

  if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
    event.preventDefault()
    const focused = BrowserWindow.getFocusedWindow()
    for (const [id, win] of popouts) {
      if (win === focused) {
        views.get(id)?.webContents.toggleDevTools()
        return
      }
    }
    activeEmbeddedView()?.webContents.toggleDevTools()
    return
  }

  if (input.key === 'F12') {
    event.preventDefault()
    mainWindow?.webContents.toggleDevTools()
  }
}

function activeEmbeddedView(): WebContentsView | undefined {
  if (!activeProfileId || popouts.has(activeProfileId)) {
    return undefined
  }
  return views.get(activeProfileId)
}

function isViewInMain(view: WebContentsView): boolean {
  if (!mainWindow) {
    return false
  }
  const children = mainWindow.contentView.children as WebContentsView[]
  return children.includes(view)
}

function syncActiveBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const view = activeEmbeddedView()
  if (!view) {
    return
  }

  const [width, height] = mainWindow.getContentSize()
  const htmlFullscreen = mainWindow.isFullScreen() || mainWindow.isSimpleFullScreen()
  const bounds =
    !htmlFullscreen && stageBounds
      ? stageBounds
      : {
          x: htmlFullscreen ? 0 : sidebarOffset,
          y: 0,
          width: Math.max(0, width - (htmlFullscreen ? 0 : sidebarOffset)),
          height
        }

  applyViewBounds(view, bounds)
}

function syncPopoutBounds(id: string): void {
  const win = popouts.get(id)
  const view = views.get(id)
  if (!win || win.isDestroyed() || !view) {
    return
  }
  const [width, height] = win.getContentSize()
  applyViewBounds(view, { x: 0, y: 0, width, height })
}

function applyViewBounds(
  view: WebContentsView,
  bounds: { x: number; y: number; width: number; height: number }
): void {
  const next = roundBounds(bounds)
  if (!next) {
    return
  }
  const current = view.getBounds()
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    view.setBounds(next)
  }
  notifyGuestResize(view.webContents)
}

function roundBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } | null {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null
  }
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  }
}

function notifyGuestResize(contents: WebContents): void {
  if (contents.isDestroyed()) {
    return
  }
  const existing = guestResizeTimers.get(contents)
  if (existing) {
    clearTimeout(existing)
  }
  guestResizeTimers.set(
    contents,
    setTimeout(() => {
      guestResizeTimers.delete(contents)
      if (contents.isDestroyed()) {
        return
      }
      void contents
        .executeJavaScript(
          `(() => {
            window.dispatchEvent(new Event('resize'));
            if (window.visualViewport) {
              window.visualViewport.dispatchEvent(new Event('resize'));
            }
          })()`
        )
        .catch(() => undefined)
    }, 16)
  )
}

function publishDetached(): void {
  onDetachedChange?.(getDetachedIds())
}

function attachUnreadTracking(profileId: string, contents: WebContents): void {
  const inject = (): void => {
    void contents.executeJavaScript(BADGE_SCRIPT, true).catch(() => undefined)
  }

  contents.on('page-title-updated', (_event, title) => {
    applyTitleUnread(profileId, title)
  })
  contents.on('did-finish-load', () => {
    applyTitleUnread(profileId, contents.getTitle())
    inject()
  })
  contents.on('did-navigate-in-page', () => {
    inject()
  })
  contents.on('console-message', (event, _level, message) => {
    const text = event.message || message
    const prefix = '__TEAMS_BADGE__:'
    if (!text.startsWith(prefix)) {
      return
    }
    const parsed = Number(text.slice(prefix.length))
    if (!Number.isFinite(parsed) || parsed < 0) {
      return
    }
    const next = Math.floor(parsed)
    if (badgeUnread.get(profileId) === next) {
      return
    }
    badgeUnread.set(profileId, next)
    publishUnread(true)
  })
}

function applyTitleUnread(profileId: string, title: string): void {
  const next = parseUnreadTitle(title)
  const previous = titleUnread.get(profileId)
  if (previous && previous.count === next.count && previous.plus === next.plus) {
    return
  }
  titleUnread.set(profileId, next)
  publishUnread(true)
}

export function parseUnreadTitle(title: string): UnreadBadge {
  const match = title.match(/\((\d+)\+?\)/)
  if (!match) {
    return { count: 0, plus: false }
  }
  return {
    count: Number(match[1]),
    plus: /\(\d+\+\)/.test(title)
  }
}

function combinedUnread(profileId: string): UnreadBadge {
  const fromTitle = titleUnread.get(profileId) ?? { count: 0, plus: false }
  const fromBadge = badgeUnread.get(profileId) ?? 0
  return {
    count: Math.max(fromTitle.count, fromBadge),
    plus: fromTitle.plus && fromTitle.count >= fromBadge
  }
}

function publishUnread(emit: boolean): UnreadMap {
  const unread: UnreadMap = {}
  const ids = new Set([...titleUnread.keys(), ...badgeUnread.keys(), ...views.keys()])
  for (const id of ids) {
    unread[id] = combinedUnread(id)
  }
  if (emit) {
    onUnreadChange?.(unread)
  }
  return unread
}
