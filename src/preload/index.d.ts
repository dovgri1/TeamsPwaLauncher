import type {
  CreateProfileInput,
  ProfileStore,
  UnreadMap,
  UpdateProfileInput
} from '../shared/types'

export type TeamsLauncherApi = {
  listProfiles: () => Promise<ProfileStore>
  createProfile: (input: CreateProfileInput) => Promise<ProfileStore>
  updateProfile: (input: UpdateProfileInput) => Promise<ProfileStore>
  deleteProfile: (id: string) => Promise<ProfileStore>
  switchProfile: (id: string) => Promise<ProfileStore>
  reloadProfile: (id: string) => Promise<ProfileStore>
  clearSession: (id: string) => Promise<ProfileStore>
  detachProfile: (id: string) => Promise<{ store: ProfileStore; detachedIds: string[] }>
  reattachProfile: (id: string) => Promise<{ store: ProfileStore; detachedIds: string[] }>
  focusDetached: (id: string) => Promise<string[]>
  listDetached: () => Promise<string[]>
  listUnread: () => Promise<UnreadMap>
  setSidebarCollapsed: (collapsed: boolean) => Promise<ProfileStore>
  openContextMenu: (id: string) => void
  onChanged: (callback: (store: ProfileStore) => void) => () => void
  onUnread: (callback: (unread: UnreadMap) => void) => () => void
  onDetached: (callback: (ids: string[]) => void) => () => void
  onStartEdit: (callback: (id: string) => void) => () => void
}

declare global {
  interface Window {
    teamsLauncher: TeamsLauncherApi
  }
}

export {}
