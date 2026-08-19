import {
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  desktopCapturer,
  session,
  shell,
  type HandlerDetails,
  type Session,
  type WebContents
} from 'electron'
import { SIDEBAR_WIDTH, type Profile, type UnreadBadge, type UnreadMap } from '../shared/types'

const views = new Map<string, WebContentsView>()
const configuredSessions = new Set<string>()
const titleUnread = new Map<string, UnreadBadge>()
const badgeUnread = new Map<string, number>()

let mainWindow: BrowserWindow | null = null
let activeProfileId: string | null = null
let onSwitchIndex: ((index: number) => void) | null = null
let onUnreadChange: ((unread: UnreadMap) => void) | null = null
let unreadPoll: ReturnType<typeof setInterval> | null = null

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

const ALLOWED_HOSTS = [
  /(?:^|\.)microsoft\.com$/i,
  /(?:^|\.)microsoftonline\.com$/i,
  /(?:^|\.)microsoftonline-p\.com$/i,
  /(?:^|\.)msauth\.net$/i,
  /(?:^|\.)msauthimages\.net$/i,
  /(?:^|\.)msecnd\.net$/i,
  /(?:^|\.)live\.com$/i,
  /(?:^|\.)office\.com$/i,
  /(?:^|\.)office365\.com$/i,
  /(?:^|\.)office\.net$/i,
  /(?:^|\.)sharepoint\.com$/i,
  /(?:^|\.)sharepointonline\.com$/i,
  /(?:^|\.)cloud\.microsoft$/i,
  /(?:^|\.)microsoft365\.com$/i,
  /(?:^|\.)skype\.com$/i,
  /(?:^|\.)aka\.ms$/i,
  /(?:^|\.)azure\.net$/i,
  /(?:^|\.)azureedge\.net$/i,
  /(?:^|\.)windows\.net$/i,
  /(?:^|\.)svc\.ms$/i,
  /(?:^|\.)microsoftpersonalcontent\.com$/i,
  /(?:^|\.)msftauth\.net$/i,
  /(?:^|\.)msftauthimages\.net$/i
]

export function setSwitchIndexHandler(handler: (index: number) => void): void {
  onSwitchIndex = handler
}

export function setUnreadHandler(handler: (unread: UnreadMap) => void): void {
  onUnreadChange = handler
}

export function getUnreadMap(): UnreadMap {
  return publishUnread(false)
}

export function initTeamsViews(win: BrowserWindow): void {
  mainWindow = win
  win.on('resize', syncActiveBounds)
  win.on('maximize', syncActiveBounds)
  win.on('unmaximize', syncActiveBounds)
  win.on('enter-html-full-screen', () => {
    const view = activeView()
    if (!view) {
      return
    }
    const [width, height] = win.getContentSize()
    view.setBounds({ x: 0, y: 0, width, height })
  })
  win.on('leave-html-full-screen', syncActiveBounds)

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

  let view = views.get(profile.id)
  if (!view) {
    view = createView(profile)
    views.set(profile.id, view)
    mainWindow.contentView.addChildView(view)
  }

  for (const [id, existing] of views) {
    existing.setVisible(id === profile.id)
  }

  activeProfileId = profile.id
  view.setVisible(true)
  syncActiveBounds()
  view.webContents.focus()
}

export function hideAllViews(): void {
  activeProfileId = null
  for (const view of views.values()) {
    view.setVisible(false)
  }
}

export function reloadProfile(id: string): void {
  views.get(id)?.webContents.reload()
}

export function toggleActiveDevTools(): void {
  activeView()?.webContents.toggleDevTools()
}

export async function destroyProfileView(id: string): Promise<void> {
  const view = views.get(id)
  if (view) {
    view.setVisible(false)
    mainWindow?.contentView.removeChildView(view)
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

  const ses = session.fromPartition(`persist:${id}`)
  await ses.clearCache()
  await ses.clearStorageData()
  configuredSessions.delete(id)
}

export function attachAppWebContentsHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler((details) => handleWindowOpen(details, contents))
    contents.on('will-navigate', (event, url) => {
      if (isAppRendererUrl(url) || isAllowedTeamsUrl(url)) {
        return
      }
      event.preventDefault()
      void shell.openExternal(url)
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
  })
}

export function syncBounds(): void {
  syncActiveBounds()
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
  view.setVisible(false)
  void view.webContents.loadURL(profile.url)
  return view
}

function configureSession(ses: Session, profileId: string): void {
  if (configuredSessions.has(profileId)) {
    return
  }
  configuredSessions.add(profileId)

  ses.setUserAgent(chromeUserAgent())
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  ses.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))

  ses.setDisplayMediaRequestHandler((_request, callback) => {
    void desktopCapturer
      .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const source = sources[0]
        if (!source) {
          callback({})
          return
        }
        callback({
          video: source,
          audio: 'loopback'
        })
      })
  }, { useSystemPicker: true })
}

function chromeUserAgent(): string {
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
  if (isAllowedTeamsUrl(details.url) || details.url === 'about:blank' || details.url.startsWith('about:blank?')) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1100,
        height: 800,
        autoHideMenuBar: true,
        backgroundColor: '#1B1A19',
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

  void shell.openExternal(details.url)
  return { action: 'deny' }
}

function isAllowedTeamsUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false
  }

  return ALLOWED_HOSTS.some((pattern) => pattern.test(parsed.hostname))
}

function isAppRendererUrl(url: string): boolean {
  return (
    url.startsWith('file:') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('devtools:')
  )
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

  Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined })
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

  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
    event.preventDefault()
    activeView()?.webContents.reload()
    return
  }

  if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
    event.preventDefault()
    activeView()?.webContents.toggleDevTools()
    return
  }

  if (input.key === 'F12') {
    event.preventDefault()
    mainWindow?.webContents.toggleDevTools()
  }
}

function activeView(): WebContentsView | undefined {
  if (!activeProfileId) {
    return undefined
  }
  return views.get(activeProfileId)
}

function syncActiveBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const view = activeView()
  if (!view) {
    return
  }

  const [width, height] = mainWindow.getContentSize()
  if (mainWindow.isFullScreen() || mainWindow.isSimpleFullScreen()) {
    view.setBounds({ x: 0, y: 0, width, height })
    return
  }

  view.setBounds({
    x: SIDEBAR_WIDTH,
    y: 0,
    width: Math.max(0, width - SIDEBAR_WIDTH),
    height
  })
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
