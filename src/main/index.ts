import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createProfileRecord, loadStore, saveStore } from './profiles'
import {
  attachAppWebContentsHandlers,
  destroyProfileView,
  getUnreadMap,
  hideAllViews,
  initTeamsViews,
  reloadProfile,
  setSwitchIndexHandler,
  setUnreadHandler,
  showProfile,
  syncBounds,
  toggleActiveDevTools
} from './teamsView'
import type { CreateProfileInput, ProfileStore, UnreadMap, UpdateProfileInput } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let store: ProfileStore = { profiles: [], activeProfileId: null }
let unread: UnreadMap = {}

app.setPath('userData', join(app.getPath('appData'), 'teams-pwa-launcher'))
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

attachAppWebContentsHandlers()

app.whenReady().then(() => {
  if (!gotLock) {
    return
  }

  electronApp.setAppUserModelId('com.domestiquesolutions.teamspwalauncher')
  store = loadStore()
  setSwitchIndexHandler((index) => {
    const profile = store.profiles[index]
    if (profile) {
      void switchProfile(profile.id)
    }
  })
  setUnreadHandler((next) => {
    unread = next
    mainWindow?.webContents.send('unread:changed', unread)
    updateWindowTitle()
  })
  registerIpc()
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1B1A19',
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
  mainWindow.setMenu(buildAppMenu())

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
  ipcMain.handle('unread:list', () => getUnreadMap())
  ipcMain.on('profiles:contextMenu', (event, id: string) => {
    const profile = store.profiles.find((item) => item.id === id)
    if (!profile) {
      return
    }

    Menu.buildFromTemplate([
      { label: 'Reload Teams', click: () => reloadProfile(id) },
      { label: 'Edit profile', click: () => event.sender.send('profiles:startEdit', id) },
      { type: 'separator' },
      { label: 'Delete', click: () => void deleteProfile(id) }
    ]).popup({ window: mainWindow ?? undefined })
  })
}

function createProfile(input: CreateProfileInput): ProfileStore {
  const profile = createProfileRecord(input.name, input.color, input.icon, input.url)
  store = {
    profiles: [...store.profiles, profile],
    activeProfileId: profile.id
  }
  persist()
  showProfile(profile)
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
            url: input.url?.trim() || profile.url
          }
        : profile
    )
  }
  persist()
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
    store.activeProfileId === id ? (profiles[0]?.id ?? null) : store.activeProfileId
  store = { profiles, activeProfileId }
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

  store = { ...store, activeProfileId: id }
  persist()
  showProfile(profile)
  broadcast()
  updateWindowTitle()
  return store
}

function restoreActiveProfile(): void {
  const profile = store.profiles.find((item) => item.id === store.activeProfileId)
  if (profile) {
    showProfile(profile)
  } else {
    hideAllViews()
  }
  updateWindowTitle()
}

function persist(): void {
  saveStore(store)
}

function broadcast(): void {
  mainWindow?.webContents.send('profiles:changed', store)
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

function buildAppMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [{ role: 'quit' }]
    },
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
          label: 'Reload Teams',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (store.activeProfileId) {
              reloadProfile(store.activeProfileId)
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle Teams DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => toggleActiveDevTools()
        },
        { role: 'toggleDevTools', label: 'Toggle Sidebar DevTools', accelerator: 'F12' }
      ]
    }
  ])
}
