import { useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import {
  PROFILE_COLORS,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
  type Profile,
  type ProfileIconId,
  type ProfileStore,
  type UnreadBadge,
  type UnreadMap
} from '../../shared/types'
import { ICON_CHOICES, ProfileIcon } from './ProfileIcon'

const emptyStore: ProfileStore = { profiles: [], activeProfileId: null, sidebarCollapsed: false }

export default function App(): JSX.Element {
  const [store, setStore] = useState<ProfileStore>(emptyStore)
  const [unread, setUnread] = useState<UnreadMap>({})
  const [detachedIds, setDetachedIds] = useState<string[]>([])
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState<string>(PROFILE_COLORS[0])
  const [draftIcon, setDraftIcon] = useState<ProfileIconId>('letter')

  useEffect(() => {
    void window.teamsLauncher.listProfiles().then((next) => {
      setStore(next)
      if (next.profiles.length === 0) {
        setFormMode('add')
      }
    })
    void window.teamsLauncher.listUnread().then(setUnread)
    void window.teamsLauncher.listDetached().then(setDetachedIds)
    const stopChanged = window.teamsLauncher.onChanged(setStore)
    const stopUnread = window.teamsLauncher.onUnread(setUnread)
    const stopDetached = window.teamsLauncher.onDetached(setDetachedIds)
    return () => {
      stopChanged()
      stopUnread()
      stopDetached()
    }
  }, [])

  useEffect(() => {
    return window.teamsLauncher.onStartEdit((id) => {
      const profile = store.profiles.find((item) => item.id === id)
      if (!profile) {
        return
      }
      openEdit(profile)
    })
  }, [store.profiles])

  const nextColor = useMemo(() => {
    return PROFILE_COLORS[store.profiles.length % PROFILE_COLORS.length]
  }, [store.profiles.length])

  function openAdd(): void {
    setFormMode('add')
    setEditingId(null)
    setDraftName('')
    setDraftColor(nextColor)
    setDraftIcon('letter')
    if (collapsed) {
      void window.teamsLauncher.setSidebarCollapsed(false)
    }
  }

  function openEdit(profile: Profile): void {
    setFormMode('edit')
    setEditingId(profile.id)
    setDraftName(profile.name)
    setDraftColor(profile.color)
    setDraftIcon(profile.icon)
    if (collapsed) {
      void window.teamsLauncher.setSidebarCollapsed(false)
    }
  }

  function closeForm(): void {
    setFormMode(store.profiles.length === 0 ? 'add' : 'hidden')
    setEditingId(null)
  }

  async function submitForm(): Promise<void> {
    const name = draftName.trim()
    if (!name) {
      return
    }

    if (formMode === 'edit' && editingId) {
      await window.teamsLauncher.updateProfile({
        id: editingId,
        name,
        color: draftColor,
        icon: draftIcon
      })
    } else {
      await window.teamsLauncher.createProfile({
        name,
        color: draftColor,
        icon: draftIcon
      })
    }
    setFormMode('hidden')
    setEditingId(null)
    setDraftName('')
  }

  const collapsed = store.sidebarCollapsed

  async function toggleSidebar(): Promise<void> {
    await window.teamsLauncher.setSidebarCollapsed(!collapsed)
  }

  return (
    <div className={collapsed ? 'shell collapsed' : 'shell'}>
      <aside
        className={collapsed ? 'sidebar collapsed' : 'sidebar'}
        style={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      >
        <header className="sidebar-header">
          {collapsed ? (
            <button
              type="button"
              className="sidebar-toggle"
              title="Show tenant sidebar (Ctrl+B)"
              aria-label="Show tenant sidebar"
              onClick={() => void toggleSidebar()}
            >
              ›
            </button>
          ) : (
            <>
              <div className="brand-mark">T</div>
              <div className="sidebar-title">
                <h1>Teams</h1>
                <p>Tenants</p>
              </div>
              <button
                type="button"
                className="sidebar-toggle"
                title="Hide tenant sidebar (Ctrl+B)"
                aria-label="Hide tenant sidebar"
                onClick={() => void toggleSidebar()}
              >
                ‹
              </button>
            </>
          )}
        </header>

        <nav className="profile-list" aria-label="Teams tenants">
          {store.profiles.map((profile, index) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              index={index}
              collapsed={collapsed}
              active={profile.id === store.activeProfileId && !detachedIds.includes(profile.id)}
              detached={detachedIds.includes(profile.id)}
              unread={unread[profile.id]}
              onSelect={() => void window.teamsLauncher.switchProfile(profile.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                window.teamsLauncher.openContextMenu(profile.id)
              }}
              onStartEdit={() => openEdit(profile)}
              onDetach={() => void window.teamsLauncher.detachProfile(profile.id)}
            />
          ))}

          {!collapsed && store.profiles.length === 0 && formMode !== 'add' ? (
            <p className="empty-hint">No profiles yet. Add one to sign in to Teams.</p>
          ) : null}
        </nav>

        {!collapsed ? (
          <>
        {formMode !== 'hidden' ? (
          <form
            className="profile-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submitForm()
            }}
          >
            <label htmlFor="profile-name">Profile name</label>
            <input
              id="profile-name"
              autoFocus
              value={draftName}
              placeholder="Work, Personal…"
              onChange={(event) => setDraftName(event.target.value)}
            />

            <label>Icon</label>
            <div className="icon-row" role="listbox" aria-label="Profile icon">
              {ICON_CHOICES.map((iconId) => (
                <button
                  key={iconId}
                  type="button"
                  className={iconId === draftIcon ? 'icon-choice selected' : 'icon-choice'}
                  style={{ background: iconId === draftIcon ? draftColor : '#2a2928' }}
                  title={iconId}
                  aria-label={iconId}
                  onClick={() => setDraftIcon(iconId)}
                >
                  <ProfileIcon id={iconId} letter={draftName.trim().charAt(0).toUpperCase() || 'T'} />
                </button>
              ))}
            </div>

            <label>Color</label>
            <div className="color-row" role="listbox" aria-label="Profile color">
              {PROFILE_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={color.toLowerCase() === draftColor.toLowerCase() ? 'color-dot selected' : 'color-dot'}
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => setDraftColor(color)}
                />
              ))}
              <label className="custom-color" title="Custom color">
                <input
                  type="color"
                  value={isHexColor(draftColor) ? draftColor : '#6264A7'}
                  onChange={(event) => setDraftColor(event.target.value)}
                />
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="primary" disabled={!draftName.trim()}>
                {formMode === 'edit' ? 'Save' : 'Add profile'}
              </button>
              {store.profiles.length > 0 ? (
                <button type="button" className="ghost" onClick={closeForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <button className="add-button" type="button" onClick={openAdd}>
            + Add profile
          </button>
        )}

        <footer className="sidebar-footer">
          <span>Ctrl+1–9 switch</span>
          <span>Ctrl+Shift+D detach</span>
        </footer>
          </>
        ) : (
          <button
            type="button"
            className="add-button collapsed-add"
            title="Add profile"
            aria-label="Add profile"
            onClick={openAdd}
          >
            +
          </button>
        )}
      </aside>

      <main className="stage">
        {store.profiles.length === 0 ? (
          <section className="welcome">
            <h2>One app, multiple Teams accounts</h2>
            <p>
              Create a named profile for each account. Each profile keeps its own login, cookies, and
              Teams data — no extra PWAs on your system.
            </p>
          </section>
        ) : (
          <div className="stage-fill" />
        )}
      </main>
    </div>
  )
}

function ProfileRow({
  profile,
  index,
  collapsed,
  active,
  detached,
  unread,
  onSelect,
  onContextMenu,
  onStartEdit,
  onDetach
}: {
  profile: Profile
  index: number
  collapsed: boolean
  active: boolean
  detached: boolean
  unread?: UnreadBadge
  onSelect: () => void
  onContextMenu: (event: MouseEvent) => void
  onStartEdit: () => void
  onDetach: () => void
}): JSX.Element {
  const letter = profile.name.trim().charAt(0).toUpperCase() || 'T'
  const badgeLabel = formatUnread(unread)
  const shortcut = detached ? 'Detached' : index < 9 ? `Ctrl+${index + 1}` : ''
  const rowClass = [
    'profile-row',
    collapsed ? 'collapsed' : '',
    active ? 'active' : '',
    detached ? 'detached' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      role="button"
      tabIndex={0}
      className={rowClass}
      title={collapsed ? `${profile.name}${shortcut ? ` (${shortcut})` : ''}` : undefined}
      aria-label={profile.name}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onDoubleClick={(event) => {
        event.preventDefault()
        onStartEdit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="avatar-wrap">
        <span className="avatar" style={{ background: profile.color }}>
          <ProfileIcon id={profile.icon} letter={letter} />
        </span>
        {badgeLabel ? <span className="unread-badge">{badgeLabel}</span> : null}
      </span>
      {!collapsed ? (
        <>
          <span className="profile-meta">
            <span className="profile-name">{profile.name}</span>
            <span className="profile-shortcut">{shortcut || null}</span>
          </span>
          {!detached ? (
            <button
              type="button"
              className="detach-button"
              title="Detach window"
              aria-label={`Detach ${profile.name}`}
              onClick={(event) => {
                event.stopPropagation()
                onDetach()
              }}
            >
              ↗
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function formatUnread(unread?: UnreadBadge): string | null {
  if (!unread || unread.count <= 0) {
    return null
  }
  if (unread.plus || unread.count > 99) {
    return unread.count > 99 ? '99+' : `${unread.count}+`
  }
  return String(unread.count)
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}
