import type { Profile, UnreadMap } from './types'

export type ShortcutActionId =
  | 'tenant.next'
  | 'tenant.prev'
  | 'sidebar.toggle'
  | 'tenant.reload'
  | 'tenant.detach'
  | 'tenant.reattach'
  | 'compose.focus'
  | 'pane.chat'
  | 'pane.teams'
  | 'pane.activity'
  | 'pane.calendar'
  | 'teams.search'
  | 'devtools.teams'
  | 'devtools.shell'
  | `tenant.switch.${string}`
  | `chat.open.${string}`

export type ShortcutActionDef = {
  id: ShortcutActionId
  label: string
  keywords: string[]
  /** Optional global accelerator hint (Ctrl+…). */
  accelerator?: string
  group: 'tenant' | 'navigation' | 'teams' | 'chat' | 'debug'
}

export type RecentChatItem = {
  index: number
  title: string
  kind: 'chat' | 'channel' | 'unknown'
}

export type PaletteItem = ShortcutActionDef & {
  hint?: string
}

const STATIC_ACTIONS: ShortcutActionDef[] = [
  {
    id: 'pane.chat',
    label: 'Open Chat',
    keywords: ['chat', 'chats', 'messages', 'dm', 'conversations'],
    group: 'chat'
  },
  {
    id: 'pane.teams',
    label: 'Open Teams',
    keywords: ['teams', 'channels', 'groups', 'team'],
    group: 'chat'
  },
  {
    id: 'pane.activity',
    label: 'Open Notifications',
    keywords: ['activity', 'feed', 'notifications', 'notification', 'alerts'],
    group: 'chat'
  },
  {
    id: 'pane.calendar',
    label: 'Open Calendar',
    keywords: ['calendar', 'meetings', 'schedule', 'agenda'],
    group: 'chat'
  },
  {
    id: 'compose.focus',
    label: 'Focus message box',
    keywords: ['compose', 'message', 'write', 'type', 'input'],
    group: 'teams'
  },
  {
    id: 'teams.search',
    label: 'Focus Teams search',
    keywords: ['search', 'find', 'lookup'],
    group: 'chat'
  },
  {
    id: 'tenant.next',
    label: 'Next tenant',
    keywords: ['tenant', 'profile', 'switch', 'next'],
    accelerator: 'Ctrl+↓',
    group: 'tenant'
  },
  {
    id: 'tenant.prev',
    label: 'Previous tenant',
    keywords: ['tenant', 'profile', 'switch', 'previous', 'prev'],
    accelerator: 'Ctrl+↑',
    group: 'tenant'
  },
  {
    id: 'sidebar.toggle',
    label: 'Toggle sidebar',
    keywords: ['sidebar', 'panel', 'tenants'],
    accelerator: 'Ctrl+B',
    group: 'navigation'
  },
  {
    id: 'tenant.reload',
    label: 'Reload current tenant',
    keywords: ['reload', 'refresh'],
    accelerator: 'Ctrl+R',
    group: 'navigation'
  },
  {
    id: 'tenant.detach',
    label: 'Detach active tenant',
    keywords: ['detach', 'popout', 'window', 'call'],
    accelerator: 'Ctrl+Shift+D',
    group: 'navigation'
  },
  {
    id: 'tenant.reattach',
    label: 'Return active tenant to main window',
    keywords: ['reattach', 'return', 'dock', 'attach'],
    accelerator: 'Ctrl+Shift+A',
    group: 'navigation'
  },
  {
    id: 'devtools.teams',
    label: 'Toggle Teams DevTools',
    keywords: ['devtools', 'inspect', 'debug'],
    accelerator: 'Ctrl+Shift+I',
    group: 'debug'
  },
  {
    id: 'devtools.shell',
    label: 'Toggle sidebar DevTools',
    keywords: ['devtools', 'inspect', 'debug', 'shell'],
    accelerator: 'F12',
    group: 'debug'
  }
]

export function listStaticShortcutActions(): ShortcutActionDef[] {
  return STATIC_ACTIONS
}

export function tenantSwitchActionId(profileId: string): ShortcutActionId {
  return `tenant.switch.${profileId}`
}

export function chatOpenActionId(index: number): ShortcutActionId {
  return `chat.open.${index}`
}

export function parseTenantSwitchId(actionId: string): string | null {
  const prefix = 'tenant.switch.'
  if (!actionId.startsWith(prefix)) {
    return null
  }
  const id = actionId.slice(prefix.length)
  return id || null
}

export function parseChatOpenIndex(actionId: string): number | null {
  const prefix = 'chat.open.'
  if (!actionId.startsWith(prefix)) {
    return null
  }
  const n = Number(actionId.slice(prefix.length))
  return Number.isInteger(n) && n >= 0 ? n : null
}

export function buildPaletteItems(
  profiles: Profile[],
  unread: UnreadMap,
  options?: {
    modKey?: string
    detachedIds?: string[]
    activeProfileId?: string | null
    recentChats?: RecentChatItem[]
  }
): PaletteItem[] {
  const mod = options?.modKey ?? 'Ctrl'
  const detached = new Set(options?.detachedIds ?? [])
  const activeId = options?.activeProfileId ?? null
  const recentChats = options?.recentChats ?? []

  const conversationItems: PaletteItem[] = recentChats.map((chat) => {
    const kindLabel =
      chat.kind === 'channel' ? 'Channel' : chat.kind === 'chat' ? 'Chat' : 'Conversation'
    return {
      id: chatOpenActionId(chat.index),
      label: chat.title,
      keywords: [
        'chat',
        'channel',
        'team',
        'conversation',
        'open',
        kindLabel.toLowerCase(),
        chat.title.toLowerCase(),
        ...chat.title.toLowerCase().split(/[\s/|·\-]+/).filter(Boolean)
      ],
      group: 'chat' as const,
      hint: kindLabel
    }
  })

  const tenantItems: PaletteItem[] = profiles.map((profile, index) => {
    const badge = unread[profile.id]
    const unreadHint =
      badge && badge.count > 0 ? `${badge.count}${badge.plus ? '+' : ''} unread` : undefined
    const bits = [
      profile.id === activeId ? 'active' : null,
      detached.has(profile.id) ? 'detached' : null,
      unreadHint
    ].filter(Boolean)
    return {
      id: tenantSwitchActionId(profile.id),
      label: `Tenant: ${profile.name}`,
      keywords: ['tenant', 'profile', 'switch', 'account', profile.name.toLowerCase()],
      accelerator: index < 9 ? `${mod}+${index + 1}` : undefined,
      group: 'tenant' as const,
      hint: bits.length ? bits.join(' · ') : undefined
    }
  })

  const staticItems: PaletteItem[] = STATIC_ACTIONS.map((action) => ({
    ...action,
    accelerator: action.accelerator?.split('Ctrl').join(mod)
  }))

  // Conversations first so search naturally surfaces chats/channels.
  return [...conversationItems, ...staticItems.filter((a) => a.group === 'chat'), ...tenantItems, ...staticItems.filter((a) => a.group !== 'chat')]
}

/** Word-aware fuzzy match; higher is better, -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) {
    return 0
  }
  const t = text.toLowerCase()
  if (t === q) {
    return 5000
  }
  if (t.startsWith(q)) {
    return 4000 - t.length
  }
  const words = t.split(/[\s/|·,\-_]+/).filter(Boolean)
  if (words.some((w) => w.startsWith(q))) {
    return 3000
  }
  if (t.includes(q)) {
    return 2000 - t.indexOf(q)
  }
  // subsequence
  let ti = 0
  let score = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    const found = t.indexOf(ch, ti)
    if (found < 0) {
      return -1
    }
    score += 10 - Math.min(9, found - ti)
    ti = found + 1
  }
  return score
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim()
  if (!q) {
    return items
  }
  return items
    .map((item) => {
      const fields = [item.label, item.hint ?? '', ...item.keywords]
      let best = -1
      for (const field of fields) {
        best = Math.max(best, fuzzyScore(q, field))
      }
      // Prefer conversation rows slightly when scores tie-ish.
      if (item.id.startsWith('chat.open.') && best >= 0) {
        best += 50
      }
      return { item, score: best }
    })
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item)
}
