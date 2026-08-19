import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  DEFAULT_TEAMS_URL,
  PROFILE_COLORS,
  PROFILE_ICON_IDS,
  type Profile,
  type ProfileIconId,
  type ProfileStore
} from '../shared/types'

function storePath(): string {
  return join(app.getPath('userData'), 'profiles.json')
}

export function loadStore(): ProfileStore {
  try {
    const data = JSON.parse(readFileSync(storePath(), 'utf-8')) as Partial<ProfileStore>
    const profiles = Array.isArray(data.profiles)
      ? data.profiles.map(normalizeProfile).filter((profile): profile is Profile => profile !== null)
      : []
    const activeProfileId =
      profiles.some((profile) => profile.id === data.activeProfileId) && data.activeProfileId
        ? data.activeProfileId
        : (profiles[0]?.id ?? null)

    return { profiles, activeProfileId, sidebarCollapsed: Boolean(data.sidebarCollapsed) }
  } catch {
    return { profiles: [], activeProfileId: null, sidebarCollapsed: false }
  }
}

export function saveStore(store: ProfileStore): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(storePath(), JSON.stringify(store, null, 2))
}

export function createProfileRecord(
  name: string,
  color: string,
  icon?: ProfileIconId,
  url?: string
): Profile {
  const trimmed = name.trim()
  return {
    id: randomUUID(),
    name: trimmed || 'Teams',
    color: color || PROFILE_COLORS[0],
    icon: isIconId(icon) ? icon : 'letter',
    url: url?.trim() || DEFAULT_TEAMS_URL
  }
}

function normalizeProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const profile = value as Partial<Profile>
  if (
    typeof profile.id !== 'string' ||
    typeof profile.name !== 'string' ||
    typeof profile.color !== 'string' ||
    typeof profile.url !== 'string'
  ) {
    return null
  }

  return {
    id: profile.id,
    name: profile.name,
    color: profile.color,
    icon: isIconId(profile.icon) ? profile.icon : 'letter',
    url: profile.url
  }
}

function isIconId(value: unknown): value is ProfileIconId {
  return typeof value === 'string' && (PROFILE_ICON_IDS as readonly string[]).includes(value)
}
