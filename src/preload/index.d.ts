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
  listUnread: () => Promise<UnreadMap>
  setSidebarCollapsed: (collapsed: boolean) => Promise<ProfileStore>
  openContextMenu: (id: string) => void
  onChanged: (callback: (store: ProfileStore) => void) => () => void
  onUnread: (callback: (unread: UnreadMap) => void) => () => void
  onStartEdit: (callback: (id: string) => void) => () => void
}

declare global {
  interface Window {
    teamsLauncher: TeamsLauncherApi
  }
}

export {}
