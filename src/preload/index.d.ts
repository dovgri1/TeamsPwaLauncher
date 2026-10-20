import type {
  CreateProfileInput,
  LoadStageMap,
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
  listLoadStages: () => Promise<LoadStageMap>
  setSidebarCollapsed: (collapsed: boolean) => Promise<ProfileStore>
  setLoadAllProfiles: (enabled: boolean) => Promise<ProfileStore>
  setStageBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  setFormOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  runShortcut: (actionId: string) => Promise<boolean>
  listRecentChats: () => Promise<
    Array<{ index: number; title: string; kind: 'chat' | 'channel' | 'unknown' }>
  >
  onPaletteOpen: (
    callback: (
      recentChats?: Array<{ index: number; title: string; kind: 'chat' | 'channel' | 'unknown' }>
    ) => void
  ) => () => void
  onPaletteClose: (callback: () => void) => () => void
  platform: NodeJS.Platform
  openContextMenu: (id: string) => void
  onChanged: (callback: (store: ProfileStore) => void) => () => void
  onUnread: (callback: (unread: UnreadMap) => void) => () => void
  onLoadStage: (callback: (stages: LoadStageMap) => void) => () => void
  onDetached: (callback: (ids: string[]) => void) => () => void
  onStartEdit: (callback: (id: string) => void) => () => void
}

declare global {
  interface Window {
    teamsLauncher: TeamsLauncherApi
  }
}

export {}
