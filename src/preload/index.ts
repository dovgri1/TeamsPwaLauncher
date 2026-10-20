import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CreateProfileInput,
  LoadStageMap,
  ProfileStore,
  UnreadMap,
  UpdateProfileInput
} from '../shared/types'

const teamsLauncher = {
  listProfiles: (): Promise<ProfileStore> => ipcRenderer.invoke('profiles:list'),
  createProfile: (input: CreateProfileInput): Promise<ProfileStore> =>
    ipcRenderer.invoke('profiles:create', input),
  updateProfile: (input: UpdateProfileInput): Promise<ProfileStore> =>
    ipcRenderer.invoke('profiles:update', input),
  deleteProfile: (id: string): Promise<ProfileStore> => ipcRenderer.invoke('profiles:delete', id),
  switchProfile: (id: string): Promise<ProfileStore> => ipcRenderer.invoke('profiles:switch', id),
  reloadProfile: (id: string): Promise<ProfileStore> => ipcRenderer.invoke('profiles:reload', id),
  clearSession: (id: string): Promise<ProfileStore> =>
    ipcRenderer.invoke('profiles:clearSession', id),
  detachProfile: (id: string): Promise<{ store: ProfileStore; detachedIds: string[] }> =>
    ipcRenderer.invoke('profiles:detach', id),
  reattachProfile: (id: string): Promise<{ store: ProfileStore; detachedIds: string[] }> =>
    ipcRenderer.invoke('profiles:reattach', id),
  focusDetached: (id: string): Promise<string[]> => ipcRenderer.invoke('profiles:focusDetached', id),
  listDetached: (): Promise<string[]> => ipcRenderer.invoke('detached:list'),
  listUnread: (): Promise<UnreadMap> => ipcRenderer.invoke('unread:list'),
  listLoadStages: (): Promise<LoadStageMap> => ipcRenderer.invoke('loadStage:list'),
  setSidebarCollapsed: (collapsed: boolean): Promise<ProfileStore> =>
    ipcRenderer.invoke('ui:setSidebarCollapsed', collapsed),
  setLoadAllProfiles: (enabled: boolean): Promise<ProfileStore> =>
    ipcRenderer.invoke('ui:setLoadAllProfiles', enabled),
  setStageBounds: (bounds: { x: number; y: number; width: number; height: number }): void => {
    ipcRenderer.send('ui:stageBounds', bounds)
  },
  setFormOpen: (open: boolean): void => {
    ipcRenderer.send('ui:formOpen', open)
  },
  setPaletteOpen: (open: boolean): void => {
    ipcRenderer.send('shortcuts:setOpen', open)
  },
  runShortcut: (actionId: string): Promise<boolean> => ipcRenderer.invoke('shortcuts:run', actionId),
  listRecentChats: (): Promise<
    Array<{ index: number; title: string; kind: 'chat' | 'channel' | 'unknown' }>
  > => ipcRenderer.invoke('shortcuts:listRecentChats'),
  onPaletteOpen: (
    callback: (
      recentChats?: Array<{ index: number; title: string; kind: 'chat' | 'channel' | 'unknown' }>
    ) => void
  ): (() => void) => {
    const listener = (
      _event: IpcRendererEvent,
      recentChats?: Array<{ index: number; title: string; kind: 'chat' | 'channel' | 'unknown' }>
    ): void => {
      callback(recentChats)
    }
    ipcRenderer.on('shortcuts:open', listener)
    return () => {
      ipcRenderer.removeListener('shortcuts:open', listener)
    }
  },
  onPaletteClose: (callback: () => void): (() => void) => {
    const listener = (): void => {
      callback()
    }
    ipcRenderer.on('shortcuts:close', listener)
    return () => {
      ipcRenderer.removeListener('shortcuts:close', listener)
    }
  },
  platform: process.platform,
  openContextMenu: (id: string): void => {
    ipcRenderer.send('profiles:contextMenu', id)
  },
  onChanged: (callback: (store: ProfileStore) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, next: ProfileStore): void => {
      callback(next)
    }
    ipcRenderer.on('profiles:changed', listener)
    return () => {
      ipcRenderer.removeListener('profiles:changed', listener)
    }
  },
  onUnread: (callback: (unread: UnreadMap) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, next: UnreadMap): void => {
      callback(next)
    }
    ipcRenderer.on('unread:changed', listener)
    return () => {
      ipcRenderer.removeListener('unread:changed', listener)
    }
  },
  onLoadStage: (callback: (stages: LoadStageMap) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, next: LoadStageMap): void => {
      callback(next)
    }
    ipcRenderer.on('loadStage:changed', listener)
    return () => {
      ipcRenderer.removeListener('loadStage:changed', listener)
    }
  },
  onDetached: (callback: (ids: string[]) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, ids: string[]): void => {
      callback(ids)
    }
    ipcRenderer.on('detached:changed', listener)
    return () => {
      ipcRenderer.removeListener('detached:changed', listener)
    }
  },
  onStartEdit: (callback: (id: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, id: string): void => {
      callback(id)
    }
    ipcRenderer.on('profiles:startEdit', listener)
    return () => {
      ipcRenderer.removeListener('profiles:startEdit', listener)
    }
  }
}

contextBridge.exposeInMainWorld('teamsLauncher', teamsLauncher)
