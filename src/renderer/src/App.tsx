import { useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import {
  PROFILE_COLORS,
  SIDEBAR_WIDTH,
  type Profile,
  type ProfileIconId,
  type ProfileStore,
  type UnreadBadge,
  type UnreadMap
} from '../../shared/types'
import { ICON_CHOICES, ProfileIcon } from './ProfileIcon'

const emptyStore: ProfileStore = { profiles: [], activeProfileId: null }

export default function App(): JSX.Element {
  const [store, setStore] = useState<ProfileStore>(emptyStore)
  const [unread, setUnread] = useState<UnreadMap>({})
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
    const stopChanged = window.teamsLauncher.onChanged(setStore)
    const stopUnread = window.teamsLauncher.onUnread(setUnread)
    return () => {
      stopChanged()
      stopUnread()
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
  }

  function openEdit(profile: Profile): void {
    setFormMode('edit')
    setEditingId(profile.id)
    setDraftName(profile.name)
    setDraftColor(profile.color)
    setDraftIcon(profile.icon)
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

  return (
    <div className="shell">
      <aside className="sidebar" style={{ width: SIDEBAR_WIDTH }}>
        <header className="sidebar-header">
          <div className="brand-mark">T</div>
          <div>
            <h1>Teams</h1>
            <p>Profiles</p>
          </div>
        </header>

        <nav className="profile-list" aria-label="Teams profiles">
          {store.profiles.map((profile, index) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              index={index}
              active={profile.id === store.activeProfileId}
              unread={unread[profile.id]}
              onSelect={() => void window.teamsLauncher.switchProfile(profile.id)}
              onContextMenu={(event) => {
                event.preventDefault()
                window.teamsLauncher.openContextMenu(profile.id)
              }}
              onStartEdit={() => openEdit(profile)}
            />
          ))}

          {store.profiles.length === 0 && formMode !== 'add' ? (
            <p className="empty-hint">No profiles yet. Add one to sign in to Teams.</p>
          ) : null}
        </nav>

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
          <span>Ctrl+R reload</span>
        </footer>
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
  active,
  unread,
  onSelect,
  onContextMenu,
  onStartEdit
}: {
  profile: Profile
  index: number
  active: boolean
  unread?: UnreadBadge
  onSelect: () => void
  onContextMenu: (event: MouseEvent) => void
  onStartEdit: () => void
}): JSX.Element {
  const letter = profile.name.trim().charAt(0).toUpperCase() || 'T'
  const badgeLabel = formatUnread(unread)

  return (
    <div
      role="button"
      tabIndex={0}
      className={active ? 'profile-row active' : 'profile-row'}
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
      <span className="profile-meta">
        <span className="profile-name">{profile.name}</span>
        {index < 9 ? <span className="profile-shortcut">Ctrl+{index + 1}</span> : null}
      </span>
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
