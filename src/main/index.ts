import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createProfileRecord, loadStore, saveStore } from './profiles'
import {
  attachAppWebContentsHandlers,
  clearProfileSession,
  destroyProfileView,
  detachProfile,
  focusDetached,
  getDetachedIds,
  getUnreadMap,
  hideAllViews,
  hideEmbeddedViews,
  initTeamsViews,
  isDetached,
  reattachProfile,
  reloadProfile,
  setActiveClearedHandler,
  setDetachedChangeHandler,
  setSwitchIndexHandler,
  setToggleSidebarHandler,
  setSidebarCollapsed,
  setStageBounds,
  setUnreadHandler,
  setLoadStageHandler,
  getLoadStageMap,
  showProfile,
  ensureView,
  preloadProfiles,
  syncBounds,
  toggleActiveDevTools,
  chromeUserAgent,
  switchAccount,
  flushProfileSessions,
  setOpenPaletteHandler,
  setClosePaletteHandler,
  setRunShortcutActionHandler,
  setPaletteOpen,
  setFormOverlayOpen,
  focusCompose,
  openTeamsPane,
  focusTeamsSearch,
  openTeamsChatAt,
  listTeamsRecentChats
} from './teamsView'
import { initLogger, log, openLogsFolder, revealCurrentLog } from './logger'
import type { CreateProfileInput, ProfileStore, UnreadMap, UpdateProfileInput } from '../shared/types'
import { sanitizeProfileUrl } from '../shared/teamsUrls'
import { parseChatOpenIndex, parseTenantSwitchId } from '../shared/shortcutActions'

let mainWindow: BrowserWindow | null = null
let store: ProfileStore = {
  profiles: [],
  activeProfileId: null,
  sidebarCollapsed: false,
  loadAllProfiles: false
}
let unread: UnreadMap = {}
let detachedIds: string[] = []

app.setPath('userData', join(app.getPath('appData'), 'teams-pwa-launcher'))

const disabledFeatures = [
  'ThirdPartyStoragePartitioning',
  'ThirdPartyCookieBlocking',
  'TrackingProtection3pcd',
  'CookieDeprecationFacilitatedTesting',
  'UserAgentClientHint',
  'WebAuthentication',
  'WebAuthenticationConditionalUI'
]
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
}
if (process.platform === 'darwin' && process.env.TEAMS_LAUNCHER_GPU !== '1') {
  app.disableHardwareAcceleration()
}
app.userAgentFallback = chromeUserAgent()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  process.on('uncaughtException', (error) => {
    try {
      log('error', 'app', 'uncaught-exception', {
        name: error.name,
        message: error.message,
        stack: error.stack
      })
    } catch {
      console.error(error)
    }
  })
  process.on('unhandledRejection', (reason) => {
    try {
      log('error', 'app', 'unhandled-rejection', {
        reason: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : String(reason)
      })
    } catch {
      console.error(reason)
    }
  })
}

attachAppWebContentsHandlers()

app.whenReady().then(() => {
  if (!gotLock) {
    return
  }

  initLogger()
  electronApp.setAppUserModelId('com.domestiquesolutions.teamspwalauncher')
  store = loadStore()
  log('info', 'app', 'ready', {
    profiles: store.profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    activeProfileId: store.activeProfileId,
    loadAllProfiles: store.loadAllProfiles
  })
  setSidebarCollapsed(store.sidebarCollapsed)
  setSwitchIndexHandler((index) => {
    const profile = store.profiles[index]
    if (profile) {
      void switchProfile(profile.id)
    }
  })
  setToggleSidebarHandler(() => {
    applySidebarCollapsed(!store.sidebarCollapsed)
  })
  setOpenPaletteHandler(() => {
    openCommandPalette()
  })
  setClosePaletteHandler(() => {
    closeCommandPalette()
  })
  setRunShortcutActionHandler((actionId) => {
    void runShortcutAction(actionId)
  })
  setUnreadHandler((next) => {
    unread = next
    mainWindow?.webContents.send('unread:changed', unread)
    updateWindowTitle()
  })
  setLoadStageHandler((next) => {
    mainWindow?.webContents.send('loadStage:changed', next)
  })
  setDetachedChangeHandler((ids) => {
    detachedIds = ids
    mainWindow?.webContents.send('detached:changed', detachedIds)
  })
  setActiveClearedHandler(() => {
    const next = store.profiles.find((profile) => !isDetached(profile.id))
    if (next) {
      store = { ...store, activeProfileId: next.id }
      persist()
      showProfile(next)
      broadcast()
      updateWindowTitle()
      return
    }
    store = { ...store, activeProfileId: null }
    persist()
    hideAllViews()
    broadcast()
    updateWindowTitle()
  })
  registerIpc()
  applyAppMenu()
  createWindow()
  restoreActiveProfile()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
      restoreActiveProfile()
    }
  })
})

app.on('second-instance', () => {
  if (!mainWindow) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

let flushingForQuit = false
app.on('before-quit', (event) => {
  if (flushingForQuit) {
    return
  }
  event.preventDefault()
  flushingForQuit = true
  void flushProfileSessions(store.profiles.map((profile) => profile.id)).finally(() => {
    app.quit()
  })
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    backgroundColor: '#201F1E',
    title: 'Teams PWA Launcher',
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  initTeamsViews(mainWindow)
  applyAppMenu()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    syncBounds()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('profiles:list', () => store)
  ipcMain.handle('profiles:create', (_event, input: CreateProfileInput) => createProfile(input))
  ipcMain.handle('profiles:update', (_event, input: UpdateProfileInput) => updateProfile(input))
  ipcMain.handle('profiles:delete', (_event, id: string) => deleteProfile(id))
  ipcMain.handle('profiles:switch', (_event, id: string) => switchProfile(id))
  ipcMain.handle('profiles:reload', (_event, id: string) => {
    reloadProfile(id)
    return store
  })
  ipcMain.handle('profiles:clearSession', (_event, id: string) => clearSession(id))
  ipcMain.handle('profiles:detach', (_event, id: string) => {
    const profile = store.profiles.find((item) => item.id === id)
    if (profile) {
      detachProfile(profile)
    }
    return { store, detachedIds: getDetachedIds() }
  })
  ipcMain.handle('profiles:reattach', (_event, id: string) => {
    reattachProfile(id)
    const profile = store.profiles.find((item) => item.id === id)
    if (profile) {
      store = { ...store, activeProfileId: id }
      persist()
      broadcast()
      updateWindowTitle()
    }
    return { store, detachedIds: getDetachedIds() }
  })
  ipcMain.handle('profiles:focusDetached', (_event, id: string) => {
    focusDetached(id)
    return getDetachedIds()
  })
  ipcMain.handle('detached:list', () => getDetachedIds())
  ipcMain.handle('unread:list', () => getUnreadMap())
  ipcMain.handle('loadStage:list', () => getLoadStageMap())
  ipcMain.handle('ui:setSidebarCollapsed', (_event, collapsed: boolean) => {
    applySidebarCollapsed(collapsed)
    return store
  })
  ipcMain.handle('ui:setLoadAllProfiles', (_event, enabled: boolean) => {
    applyLoadAllProfiles(enabled)
    return store
  })
  ipcMain.on('ui:stageBounds', (event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (event.sender !== mainWindow?.webContents) {
      return
    }
    setStageBounds(bounds)
  })
  ipcMain.on('ui:formOpen', (event, open: boolean) => {
    if (event.sender !== mainWindow?.webContents) {
      return
    }
    setFormOverlayOpen(open)
    if (open) {
      hideEmbeddedViews()
      // Teams views can keep keyboard focus even when hidden — move it to the shell.
      if (!mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus()
      }
      return
    }
    const profile = store.profiles.find((item) => item.id === store.activeProfileId)
    if (profile && !isDetached(profile.id)) {
      showProfile(profile)
    }
  })
  ipcMain.on('shortcuts:setOpen', (event, open: boolean) => {
    if (event.sender !== mainWindow?.webContents) {
      return
    }
    setPaletteOpen(Boolean(open))
    if (open && mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
  })
  ipcMain.handle('shortcuts:run', async (_event, actionId: string) => {
    await runShortcutAction(actionId)
    return true
  })
  ipcMain.handle('shortcuts:listRecentChats', async () => {
    return listTeamsRecentChats()
  })
  ipcMain.on('profiles:contextMenu', (event, id: string) => {
    const profile = store.profiles.find((item) => item.id === id)
    if (!profile) {
      return
    }

    const detached = isDetached(id)
    Menu.buildFromTemplate([
      { label: 'Reload Teams', click: () => reloadProfile(id) },
      { label: 'Switch account…', click: () => switchAccount(profile) },
      { label: 'Clear session…', click: () => void clearSession(id) },
      { label: 'Edit profile', click: () => event.sender.send('profiles:startEdit', id) },
      { type: 'separator' },
      ...(detached
        ? [
            {
              label: 'Return to main window',
              click: () => {
                reattachProfile(id)
                store = { ...store, activeProfileId: id }
                persist()
                broadcast()
                updateWindowTitle()
              }
            },
            {
              label: 'Focus detached window',
              click: () => focusDetached(id)
            }
          ]
        : [
            {
              label: 'Detach window',
              click: () => detachProfile(profile)
            }
          ]),
      { type: 'separator' },
      { label: 'Delete', click: () => void deleteProfile(id) }
    ]).popup({ window: mainWindow ?? undefined })
  })
}

function createProfile(input: CreateProfileInput): ProfileStore {
  const profile = createProfileRecord(input.name, input.color, input.icon, input.url)
  store = {
    ...store,
    profiles: [...store.profiles, profile],
    activeProfileId: profile.id
  }
  persist()
  showProfile(profile)
  if (store.loadAllProfiles) {
    ensureView(profile)
  }
  broadcast()
  updateWindowTitle()
  return store
}

function updateProfile(input: UpdateProfileInput): ProfileStore {
  store = {
    ...store,
    profiles: store.profiles.map((profile) =>
      profile.id === input.id
        ? {
            ...profile,
            name: input.name?.trim() || profile.name,
            color: input.color ?? profile.color,
            icon: input.icon ?? profile.icon,
            url: input.url !== undefined ? sanitizeProfileUrl(input.url) : profile.url
          }
        : profile
    )
  }
  persist()
  broadcast()
  updateWindowTitle()
  return store
}

async function clearSession(id: string): Promise<ProfileStore> {
  const profile = store.profiles.find((item) => item.id === id)
  if (!profile || !mainWindow) {
    return store
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Clear session'],
    defaultId: 0,
    cancelId: 0,
    title: 'Clear session',
    message: `Clear session for “${profile.name}”?`,
    detail:
      'This signs you out of this profile and clears its cookies and local Teams data. The profile stays in the sidebar so you can sign in again.'
  })

  if (response !== 1) {
    return store
  }

  store = { ...store, activeProfileId: id }
  persist()
  await clearProfileSession(profile)
  broadcast()
  updateWindowTitle()
  return store
}

async function deleteProfile(id: string): Promise<ProfileStore> {
  const profile = store.profiles.find((item) => item.id === id)
  if (!profile || !mainWindow) {
    return store
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Delete'],
    defaultId: 0,
    cancelId: 0,
    title: 'Delete profile',
    message: `Delete “${profile.name}”?`,
    detail: 'This signs out this profile and clears its cookies and local Teams data.'
  })

  if (response !== 1) {
    return store
  }

  await destroyProfileView(id)
  const profiles = store.profiles.filter((item) => item.id !== id)
  const activeProfileId =
    store.activeProfileId === id ? (profiles.find((item) => !isDetached(item.id))?.id ?? null) : store.activeProfileId
  store = { ...store, profiles, activeProfileId }
  persist()

  if (activeProfileId) {
    const next = profiles.find((item) => item.id === activeProfileId)
    if (next) {
      showProfile(next)
    }
  } else {
    hideAllViews()
  }

  broadcast()
  updateWindowTitle()
  return store
}

async function switchProfile(id: string): Promise<ProfileStore> {
  const profile = store.profiles.find((item) => item.id === id)
  if (!profile) {
    return store
  }

  if (isDetached(id)) {
    focusDetached(id)
    return store
  }

  store = { ...store, activeProfileId: id }
  persist()
  showProfile(profile)
  broadcast()
  updateWindowTitle()
  return store
}

async function switchProfileRelative(delta: number): Promise<ProfileStore> {
  const profiles = store.profiles
  if (profiles.length === 0) {
    return store
  }

  const currentIndex = profiles.findIndex((profile) => profile.id === store.activeProfileId)
  const from = currentIndex >= 0 ? currentIndex : 0
  const nextIndex = (from + delta + profiles.length * 10) % profiles.length
  return switchProfile(profiles[nextIndex].id)
}

function restoreActiveProfile(): void {
  if (store.loadAllProfiles) {
    preloadProfiles(store.profiles, store.activeProfileId)
  } else {
    const profile = store.profiles.find((item) => item.id === store.activeProfileId)
    if (profile) {
      showProfile(profile)
    } else {
      hideAllViews()
    }
  }
  updateWindowTitle()
}

function persist(): void {
  saveStore(store)
}

function applySidebarCollapsed(collapsed: boolean): void {
  store = { ...store, sidebarCollapsed: collapsed }
  persist()
  setSidebarCollapsed(collapsed)
  broadcast()
  applyAppMenu()
}

function applyLoadAllProfiles(enabled: boolean): void {
  store = { ...store, loadAllProfiles: enabled }
  persist()
  log('info', 'app', 'set-load-all-profiles', { enabled })
  if (enabled) {
    preloadProfiles(store.profiles, store.activeProfileId)
  }
  broadcast()
  applyAppMenu()
}

function broadcast(): void {
  mainWindow?.webContents.send('profiles:changed', store)
  mainWindow?.webContents.send('detached:changed', getDetachedIds())
}

function openCommandPalette(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
  // Scrape chats while the Teams view is still visible, then open the palette.
  void listTeamsRecentChats().then((chats) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }
    if (!mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.focus()
    }
    mainWindow.webContents.send('shortcuts:open', chats)
  })
}

function closeCommandPalette(): void {
  mainWindow?.webContents.send('shortcuts:close')
}

async function afterPaletteRestore(): Promise<void> {
  // Palette close restores the Teams view via ui:formOpen; wait briefly for layout/focus.
  await new Promise<void>((resolve) => setTimeout(resolve, 120))
}

async function runShortcutAction(actionId: string): Promise<void> {
  const tenantId = parseTenantSwitchId(actionId)
  if (tenantId) {
    await switchProfile(tenantId)
    return
  }

  const chatIndex = parseChatOpenIndex(actionId)
  if (chatIndex !== null) {
    await afterPaletteRestore()
    await openTeamsChatAt(chatIndex)
    return
  }

  switch (actionId) {
    case 'tenant.next':
      await switchProfileRelative(1)
      return
    case 'tenant.prev':
      await switchProfileRelative(-1)
      return
    case 'sidebar.toggle':
      applySidebarCollapsed(!store.sidebarCollapsed)
      return
    case 'tenant.reload':
      if (store.activeProfileId) {
        reloadProfile(store.activeProfileId)
      }
      return
    case 'tenant.detach': {
      const profile = store.profiles.find((item) => item.id === store.activeProfileId)
      if (profile && !isDetached(profile.id)) {
        detachProfile(profile)
      }
      return
    }
    case 'tenant.reattach': {
      const id = store.activeProfileId
      if (id && isDetached(id)) {
        reattachProfile(id)
        store = { ...store, activeProfileId: id }
        persist()
        broadcast()
        updateWindowTitle()
      } else if (detachedIds[0]) {
        const first = detachedIds[0]
        reattachProfile(first)
        store = { ...store, activeProfileId: first }
        persist()
        broadcast()
        updateWindowTitle()
      }
      return
    }
    case 'compose.focus':
      await afterPaletteRestore()
      await focusCompose()
      return
    case 'pane.chat':
      await afterPaletteRestore()
      await openTeamsPane('chat')
      return
    case 'pane.teams':
      await afterPaletteRestore()
      await openTeamsPane('teams')
      return
    case 'pane.activity':
      await afterPaletteRestore()
      await openTeamsPane('activity')
      return
    case 'pane.calendar':
      await afterPaletteRestore()
      await openTeamsPane('calendar')
      return
    case 'teams.search':
      await afterPaletteRestore()
      await focusTeamsSearch()
      return
    case 'devtools.teams':
      toggleActiveDevTools()
      return
    case 'devtools.shell':
      mainWindow?.webContents.toggleDevTools()
      return
    default:
      log('warn', 'shortcuts', 'unknown-action', { actionId })
  }
}

function updateWindowTitle(): void {
  const profile = store.profiles.find((item) => item.id === store.activeProfileId)
  if (!profile || !mainWindow) {
    mainWindow?.setTitle('Teams PWA Launcher')
    return
  }
  const badge = unread[profile.id]
  const countLabel =
    badge && badge.count > 0 ? `(${badge.count}${badge.plus ? '+' : ''}) ` : ''
  mainWindow.setTitle(`${countLabel}${profile.name}`)
}

function applyAppMenu(): void {
  const menu = buildAppMenu()
  Menu.setApplicationMenu(menu)
  if (process.platform !== 'darwin') {
    mainWindow?.setMenu(menu)
  }
}

function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies Electron.MenuItemConstructorOptions
        ]
      : [
          {
            label: 'File',
            submenu: [{ role: 'quit' }]
          } satisfies Electron.MenuItemConstructorOptions
        ]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => openCommandPalette()
        },
        {
          label: 'Reload Teams',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (store.activeProfileId) {
              reloadProfile(store.activeProfileId)
            }
          }
        },
        {
          label: 'Previous tenant',
          accelerator: 'CmdOrCtrl+Up',
          click: () => {
            void switchProfileRelative(-1)
          }
        },
        {
          label: 'Next tenant',
          accelerator: 'CmdOrCtrl+Down',
          click: () => {
            void switchProfileRelative(1)
          }
        },
        {
          label: 'Switch account…',
          click: () => {
            const profile = store.profiles.find((item) => item.id === store.activeProfileId)
            if (profile) {
              switchAccount(profile)
            }
          }
        },
        {
          label: 'Clear session for active profile…',
          click: () => {
            if (store.activeProfileId) {
              void clearSession(store.activeProfileId)
            }
          }
        },
        {
          label: store.sidebarCollapsed ? 'Show tenant sidebar' : 'Hide tenant sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => applySidebarCollapsed(!store.sidebarCollapsed)
        },
        {
          label: 'Load all tenants on startup',
          type: 'checkbox',
          checked: store.loadAllProfiles,
          click: () => applyLoadAllProfiles(!store.loadAllProfiles)
        },
        {
          label: 'Detach active tenant',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => {
            void runShortcutAction('tenant.detach')
          }
        },
        {
          label: 'Return tenant to main window',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            void runShortcutAction('tenant.reattach')
          }
        },
        {
          label: 'Focus message box',
          click: () => {
            void runShortcutAction('compose.focus')
          }
        },
        { type: 'separator' },
        {
          label: 'Open logs folder',
          click: () => {
            void openLogsFolder()
          }
        },
        {
          label: 'Reveal current log',
          click: () => {
            void revealCurrentLog()
          }
        },
        {
          label: 'Toggle Teams DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => toggleActiveDevTools()
        },
        { role: 'toggleDevTools', label: 'Toggle Sidebar DevTools', accelerator: 'F12' },
        { role: 'togglefullscreen' }
      ]
    },
    ...(isMac
      ? [
          {
            role: 'windowMenu'
          } satisfies Electron.MenuItemConstructorOptions
        ]
      : [])
  ]

  return Menu.buildFromTemplate(template)
}
