import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  CreateProfileInput,
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
  listUnread: (): Promise<UnreadMap> => ipcRenderer.invoke('unread:list'),
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
