export const DEFAULT_TEAMS_URL = 'https://teams.microsoft.com'

export const SIDEBAR_WIDTH = 240

export const PROFILE_COLORS = [
  '#6264A7',
  '#4B53BC',
  '#5B5FC7',
  '#7F85F5',
  '#0F6CBD',
  '#115EA3',
  '#00BCF2',
  '#4F6BED',
  '#038387',
  '#00B7C3',
  '#0E9C9C',
  '#107C10',
  '#13A10E',
  '#498205',
  '#0B6A0B',
  '#D83B01',
  '#F7630C',
  '#FFB900',
  '#C4314B',
  '#E3008C',
  '#B4009E',
  '#D13438',
  '#8764B8',
  '#9A38D6',
  '#5C2E91',
  '#8B5A2B',
  '#73818F',
  '#201F1E'
] as const

export const PROFILE_ICON_IDS = [
  'letter',
  'briefcase',
  'home',
  'building',
  'user',
  'users',
  'laptop',
  'graduation',
  'globe',
  'star',
  'heart',
  'bolt',
  'chat',
  'calendar',
  'wrench',
  'coffee',
  'book',
  'shield',
  'rocket',
  'flag',
  'leaf',
  'moon'
] as const

export type ProfileIconId = (typeof PROFILE_ICON_IDS)[number]

export type Profile = {
  id: string
  name: string
  color: string
  icon: ProfileIconId
  url: string
}

export type ProfileStore = {
  profiles: Profile[]
  activeProfileId: string | null
}

export type CreateProfileInput = {
  name: string
  color: string
  icon?: ProfileIconId
  url?: string
}

export type UpdateProfileInput = {
  id: string
  name?: string
  color?: string
  icon?: ProfileIconId
  url?: string
}

export type UnreadBadge = {
  count: number
  plus: boolean
}

export type UnreadMap = Record<string, UnreadBadge>
