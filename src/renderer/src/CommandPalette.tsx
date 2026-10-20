import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import {
  buildPaletteItems,
  filterPaletteItems,
  type PaletteItem,
  type RecentChatItem
} from '../../shared/shortcutActions'
import type { Profile, UnreadMap } from '../../shared/types'

type CommandPaletteProps = {
  open: boolean
  profiles: Profile[]
  unread: UnreadMap
  detachedIds: string[]
  activeProfileId: string | null
  recentChats?: RecentChatItem[]
  modKey: string
  onClose: () => void
  onRun: (actionId: string) => void
}

export function CommandPalette({
  open,
  profiles,
  unread,
  detachedIds,
  activeProfileId,
  recentChats = [],
  modKey,
  onClose,
  onRun
}: CommandPaletteProps): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(
    () =>
      buildPaletteItems(profiles, unread, {
        modKey,
        detachedIds,
        activeProfileId,
        recentChats
      }),
    [profiles, unread, detachedIds, activeProfileId, recentChats, modKey]
  )

  const filtered = useMemo(() => filterPaletteItems(items, query), [items, query])

  useEffect(() => {
    if (!open) {
      return
    }
    setQuery('')
    setSelected(0)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  useEffect(() => {
    setSelected(0)
  }, [query])

  useEffect(() => {
    if (!open) {
      return
    }
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [selected, open, filtered.length])

  if (!open) {
    return null
  }

  function runIndex(index: number): void {
    const item = filtered[index]
    if (!item) {
      return
    }
    onRun(item.id)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key.toLowerCase() === 'n')) {
      event.preventDefault()
      setSelected((prev) => (filtered.length === 0 ? 0 : (prev + 1) % filtered.length))
      return
    }
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key.toLowerCase() === 'p')) {
      event.preventDefault()
      setSelected((prev) =>
        filtered.length === 0 ? 0 : (prev - 1 + filtered.length) % filtered.length
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runIndex(selected)
    }
  }

  const conversationCount = recentChats.length

  return (
    <div
      className="modal-backdrop command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-header">
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            placeholder="Search chats, teams, calendar…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
          />
          <kbd className="command-palette-kbd">esc</kbd>
        </div>
        <div
          id="command-palette-list"
          className="command-palette-list"
          role="listbox"
          ref={listRef}
        >
          {filtered.length === 0 ? (
            <div className="command-palette-empty">
              {conversationCount === 0
                ? 'No matches. Open Chat or Teams in the app first so conversations can be listed.'
                : 'No matching chats or commands'}
            </div>
          ) : (
            filtered.map((item, index) => (
              <PaletteRow
                key={item.id}
                item={item}
                index={index}
                active={index === selected}
                onHover={() => setSelected(index)}
                onRun={() => onRun(item.id)}
              />
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> select
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>t</kbd> or <kbd>{modKey}+K</kbd> open palette
          </span>
          {conversationCount > 0 ? <span>{conversationCount} conversations</span> : null}
        </div>
      </div>
    </div>
  )
}

function PaletteRow({
  item,
  index,
  active,
  onHover,
  onRun
}: {
  item: PaletteItem
  index: number
  active: boolean
  onHover: () => void
  onRun: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={active ? 'command-palette-item active' : 'command-palette-item'}
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseEnter={onHover}
      onClick={onRun}
    >
      <span className="command-palette-item-main">
        <span className="command-palette-item-label">{item.label}</span>
        {item.hint ? <span className="command-palette-item-hint">{item.hint}</span> : null}
      </span>
      {item.accelerator ? <kbd className="command-palette-accel">{item.accelerator}</kbd> : null}
    </button>
  )
}
