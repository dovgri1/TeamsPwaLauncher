import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
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
const isMac = window.teamsLauncher.platform === 'darwin'
const modKey = isMac ? '⌘' : 'Ctrl'

export default function App(): JSX.Element {
  const [store, setStore] = useState<ProfileStore>(emptyStore)
  const [unread, setUnread] = useState<UnreadMap>({})
  const [detachedIds, setDetachedIds] = useState<string[]>([])
  const [formMode, setFormMode] = useState<'hidden' | 'add' | 'edit'>('hidden')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState<string>(PROFILE_COLORS[0])
  const [draftIcon, setDraftIcon] = useState<ProfileIconId>('letter')
  const stageRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) {
      return
    }

    const report = (): void => {
      const rect = stage.getBoundingClientRect()
      window.teamsLauncher.setStageBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
    }

    const observer = new ResizeObserver(report)
    observer.observe(stage)
    window.addEventListener('resize', report)
    report()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', report)
    }
  }, [store.profiles.length, store.sidebarCollapsed])

  useEffect(() => {
    window.teamsLauncher.setFormOpen(formMode !== 'hidden')
  }, [formMode])

  useEffect(() => {
    if (formMode === 'hidden') {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeForm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formMode, store.profiles.length])

  const nextColor = useMemo(() => {
    return PROFILE_COLORS[store.profiles.length % PROFILE_COLORS.length]
  }, [store.profiles.length])

  function openAdd(): void {
    setFormMode('add')
    setEditingId(null)
    setDraftName('')
    setDraftColor(nextColor)
    setDraftIcon('letter')
  }

  function openEdit(profile: Profile): void {
    setFormMode('edit')
    setEditingId(profile.id)
    setDraftName(profile.name)
    setDraftColor(profile.color)
    setDraftIcon(profile.icon)
  }

  function closeForm(): void {
    if (store.profiles.length === 0) {
      setFormMode('add')
      return
    }
    setFormMode('hidden')
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
              title={`Show tenant sidebar (${modKey}${isMac ? 'B' : '+B'})`}
              aria-label="Show tenant sidebar"
              onClick={() => void toggleSidebar()}
            >
              <ChevronIcon direction="right" />
            </button>
          ) : (
            <>
              <div className="brand">
                <div className="brand-mark" aria-hidden>
                  <BrandMark />
                </div>
                <div className="sidebar-title">
                  <p className="eyebrow">Launcher</p>
                  <h1>Accounts</h1>
                </div>
              </div>
              <button
                type="button"
                className="sidebar-toggle"
                title={`Hide tenant sidebar (${modKey}${isMac ? 'B' : '+B'})`}
                aria-label="Hide tenant sidebar"
                onClick={() => void toggleSidebar()}
              >
                <ChevronIcon direction="left" />
              </button>
            </>
          )}
        </header>

        {!collapsed ? <p className="section-label">Profiles</p> : null}

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

          {!collapsed && store.profiles.length === 0 ? (
            <p className="empty-hint">No profiles yet. Add one to sign in to Teams.</p>
          ) : null}
        </nav>

        {!collapsed ? (
          <>
            <div className="sidebar-actions">
              <button className="add-button" type="button" onClick={openAdd}>
                <PlusIcon />
                Add profile
              </button>
            </div>
            <footer className="sidebar-footer">
              <span>
                <kbd>{modKey}</kbd> 1–9
              </span>
              <span>
                <kbd>{isMac ? '⌘⇧D' : 'Ctrl+Shift+D'}</kbd>
              </span>
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
            <PlusIcon />
          </button>
        )}
      </aside>

      <main className="stage" ref={stageRef}>
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

      {formMode !== 'hidden' ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeForm()
            }
          }}
        >
          <form
            className="profile-form modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-dialog-title"
            onSubmit={(event) => {
              event.preventDefault()
              void submitForm()
            }}
          >
            <div className="form-heading">
              <p id="profile-dialog-title">{formMode === 'edit' ? 'Edit profile' : 'New profile'}</p>
              {store.profiles.length > 0 ? (
                <button type="button" className="ghost compact" onClick={closeForm}>
                  Cancel
                </button>
              ) : null}
            </div>
            <label htmlFor="profile-name">Name</label>
            <input
              id="profile-name"
              type="text"
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
        </div>
      ) : null}
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
  const shortcut = detached ? 'Detached' : index < 9 ? `${modKey}${isMac ? '' : '+'}${index + 1}` : ''
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
              <DetachIcon />
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

function BrandMark(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h4.2v4.2H2.5V3.5zm0 5.3h4.2v4.7H2.5V8.8zm5.3-5.3H13.5V8H7.8V3.5zm0 5.3H13.5v4.7H7.8V8.8z"
        fill="currentColor"
      />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={direction === 'left' ? 'M10 3.5 5.5 8 10 12.5' : 'M6 3.5 10.5 8 6 12.5'}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function DetachIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M6.5 3.5H3.5v9h9V9.5M8.5 3.5h4v4M12.5 3.5 7 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
