import {
  BrowserWindow,
  Menu,
  WebContentsView,
  app,
  session,
  shell,
  type HandlerDetails,
  type Session,
  type WebContents,
  type CookiesSetDetails
} from 'electron'
import icon from '../../resources/icon.png?asset'
import { pickDisplaySource } from './screenPicker'
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH,
  type LoadStage,
  type LoadStageMap,
  type Profile,
  type UnreadBadge,
  type UnreadMap
} from '../shared/types'
import {
  isAllowedTeamsUrl,
  isEmbeddedWebContentUrl,
  isMicrosoftLoginHost,
  isSafeExternalUrl,
  isTeamsAppHost,
  isTeamsDiagnosticsUrl,
  sanitizeProfileUrl
} from '../shared/teamsUrls'
import { log, sanitizeUrlish } from './logger'

const views = new Map<string, WebContentsView>()
const popouts = new Map<string, BrowserWindow>()
const configuredSessions = new Set<string>()
const titleUnread = new Map<string, UnreadBadge>()
const badgeUnread = new Map<string, number>()
const loadStages = new Map<string, LoadStage>()

let mainWindow: BrowserWindow | null = null
let activeProfileId: string | null = null
let onSwitchIndex: ((index: number) => void) | null = null
let onUnreadChange: ((unread: UnreadMap) => void) | null = null
let onLoadStageChange: ((stages: LoadStageMap) => void) | null = null
let onToggleSidebar: (() => void) | null = null
let onDetachedChange: ((ids: string[]) => void) | null = null
let onActiveCleared: (() => void) | null = null
let onOpenPalette: (() => void) | null = null
let onClosePalette: (() => void) | null = null
let onRunShortcutAction: ((actionId: string) => void) | null = null
let paletteOpen = false
let formOverlayOpen = false
let unreadPoll: ReturnType<typeof setInterval> | null = null
let sidebarOffset = SIDEBAR_WIDTH
let stageBounds: { x: number; y: number; width: number; height: number } | null = null
const guestResizeTimers = new WeakMap<WebContents, ReturnType<typeof setTimeout>>()
const composingByContents = new WeakMap<WebContents, boolean>()

const BADGE_SCRIPT = `(() => {
  if (window.__teamsLauncherBadgeHook) return;
  window.__teamsLauncherBadgeHook = true;
  const emit = (n) => console.log('__TEAMS_BADGE__:' + String(n));
  const parse = (title) => {
    const match = String(title).match(/\\((\\d+)\\+?\\)/);
    return match ? Number(match[1]) : 0;
  };
  if (navigator.setAppBadge) {
    const original = navigator.setAppBadge.bind(navigator);
    navigator.setAppBadge = (n) => {
      emit(typeof n === 'number' ? n : parse(document.title) || 1);
      return original(n);
    };
  }
  if (navigator.clearAppBadge) {
    const original = navigator.clearAppBadge.bind(navigator);
    navigator.clearAppBadge = () => {
      emit(0);
      return original();
    };
  }
  const titleEl = document.querySelector('title');
  if (titleEl) {
    new MutationObserver(() => emit(parse(document.title))).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
  emit(parse(document.title));
})();`

const VISIBILITY_SCRIPT = `(() => {
  if (window.__teamsLauncherForceVisible) return;
  window.__teamsLauncherForceVisible = true;
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch {}
})();`

const TEAMS_HELPER_SCRIPT = `(() => {
  if (window.__teamsLauncherComposeHook) return;
  window.__teamsLauncherComposeHook = true;

  const emit = (on) => console.log('__TEAMS_COMPOSE__:' + (on ? '1' : '0'));

  const clickEl = (el) => {
    if (!el) return false;
    try {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
      el.click();
      return true;
    } catch {
      try { el.click(); return true; } catch { return false; }
    }
  };

  const looksLikeSearch = (el) => {
    if (!el) return false;
    const aria = ((el.getAttribute && el.getAttribute('aria-label')) || el.placeholder || '').toLowerCase();
    if (/search|filter|find|lookup/.test(aria)) return true;
    let node = el;
    for (let i = 0; i < 6 && node; i++) {
      const label = ((node.getAttribute && node.getAttribute('aria-label')) || node.getAttribute?.('data-tid') || '').toLowerCase();
      if (/search|filter|command.?bar/.test(label)) return true;
      node = node.parentElement;
    }
    return false;
  };

  const looksLikeCompose = (el) => {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = (el.tagName || '').toLowerCase();
    const editable =
      el.isContentEditable ||
      el.getAttribute?.('contenteditable') === 'true' ||
      el.getAttribute?.('role') === 'textbox' ||
      tag === 'textarea' ||
      (tag === 'input' && !/button|checkbox|radio|submit|file|hidden|range|color/.test(el.type || ''));
    if (!editable) return false;
    if (looksLikeSearch(el)) return false;
    const aria = ((el.getAttribute && el.getAttribute('aria-label')) || el.placeholder || '').toLowerCase();
    if (/type a message|write a message|new message|compose|send a message|chat message|message/.test(aria)) {
      return true;
    }
    let node = el;
    for (let i = 0; i < 8 && node; i++) {
      const tid = (node.getAttribute?.('data-tid') || node.id || node.className || '').toString().toLowerCase();
      if (/compose|ck-editor|editor-input|message-input|chat-input|new-message/.test(tid)) return true;
      node = node.parentElement;
    }
    return true;
  };

  const findCompose = () => {
    const selectors = [
      '[data-tid="ckeditor-text-input"]',
      '[data-tid="message-compose"]',
      '[aria-label*="Type a message" i]',
      '[aria-label*="Write a message" i]',
      '[aria-placeholder*="Type a message" i]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label]'
    ];
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const node of nodes) {
          if (looksLikeCompose(node)) return node;
        }
      } catch {}
    }
    return null;
  };

  const ariaMatch = (el, needles) => {
    const label = (
      (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
      el.textContent ||
      ''
    ).trim().toLowerCase();
    return needles.some((n) => label === n || label.startsWith(n + ' ') || label.includes(n));
  };

  const findRailButton = (needles) => {
    const candidates = document.querySelectorAll(
      'button[aria-label], a[aria-label], [role="button"][aria-label], [role="tab"][aria-label], [data-tid][aria-label]'
    );
    for (const el of candidates) {
      if (ariaMatch(el, needles)) return el;
    }
    return null;
  };

  window.__teamsLauncherIsComposing = () => looksLikeCompose(document.activeElement);
  window.__teamsLauncherFocusCompose = () => {
    const el = findCompose();
    if (!el) return false;
    try {
      el.focus({ preventScroll: false });
      el.click?.();
    } catch {
      try { el.focus(); } catch {}
    }
    emit(looksLikeCompose(document.activeElement));
    return looksLikeCompose(document.activeElement);
  };

  window.__teamsLauncherOpenPane = (pane) => {
    const map = {
      chat: ['chat', 'chats'],
      teams: ['teams', 'teams and channels'],
      activity: ['activity', 'notifications', 'notification'],
      calendar: ['calendar']
    };
    const needles = map[pane] || [String(pane || '').toLowerCase()];
    const el = findRailButton(needles);
    return clickEl(el);
  };

  window.__teamsLauncherFocusSearch = () => {
    const selectors = [
      '#ms-searchux-search-box',
      'input[aria-label*="Search" i]',
      'input[placeholder*="Search" i]',
      '[data-tid="search-input-field"]',
      '[role="search"] input',
      'button[aria-label*="Search" i]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        clickEl(el);
        if (el.focus) {
          try { el.focus(); } catch {}
        }
        return true;
      } catch {}
    }
    const rail = findRailButton(['search']);
    return clickEl(rail);
  };

  const railNoise =
    /^(chat|chats|teams|activity|notifications?|calendar|calls|files|apps|search|home|more|settings|help|new chat|meet|copilot)$/i;

  const rowTitle = (node) => {
    const labelled = node.getAttribute?.('aria-label');
    if (labelled && labelled.trim()) return labelled.replace(/\\s+/g, ' ').trim();
    const titleNode =
      node.querySelector?.('[data-tid*="title"]') ||
      node.querySelector?.('[data-tid*="name"]') ||
      node.querySelector?.('span[title]') ||
      node.querySelector?.('[title]');
    const fromChild = titleNode?.getAttribute?.('title') || titleNode?.textContent || '';
    if (fromChild.trim()) return fromChild.replace(/\\s+/g, ' ').trim();
    // Prefer first non-empty text line, not the entire subtree dump.
    const text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
    return text.split(/\\n/)[0]?.trim() || text;
  };

  const collectChatRows = () => {
    const selectors = [
      '[data-tid="chat-list-item"]',
      '[data-tid="chat-space-item"]',
      '[data-tid*="chat-list"] [role="treeitem"]',
      '[data-tid*="chat-list"] [role="option"]',
      '[data-tid*="chat-list"] [role="listitem"]',
      '[data-tid*="channel-list"] [role="treeitem"]',
      '[data-tid*="team-channel"]',
      '[data-tid*="channel-item"]',
      '[role="treeitem"]',
      '[role="option"]',
      '[role="listitem"]'
    ];
    const seen = new Set();
    const rows = [];
    for (const sel of selectors) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch { continue; }
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Prefer visible rows, but still accept attached nodes (parked views).
        if (node.getClientRects && node.getClientRects().length === 0 && !node.offsetParent) continue;
        let title = rowTitle(node);
        if (!title || title.length < 2 || title.length > 140) continue;
        // Strip trailing unread counts like "Alice 3" / "(3)".
        title = title.replace(/\\s+\\(?\\d+\\+?\\)?\\s*$/, '').trim();
        if (!title || railNoise.test(title)) continue;
        const key = title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const meta = (
          (node.getAttribute('data-tid') || '') +
          ' ' +
          (node.className || '')
        ).toLowerCase();
        const kind =
          /channel|team/.test(meta) || /\\s[|/]\\s/.test(title) || title.includes('/')
            ? 'channel'
            : 'chat';
        rows.push({ el: node, title, kind });
        if (rows.length >= 40) return rows;
      }
    }
    return rows;
  };

  window.__teamsLauncherListChats = () => {
    const rows = collectChatRows();
    window.__teamsLauncherLastChatTitles = rows.map((row) => row.title);
    return rows.map((row, index) => ({ index, title: row.title, kind: row.kind }));
  };

  window.__teamsLauncherOpenChatByTitle = (title) => {
    const want = String(title || '').trim().toLowerCase();
    if (!want) return false;
    const rows = collectChatRows();
    const exact = rows.find((row) => row.title.toLowerCase() === want);
    if (exact) return clickEl(exact.el);
    const partial = rows.find(
      (row) => row.title.toLowerCase().includes(want) || want.includes(row.title.toLowerCase())
    );
    return partial ? clickEl(partial.el) : false;
  };

  window.__teamsLauncherOpenChatAt = (index) => {
    const titles = window.__teamsLauncherLastChatTitles || [];
    const title = titles[Number(index)];
    if (title) return window.__teamsLauncherOpenChatByTitle(title);
    const rows = collectChatRows();
    const row = rows[Number(index)];
    return row ? clickEl(row.el) : false;
  };

  const sync = () => emit(window.__teamsLauncherIsComposing());
  document.addEventListener('focusin', sync, true);
  document.addEventListener('focusout', sync, true);
  sync();
})();`

export function setSwitchIndexHandler(handler: (index: number) => void): void {
  onSwitchIndex = handler
}

export function setUnreadHandler(handler: (unread: UnreadMap) => void): void {
  onUnreadChange = handler
}

export function setLoadStageHandler(handler: (stages: LoadStageMap) => void): void {
  onLoadStageChange = handler
}

export function getLoadStageMap(): LoadStageMap {
  return Object.fromEntries(loadStages)
}

export function setToggleSidebarHandler(handler: () => void): void {
  onToggleSidebar = handler
}

export function setDetachedChangeHandler(handler: (ids: string[]) => void): void {
  onDetachedChange = handler
}

export function setActiveClearedHandler(handler: () => void): void {
  onActiveCleared = handler
}

export function setOpenPaletteHandler(handler: () => void): void {
  onOpenPalette = handler
}

export function setClosePaletteHandler(handler: () => void): void {
  onClosePalette = handler
}

export function setRunShortcutActionHandler(handler: (actionId: string) => void): void {
  onRunShortcutAction = handler
}

export function setPaletteOpen(open: boolean): void {
  paletteOpen = open
}

export function isPaletteOpen(): boolean {
  return paletteOpen
}

/** Profile add/edit modal (or any shell overlay that uses ui:formOpen). */
export function setFormOverlayOpen(open: boolean): void {
  formOverlayOpen = open
}

export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarOffset = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH
  syncActiveBounds()
}

export function setStageBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  const next = roundBounds(bounds)
  if (!next) {
    return
  }
  if (
    stageBounds &&
    stageBounds.x === next.x &&
    stageBounds.y === next.y &&
    stageBounds.width === next.width &&
    stageBounds.height === next.height
  ) {
    return
  }
  stageBounds = next
  syncActiveBounds()
}

export function getUnreadMap(): UnreadMap {
  return publishUnread(false)
}

export function getDetachedIds(): string[] {
  return [...popouts.keys()]
}

export function isDetached(id: string): boolean {
  return popouts.has(id)
}

export function initTeamsViews(win: BrowserWindow): void {
  mainWindow = win
  const schedule = (): void => {
    syncActiveBounds()
    setImmediate(syncActiveBounds)
  }
  win.on('resize', schedule)
  win.on('resized', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('enter-html-full-screen', schedule)
  win.on('leave-html-full-screen', schedule)

  if (!unreadPoll) {
    unreadPoll = setInterval(() => {
      for (const [id, view] of views) {
        if (!view.webContents.isDestroyed()) {
          applyTitleUnread(id, view.webContents.getTitle())
        }
      }
    }, 2500)
  }
}

const LOAD_READY_IDLE_MS = 3_000
const PRELOAD_STAGGER_MS = 2_500
const RECOVERY_DELAY_MS = 2_000
const MAX_AUTO_RECOVERIES = 2
const RECOVERABLE_FAIL_CODES = new Set([-21]) // ERR_NETWORK_CHANGED
const loadInFlight = new WeakSet<WebContents>()
const loadStartedAt = new Map<string, number>()
const profileById = new Map<string, Profile>()
const recoveryAttempts = new Map<string, number>()
const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
let preloadGeneration = 0

function trackProfile(profile: Profile): void {
  profileById.set(profile.id, profile)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function elapsedMs(profileId: string): number | undefined {
  const started = loadStartedAt.get(profileId)
  return started == null ? undefined : Date.now() - started
}

function markLoadStarted(profileId: string, reason: string): void {
  if (!loadStartedAt.has(profileId)) {
    loadStartedAt.set(profileId, Date.now())
  }
  log('info', 'load', 'load-started', { profileId, reason })
}

export function ensureView(profile: Profile): WebContentsView | null {
  if (!mainWindow) {
    return null
  }

  trackProfile(profile)

  if (popouts.has(profile.id)) {
    return views.get(profile.id) ?? null
  }

  let view = views.get(profile.id)
  if (!view) {
    log('info', 'view', 'create-view', { profileId: profile.id, name: profile.name })
    view = createView(profile)
    views.set(profile.id, view)
    mainWindow.contentView.addChildView(view)
  } else if (!isViewInMain(view)) {
    mainWindow.contentView.addChildView(view)
  }

  if (profile.id === activeProfileId) {
    presentView(view, true)
  } else {
    parkView(view)
    raiseActiveView()
  }

  return view
}

export function preloadProfiles(profiles: Profile[], activeId: string | null): void {
  const generation = ++preloadGeneration
  const active = profiles.find((profile) => profile.id === activeId) ?? null
  const remaining = profiles.filter(
    (profile) => profile.id !== active?.id && !views.has(profile.id) && !popouts.has(profile.id)
  )
  log('info', 'load', 'preload-start', {
    generation,
    activeId,
    total: profiles.length,
    remaining: remaining.map((profile) => ({ id: profile.id, name: profile.name }))
  })

  if (active && !popouts.has(active.id)) {
    showProfile(active)
  } else if (!active) {
    hideAllViews()
  }

  startStaggeredPreload(generation, remaining)
}

function startStaggeredPreload(generation: number, remaining: Profile[]): void {
  void (async () => {
    for (const profile of remaining) {
      if (generation !== preloadGeneration) {
        return
      }
      if (views.has(profile.id) || popouts.has(profile.id)) {
        continue
      }
      ensureView(profile)
      startProfileLoad(profile, 'preload-stagger')
      raiseActiveView()
      if (generation !== preloadGeneration) {
        return
      }
      await delay(PRELOAD_STAGGER_MS)
    }
    raiseActiveView()
  })()
}

function startProfileLoad(profile: Profile, reason: string): void {
  const view = views.get(profile.id)
  if (!view) {
    return
  }
  void beginInitialLoad(view, profile, reason)
}

function clearRecoveryState(profileId: string): void {
  recoveryAttempts.delete(profileId)
  const timer = recoveryTimers.get(profileId)
  if (timer) {
    clearTimeout(timer)
    recoveryTimers.delete(profileId)
  }
}

function scheduleAutoRecovery(profileId: string, reason: string, delayMs = RECOVERY_DELAY_MS): void {
  const attempts = recoveryAttempts.get(profileId) ?? 0
  if (attempts >= MAX_AUTO_RECOVERIES) {
    log('warn', 'load', 'auto-recover-give-up', { profileId, reason, attempts })
    setLoadStage(profileId, 'failed')
    return
  }

  const existing = recoveryTimers.get(profileId)
  if (existing) {
    clearTimeout(existing)
  }

  log('info', 'load', 'auto-recover-scheduled', { profileId, reason, attempt: attempts + 1, delayMs })
  setLoadStage(profileId, 'loading')

  const timer = setTimeout(() => {
    recoveryTimers.delete(profileId)
    recoveryAttempts.set(profileId, attempts + 1)

    const profile = profileById.get(profileId)
    const view = views.get(profileId)
    if (!profile || !view || view.webContents.isDestroyed()) {
      return
    }

    log('info', 'load', 'auto-recover', { profileId, reason, attempt: attempts + 1 })
    markLoadStarted(profileId, `recover:${reason}`)
    setLoadStage(profileId, 'loading')

    if (hasLoadedTeamsPage(view.webContents)) {
      view.webContents.reload()
    } else {
      void beginInitialLoad(view, profile, `recover:${reason}`)
    }
  }, delayMs)
  recoveryTimers.set(profileId, timer)
}

function hasLoadedTeamsPage(contents: WebContents): boolean {
  if (contents.isDestroyed()) {
    return false
  }
  const url = contents.getURL()
  return Boolean(url) && url !== 'about:blank'
}

export function showProfile(profile: Profile): void {
  if (!mainWindow) {
    return
  }

  if (popouts.has(profile.id)) {
    focusDetached(profile.id)
    return
  }

  const view = ensureView(profile)
  if (!view) {
    return
  }

  activeProfileId = profile.id
  log('info', 'view', 'show-profile', {
    profileId: profile.id,
    name: profile.name,
    stage: loadStages.get(profile.id) ?? 'idle',
    url: sanitizeUrlish(view.webContents.getURL())
  })
  layoutEmbeddedViews({ raiseActive: true })
  ensureLoaded(view, profile)
  view.webContents.focus()
}

export function hideAllViews(): void {
  activeProfileId = null
  hideEmbeddedViews()
}

export function hideEmbeddedViews(): void {
  for (const [id, view] of views) {
    if (!popouts.has(id)) {
      view.setVisible(false)
    }
  }
}

function presentView(view: WebContentsView, raise = false): void {
  const bounds = stageViewBounds()
  if (bounds) {
    applyViewBounds(view, bounds)
  }
  view.setVisible(true)
  if (raise && mainWindow && isViewInMain(view)) {
    try {
      mainWindow.contentView.addChildView(view)
    } catch {
      // Already the top child.
    }
  }
}

function parkView(view: WebContentsView): void {
  const bounds = stageViewBounds()
  if (bounds) {
    applyViewBounds(view, bounds)
  }
  view.setVisible(true)
}

function raiseActiveView(): void {
  if (!activeProfileId || popouts.has(activeProfileId)) {
    return
  }
  const view = views.get(activeProfileId)
  if (view) {
    presentView(view, true)
  }
}

function layoutEmbeddedViews(options?: { raiseActive?: boolean }): void {
  for (const [id, view] of views) {
    if (popouts.has(id) || id === activeProfileId) {
      continue
    }
    parkView(view)
  }
  if (!activeProfileId || popouts.has(activeProfileId)) {
    return
  }
  const active = views.get(activeProfileId)
  if (active) {
    presentView(active, Boolean(options?.raiseActive))
  }
}

function ensureLoaded(view: WebContentsView, profile: Profile): void {
  trackProfile(profile)
  if (view.webContents.isDestroyed() || view.webContents.isLoading()) {
    return
  }
  if (!hasLoadedTeamsPage(view.webContents)) {
    void beginInitialLoad(view, profile, 'ensure-loaded')
  }
}

export function reloadProfile(id: string): void {
  clearRecoveryState(id)
  markLoadStarted(id, 'reload')
  setLoadStage(id, 'loading')
  views.get(id)?.webContents.reload()
}

export function toggleActiveDevTools(): void {
  focusedTeamsContents()?.toggleDevTools()
}

async function ensureTeamsHelper(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) {
    return false
  }
  try {
    await contents.executeJavaScript(TEAMS_HELPER_SCRIPT, true)
    return true
  } catch {
    return false
  }
}

async function runTeamsHelper<T>(expression: string): Promise<T | null> {
  const contents = focusedTeamsContents()
  if (!contents || contents.isDestroyed()) {
    return null
  }
  await ensureTeamsHelper(contents)
  try {
    return (await contents.executeJavaScript(expression, true)) as T
  } catch {
    return null
  }
}

/** Focus the Teams message compose box in the focused/active Teams view. */
export async function focusCompose(): Promise<boolean> {
  return Boolean(await runTeamsHelper('window.__teamsLauncherFocusCompose()'))
}

export async function openTeamsPane(
  pane: 'chat' | 'teams' | 'activity' | 'calendar'
): Promise<boolean> {
  return Boolean(
    await runTeamsHelper(`window.__teamsLauncherOpenPane(${JSON.stringify(pane)})`)
  )
}

export async function focusTeamsSearch(): Promise<boolean> {
  return Boolean(await runTeamsHelper('window.__teamsLauncherFocusSearch()'))
}

export type TeamsRecentChat = {
  index: number
  title: string
  kind: 'chat' | 'channel' | 'unknown'
}

let lastListedChats: TeamsRecentChat[] = []

export async function listTeamsRecentChats(): Promise<TeamsRecentChat[]> {
  const result = await runTeamsHelper<TeamsRecentChat[]>('window.__teamsLauncherListChats()')
  if (!Array.isArray(result)) {
    lastListedChats = []
    return []
  }
  lastListedChats = result
    .filter((item) => item && typeof item.title === 'string')
    .map((item, index) => ({
      index: typeof item.index === 'number' ? item.index : index,
      title: String(item.title),
      kind: item.kind === 'channel' || item.kind === 'chat' ? item.kind : 'unknown'
    }))
  return lastListedChats
}

export async function openTeamsChatAt(index: number): Promise<boolean> {
  const listed = lastListedChats[index]
  if (listed?.title) {
    return Boolean(
      await runTeamsHelper(
        `window.__teamsLauncherOpenChatByTitle(${JSON.stringify(listed.title)})`
      )
    )
  }
  return Boolean(await runTeamsHelper(`window.__teamsLauncherOpenChatAt(${Number(index) || 0})`))
}

export function detachProfile(profile: Profile): void {
  if (!mainWindow || popouts.has(profile.id)) {
    focusDetached(profile.id)
    return
  }

  const view = ensureView(profile)
  if (!view) {
    return
  }

  mainWindow.contentView.removeChildView(view)

  const popout = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#201F1E',
    title: profile.name,
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  popouts.set(profile.id, popout)
  popout.contentView.addChildView(view)
  view.setVisible(true)
  syncPopoutBounds(profile.id)

  popout.on('resize', () => syncPopoutBounds(profile.id))
  popout.on('resized', () => syncPopoutBounds(profile.id))
  popout.on('maximize', () => syncPopoutBounds(profile.id))
  popout.on('unmaximize', () => syncPopoutBounds(profile.id))
  popout.on('enter-full-screen', () => syncPopoutBounds(profile.id))
  popout.on('leave-full-screen', () => syncPopoutBounds(profile.id))
  popout.on('closed', () => {
    if (!popouts.has(profile.id)) {
      return
    }
    popouts.delete(profile.id)
    reattachView(profile.id, true)
    publishDetached()
  })

  if (activeProfileId === profile.id) {
    activeProfileId = null
    onActiveCleared?.()
  }

  popout.once('ready-to-show', () => {
    popout.show()
    popout.focus()
    view.webContents.focus()
  })
  popout.show()
  publishDetached()
}

export function focusDetached(id: string): void {
  const win = popouts.get(id)
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
  views.get(id)?.webContents.focus()
}

export function reattachProfile(id: string): void {
  const win = popouts.get(id)
  if (!win) {
    return
  }
  popouts.delete(id)
  if (!win.isDestroyed()) {
    win.removeAllListeners('closed')
    win.close()
  }
  reattachView(id, true)
  publishDetached()
}

function reattachView(id: string, makeActive: boolean): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  const view = views.get(id)
  if (!view || view.webContents.isDestroyed()) {
    return
  }

  try {
    mainWindow.contentView.addChildView(view)
  } catch {
    // Already attached.
  }

  if (makeActive) {
    activeProfileId = id
    layoutEmbeddedViews({ raiseActive: true })
    view.webContents.focus()
  } else {
    parkView(view)
  }
}

export async function destroyProfileView(id: string): Promise<void> {
  await tearDownProfileView(id)
  await clearProfilePartition(id)
}

/** Close the view, wipe cookies/storage for this profile, then open a fresh Teams session. */
export async function clearProfileSession(profile: Profile): Promise<void> {
  await tearDownProfileView(profile.id)
  await clearProfilePartition(profile.id)
  showProfile(profile)
}

async function tearDownProfileView(id: string): Promise<void> {
  const popout = popouts.get(id)
  if (popout) {
    popouts.delete(id)
    if (!popout.isDestroyed()) {
      popout.removeAllListeners('closed')
      popout.close()
    }
    publishDetached()
  }

  const view = views.get(id)
  if (view) {
    view.setVisible(false)
    try {
      mainWindow?.contentView.removeChildView(view)
    } catch {
      // Not in main.
    }
    if (!view.webContents.isDestroyed()) {
      view.webContents.close()
    }
    views.delete(id)
  }

  if (activeProfileId === id) {
    activeProfileId = null
  }

  titleUnread.delete(id)
  badgeUnread.delete(id)
  loadStages.delete(id)
  loadStartedAt.delete(id)
  profileById.delete(id)
  clearRecoveryState(id)
  publishUnread(true)
  publishLoadStages()
  log('info', 'view', 'teardown', { profileId: id })
}

async function clearProfilePartition(id: string): Promise<void> {
  const ses = session.fromPartition(`persist:${id}`)
  await ses.clearCache()
  await ses.clearStorageData({
    storages: [
      'cookies',
      'filesystem',
      'indexdb',
      'localstorage',
      'shadercache',
      'websql',
      'serviceworkers',
      'cachestorage'
    ]
  })
  // Keep session hooks registered so clear+reopen does not stack webRequest handlers.
}

export function attachAppWebContentsHandlers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler((details) => handleWindowOpen(details, contents))
    contents.on('will-navigate', (event, url) => {
      handleNavigation(event, contents, url)
    })
    contents.on('will-redirect', (event) => {
      if (!event.isMainFrame) {
        return
      }
      handleNavigation(event, contents, event.url)
    })
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) {
        return
      }
      handleNavigation(event, contents, event.url)
    })
    contents.on('context-menu', (_event, params) => {
      if (contents === mainWindow?.webContents) {
        return
      }
      showTeamsContextMenu(contents, params)
    })
    contents.on('before-input-event', (event, input) => {
      handleShortcut(event, input, contents)
    })
    contents.on('did-create-window', (win) => {
      const ping = (): void => notifyGuestResize(win.webContents)
      win.on('resize', ping)
      win.on('resized', ping)
      win.on('maximize', ping)
      win.on('unmaximize', ping)
      win.on('enter-full-screen', ping)
      win.on('leave-full-screen', ping)
      win.webContents.once('did-finish-load', () => {
        if (isTeamsDiagnosticsUrl(win.webContents.getURL()) && !win.isDestroyed()) {
          setTimeout(() => {
            if (!win.isDestroyed()) {
              win.close()
            }
          }, 8000)
        }
      })
    })
    attachSignInHelpers(contents)
  })
}

function handleNavigation(
  event: { preventDefault: () => void },
  contents: WebContents,
  url: string
): void {
  if (isAppRendererUrl(contents, url)) {
    return
  }
  if (
    url === 'about:blank' ||
    url.startsWith('about:blank?') ||
    url.startsWith('about:blank#') ||
    url.startsWith('blob:') ||
    url.startsWith('data:')
  ) {
    return
  }
  if (isAllowedTeamsUrl(url)) {
    return
  }
  event.preventDefault()
  log('info', 'nav', 'open-external', {
    url: sanitizeUrlish(url),
    from: sanitizeUrlish(contents.getURL())
  })
  openExternalSafely(url)
}

function openExternalSafely(url: string): void {
  if (isSafeExternalUrl(url)) {
    void shell.openExternal(url)
  }
}

export function syncBounds(): void {
  syncActiveBounds()
  for (const id of popouts.keys()) {
    syncPopoutBounds(id)
  }
}

function createView(profile: Profile): WebContentsView {
  const partition = `persist:${profile.id}`
  const view = new WebContentsView({
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      backgroundThrottling: false
    }
  })

  configureSession(view.webContents.session, profile.id)
  view.webContents.setUserAgent(chromeUserAgent())
  view.webContents.setBackgroundThrottling(false)
  attachUnreadTracking(profile.id, view.webContents)
  attachLoginRecovery(view.webContents, profile)
  attachLoadTracking(profile.id, view.webContents)
  parkView(view)
  return view
}

async function beginInitialLoad(
  view: WebContentsView,
  profile: Profile,
  reason: string
): Promise<void> {
  const contents = view.webContents
  if (contents.isDestroyed()) {
    return
  }
  if (loadInFlight.has(contents)) {
    log('debug', 'load', 'load-skipped-in-flight', { profileId: profile.id, reason })
    return
  }
  if (contents.isLoading()) {
    log('debug', 'load', 'load-skipped-already-loading', { profileId: profile.id, reason })
    return
  }
  if (hasLoadedTeamsPage(contents) && !reason.startsWith('recover') && reason !== 'reload') {
    return
  }

  loadInFlight.add(contents)
  try {
    const pickAccount =
      reason !== 'reload' && !reason.startsWith('recover')
        ? await partitionHasNoCookies(profile.id)
        : false
    if (contents.isDestroyed()) {
      return
    }

    markLoadStarted(profile.id, pickAccount ? `${reason}-empty-partition` : reason)
    setLoadStage(profile.id, 'loading')
    const url = teamsEntryUrl(sanitizeProfileUrl(profile.url), { pickAccount })
    log('info', 'load', 'load-url', {
      profileId: profile.id,
      name: profile.name,
      reason,
      pickAccount,
      url: sanitizeUrlish(url)
    })
    await contents.loadURL(url)
  } catch (error) {
    log('error', 'load', 'load-url-failed', {
      profileId: profile.id,
      reason,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loadInFlight.delete(contents)
  }
}

function isSplashTitle(title: string): boolean {
  const value = title.trim()
  if (!value || /^microsoft teams$/i.test(value)) {
    return true
  }
  return /just another minute|getting things ready|still working|taking longer/i.test(value)
}

function attachLoadTracking(profileId: string, contents: WebContents): void {
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  let lastLoggedUrl = ''

  const clearReadyTimer = (): void => {
    if (readyTimer) {
      clearTimeout(readyTimer)
      readyTimer = null
    }
  }

  const applyNavigation = (): void => {
    if (contents.isDestroyed()) {
      return
    }
    const url = contents.getURL()
    const kind = classifyLoadUrl(url)
    if (url !== lastLoggedUrl) {
      lastLoggedUrl = url
      log('info', 'nav', 'navigate', {
        profileId,
        kind,
        url: sanitizeUrlish(url),
        title: contents.getTitle(),
        elapsedMs: elapsedMs(profileId)
      })
    }
    if (kind === 'signing-in') {
      clearReadyTimer()
      setLoadStage(profileId, 'signing-in')
      return
    }
    if (loadStages.get(profileId) === 'ready') {
      return
    }
    if (kind === 'app' || kind === 'other') {
      setLoadStage(profileId, 'loading')
    }
  }

  const tryMarkReady = (): void => {
    if (contents.isDestroyed() || contents.isLoading()) {
      return
    }
    if (classifyLoadUrl(contents.getURL()) !== 'app' || isSplashTitle(contents.getTitle())) {
      return
    }
    setLoadStage(profileId, 'ready')
    clearReadyTimer()
  }

  const armReady = (): void => {
    if (contents.isDestroyed()) {
      return
    }
    const kind = classifyLoadUrl(contents.getURL())
    if (kind === 'signing-in') {
      clearReadyTimer()
      setLoadStage(profileId, 'signing-in')
      return
    }
    if (kind !== 'app') {
      return
    }
    clearReadyTimer()
    readyTimer = setTimeout(() => {
      readyTimer = null
      tryMarkReady()
    }, LOAD_READY_IDLE_MS)
  }

  const injectVisibility = (): void => {
    void contents.executeJavaScript(VISIBILITY_SCRIPT, true).catch(() => undefined)
  }

  contents.on('dom-ready', injectVisibility)
  contents.on('did-start-loading', () => {
    clearReadyTimer()
    if (loadStages.get(profileId) === 'ready') {
      return
    }
    applyNavigation()
  })
  contents.on('did-navigate', applyNavigation)
  contents.on('did-navigate-in-page', (_event, url) => {
    log('debug', 'nav', 'navigate-in-page', {
      profileId,
      url: sanitizeUrlish(url),
      elapsedMs: elapsedMs(profileId)
    })
  })
  contents.on('did-stop-loading', armReady)
  contents.on('page-title-updated', (_event, title) => {
    if (loadStages.get(profileId) === 'ready') {
      return
    }
    log('debug', 'load', 'title-updated', {
      profileId,
      title,
      splash: isSplashTitle(title),
      elapsedMs: elapsedMs(profileId)
    })
    tryMarkReady()
  })
  contents.on('did-finish-load', () => {
    injectVisibility()
    log('info', 'load', 'did-finish-load', {
      profileId,
      url: sanitizeUrlish(contents.getURL()),
      title: contents.getTitle(),
      elapsedMs: elapsedMs(profileId)
    })
    armReady()
  })
  contents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (code === -3) {
      return
    }
    log(isMainFrame ? 'error' : 'warn', 'load', 'did-fail-load', {
      profileId,
      code,
      description,
      isMainFrame,
      url: sanitizeUrlish(validatedURL),
      elapsedMs: elapsedMs(profileId)
    })
    if (isMainFrame) {
      clearReadyTimer()
      if (RECOVERABLE_FAIL_CODES.has(code) || description === 'ERR_NETWORK_CHANGED') {
        scheduleAutoRecovery(profileId, 'network-changed')
        return
      }
      setLoadStage(profileId, 'failed')
    }
  })
  contents.on('render-process-gone', (_event, details) => {
    log('error', 'load', 'render-process-gone', {
      profileId,
      reason: details.reason,
      exitCode: details.exitCode,
      elapsedMs: elapsedMs(profileId)
    })
    scheduleAutoRecovery(profileId, `render-gone:${details.reason}`, 3_000)
  })
  contents.on('unresponsive', () => {
    log('warn', 'load', 'unresponsive', { profileId, elapsedMs: elapsedMs(profileId) })
  })
  contents.on('responsive', () => {
    log('info', 'load', 'responsive', { profileId, elapsedMs: elapsedMs(profileId) })
  })
  contents.on('console-message', (event) => {
    const level = event.level
    if (level !== 'warning' && level !== 'error') {
      return
    }
    const text = String(event.message || '')
    if (text.startsWith('__TEAMS_BADGE__:')) {
      return
    }
    log(level === 'error' ? 'error' : 'warn', 'guest-console', level, {
      profileId,
      message: text.length > 500 ? `${text.slice(0, 500)}…` : text,
      line: event.lineNumber,
      source: sanitizeUrlish(String(event.sourceId || ''))
    })
  })
}

function classifyLoadUrl(url: string): 'signing-in' | 'app' | 'other' | 'blank' {
  if (!url || url === 'about:blank') {
    return 'blank'
  }
  try {
    const host = new URL(url).hostname
    if (isMicrosoftLoginHost(host)) {
      return 'signing-in'
    }
    if (isTeamsAppHost(host)) {
      return 'app'
    }
  } catch {
    return 'other'
  }
  return 'other'
}

function setLoadStage(id: string, stage: LoadStage): void {
  if (loadStages.get(id) === stage) {
    return
  }
  const previous = loadStages.get(id) ?? 'idle'
  loadStages.set(id, stage)
  log('info', 'load', 'stage', {
    profileId: id,
    from: previous,
    to: stage,
    elapsedMs: elapsedMs(id)
  })
  if (stage === 'ready') {
    clearRecoveryState(id)
    loadStartedAt.delete(id)
  } else if (stage === 'failed') {
    loadStartedAt.delete(id)
  }
  publishLoadStages()
}

function publishLoadStages(): void {
  onLoadStageChange?.(getLoadStageMap())
}

function configureSession(ses: Session, profileId: string): void {
  if (configuredSessions.has(profileId)) {
    return
  }
  configuredSessions.add(profileId)

  ses.setUserAgent(chromeUserAgent())
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const chromeMajor = process.versions.chrome.split('.')[0]
    const platformHint =
      process.platform === 'darwin' ? '"macOS"' : process.platform === 'win32' ? '"Windows"' : '"Linux"'
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        'User-Agent': chromeUserAgent(),
        'Sec-CH-UA': `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not.A/Brand";v="24"`,
        'Sec-CH-UA-Mobile': '?0',
        'Sec-CH-UA-Platform': platformHint
      }
    })
  })
  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(isAllowedPermission(permission))
  })
  ses.setPermissionCheckHandler((_contents, permission) => isAllowedPermission(permission))

  ses.setDisplayMediaRequestHandler((_request, callback) => {
    void pickDisplaySource(mainWindow)
      .then((source) => {
        if (!source) {
          callback({})
          return
        }
        callback({
          video: source,
          audio: 'loopback'
        })
      })
      .catch(() => {
        callback({})
      })
  })

  attachSessionCookiePersistence(ses)
}

const SESSION_COOKIE_TTL_SEC = 14 * 24 * 60 * 60
const PERSIST_SESSION_COOKIE_HOSTS = [
  /(?:^|\.)login\.microsoftonline\.com$/i,
  /(?:^|\.)microsoftonline\.com$/i,
  /(?:^|\.)teams\.microsoft\.com$/i,
  /(?:^|\.)login\.microsoft\.com$/i,
  /(?:^|\.)login\.live\.com$/i,
  /(?:^|\.)login\.windows\.net$/i
]

function attachSessionCookiePersistence(ses: Session): void {
  const rewriting = new Set<string>()
  ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed || !cookie.session) {
      return
    }
    const host = (cookie.domain ?? '').replace(/^\./, '')
    if (!PERSIST_SESSION_COOKIE_HOSTS.some((pattern) => pattern.test(host))) {
      return
    }
    const key = `${cookie.domain}|${cookie.path}|${cookie.name}|${cookie.secure}|${cookie.httpOnly}`
    if (rewriting.has(key)) {
      return
    }
    rewriting.add(key)
    const url = cookieSetUrl(cookie)
    const details: CookiesSetDetails = {
      url,
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: Math.floor(Date.now() / 1000) + SESSION_COOKIE_TTL_SEC,
      sameSite: cookie.sameSite
    }
    if (!cookie.hostOnly && cookie.domain) {
      details.domain = cookie.domain
    }
    void ses.cookies
      .set(details)
      .catch(() => undefined)
      .finally(() => {
        rewriting.delete(key)
      })
  })
}

function cookieSetUrl(cookie: Electron.Cookie): string {
  const host = (cookie.domain ?? 'localhost').replace(/^\./, '')
  const protocol = cookie.secure ? 'https' : 'http'
  const path = cookie.path || '/'
  return `${protocol}://${host}${path}`
}

async function partitionHasNoCookies(id: string): Promise<boolean> {
  const cookies = await session.fromPartition(`persist:${id}`).cookies.get({})
  return cookies.length === 0
}

export function switchAccount(profile: Profile): void {
  showProfile(profile)
  const view = views.get(profile.id)
  if (!view || view.webContents.isDestroyed()) {
    return
  }
  void view.webContents.loadURL(
    teamsEntryUrl(sanitizeProfileUrl(profile.url), { pickAccount: true })
  )
}

export async function flushProfileSessions(ids: string[]): Promise<void> {
  const unique = new Set([...ids, ...configuredSessions, ...views.keys()])
  await Promise.all(
    [...unique].map((id) =>
      session
        .fromPartition(`persist:${id}`)
        .cookies.flushStore()
        .catch(() => undefined)
    )
  )
}

/** Load Teams. Only force the account picker on first run (empty partition) or Switch account. */
function teamsEntryUrl(url: string, options?: { pickAccount?: boolean }): string {
  try {
    const parsed = new URL(url)
    if (!/(?:^|\.)teams\.microsoft\.com$/i.test(parsed.hostname)) {
      return url
    }
    if (options?.pickAccount) {
      parsed.searchParams.set('prompt', 'select_account')
    }
    return parsed.toString()
  } catch {
    return url
  }
}

const SIGNIN_HELPER = `(() => {
  if (window.__teamsLauncherSigninHelper) return;
  window.__teamsLauncherSigninHelper = true;

  const reject = () =>
    Promise.reject(new DOMException('NotAllowedError', 'NotAllowedError'));
  try {
    if (navigator.credentials) {
      navigator.credentials.get = reject;
      navigator.credentials.create = reject;
    }
    if (window.PublicKeyCredential) {
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () =>
        Promise.resolve(false);
      if (window.PublicKeyCredential.isConditionalMediationAvailable) {
        window.PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
      }
    }
  } catch {
    // Page may freeze the credentials API.
  }

  let clicked = false;
  const stuckOnPasskey = () => {
    const text = (document.body && document.body.innerText) || '';
    return (
      /Face, fingerprint, PIN or security key/i.test(text) ||
      /open a security window/i.test(text)
    );
  };
  const clickFallback = () => {
    const nodes = document.querySelectorAll('a, button, [role="button"]');
    for (const el of nodes) {
      const t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 90) continue;
      if (
        /use (your |a )?password/i.test(t) ||
        /sign in another way/i.test(t) ||
        /other ways to sign in/i.test(t) ||
        /use a different (account|method)/i.test(t) ||
        /i can't use/i.test(t)
      ) {
        el.click();
        return true;
      }
    }
    return false;
  };
  const tick = () => {
    if (clicked || !stuckOnPasskey()) return;
    if (clickFallback()) clicked = true;
  };

  document.addEventListener('DOMContentLoaded', tick);
  if (document.readyState !== 'loading') tick();
  try {
    if (document.documentElement) {
      new MutationObserver(tick).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  } catch {}
  setTimeout(tick, 400);
  setTimeout(tick, 1400);
  setTimeout(tick, 3000);
})();`

function attachSignInHelpers(contents: WebContents): void {
  const inject = (): void => {
    if (contents.isDestroyed() || contents === mainWindow?.webContents) {
      return
    }
    if (!isMicrosoftLoginUrl(contents.getURL())) {
      return
    }
    void contents.executeJavaScript(SIGNIN_HELPER).catch(() => undefined)
  }

  contents.on('dom-ready', inject)
  contents.on('did-finish-load', inject)
}

function attachLoginRecovery(contents: WebContents, profile: Profile): void {
  let recoveries = 0
  contents.on('did-finish-load', () => {
    if (contents.isDestroyed() || recoveries >= 2 || !isMicrosoftLoginUrl(contents.getURL())) {
      return
    }
    void contents
      .executeJavaScript(
        `Boolean(document.body && /AADSTS900561/i.test(document.body.innerText || ''))`
      )
      .then((stuck: unknown) => {
        if (stuck !== true || contents.isDestroyed() || recoveries >= 2) {
          return
        }
        recoveries += 1
        void contents.loadURL(teamsEntryUrl(sanitizeProfileUrl(profile.url)))
      })
      .catch(() => undefined)
  })
}

export function chromeUserAgent(): string {
  const chrome = process.versions.chrome
  if (process.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  if (process.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

function isMicrosoftLoginUrl(url: string): boolean {
  if (!url || url === 'about:blank') {
    return false
  }
  try {
    return isMicrosoftLoginHost(new URL(url).hostname)
  } catch {
    return false
  }
}

function isAllowedPermission(permission: string): boolean {
  return [
    'media',
    'mediaKeySystem',
    'notifications',
    'display-capture',
    'clipboard-sanitized-write',
    'clipboard-read',
    'fullscreen',
    'pointerLock',
    'idle-detection',
    'storage-access',
    'top-level-storage-access',
    'window-management'
  ].includes(permission)
}

function handleWindowOpen(
  details: HandlerDetails,
  contents: WebContents
): {
  action: 'allow' | 'deny'
  overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions
} {
  if (isTeamsDiagnosticsUrl(details.url)) {
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        show: false,
        width: 1,
        height: 1,
        skipTaskbar: true,
        webPreferences: {
          session: contents.session,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false
        }
      }
    }
  }

  const popupOptions = teamsPopupWindowOptions(contents)

  if (isTeamsGuestContents(contents) && isEmbeddedWebContentUrl(details.url)) {
    log('info', 'nav', 'popup-allow', {
      url: sanitizeUrlish(details.url),
      disposition: details.disposition
    })
    return { action: 'allow', overrideBrowserWindowOptions: popupOptions }
  }

  if (isAllowedTeamsUrl(details.url) || details.url === 'about:blank' || details.url.startsWith('about:blank?')) {
    log('info', 'nav', 'popup-allow', {
      url: sanitizeUrlish(details.url),
      disposition: details.disposition
    })
    return { action: 'allow', overrideBrowserWindowOptions: popupOptions }
  }

  log('info', 'nav', 'popup-external', {
    url: sanitizeUrlish(details.url),
    disposition: details.disposition
  })
  void openExternalSafely(details.url)
  return { action: 'deny' }
}

function isTeamsGuestContents(contents: WebContents): boolean {
  return contents !== mainWindow?.webContents
}

function isProfileTeamsView(contents: WebContents): boolean {
  if (contents.isDestroyed()) {
    return false
  }
  for (const view of views.values()) {
    if (view.webContents === contents) {
      return true
    }
  }
  return false
}

function teamsPopupWindowOptions(contents: WebContents): Electron.BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: '#201F1E',
    useContentSize: true,
    webPreferences: {
      session: contents.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  }
}

function isAppRendererUrl(contents: WebContents, url: string): boolean {
  // Only the launcher UI (sidebar) may load local/dev renderer URLs — never Teams partitions.
  if (contents !== mainWindow?.webContents) {
    return false
  }

  if (url === 'about:blank' || url.startsWith('devtools:')) {
    return true
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol === 'file:') {
    return true
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  }

  return false
}

function showTeamsContextMenu(contents: WebContents, params: Electron.ContextMenuParams): void {
  const template: Electron.MenuItemConstructorOptions[] = []

  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      template.push({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion)
      })
    }
    if (template.length > 0) {
      template.push({ type: 'separator' })
    }
  }

  template.push(
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    { type: 'separator' },
    { label: 'Reload Teams', click: () => contents.reload() }
  )

  Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) ?? undefined })
}

function handleShortcut(event: Electron.Event, input: Electron.Input, contents: WebContents): void {
  if (input.type !== 'keyDown') {
    return
  }

  const ctrl = input.control || input.meta
  const isMainRenderer = contents === mainWindow?.webContents
  const isProfileView = isProfileTeamsView(contents)

  // Ctrl/Cmd+T opens the command palette (shell or profile Teams views — not login/auth popups).
  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 't') {
    if (formOverlayOpen) {
      return
    }
    if (isMainRenderer || isProfileView) {
      event.preventDefault()
      requestOpenPalette()
    }
    return
  }

  if (paletteOpen) {
    if (input.key === 'Escape') {
      event.preventDefault()
      onClosePalette?.()
      return
    }
    if (!isMainRenderer) {
      // Keep typing/navigation on the shell palette, not the hidden Teams view.
      event.preventDefault()
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.focus()
      }
      return
    }
    // Renderer owns other keys while the palette is open.
    return
  }

  if (ctrl && !input.shift && !input.alt && /^[1-9]$/.test(input.key)) {
    event.preventDefault()
    onSwitchIndex?.(Number(input.key) - 1)
    return
  }

  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 'b') {
    event.preventDefault()
    onToggleSidebar?.()
    return
  }

  if (ctrl && !input.shift && !input.alt && input.key.toLowerCase() === 'r') {
    event.preventDefault()
    const focused = BrowserWindow.getFocusedWindow()
    for (const [id, win] of popouts) {
      if (win === focused) {
        views.get(id)?.webContents.reload()
        return
      }
    }
    activeEmbeddedView()?.webContents.reload()
    return
  }

  if (ctrl && input.shift && !input.alt && input.key.toLowerCase() === 'd') {
    event.preventDefault()
    onRunShortcutAction?.('tenant.detach')
    return
  }

  if (ctrl && input.shift && !input.alt && input.key.toLowerCase() === 'a') {
    event.preventDefault()
    onRunShortcutAction?.('tenant.reattach')
    return
  }

  if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
    event.preventDefault()
    const focused = BrowserWindow.getFocusedWindow()
    for (const [id, win] of popouts) {
      if (win === focused) {
        views.get(id)?.webContents.toggleDevTools()
        return
      }
    }
    activeEmbeddedView()?.webContents.toggleDevTools()
    return
  }

  if (input.key === 'F12') {
    event.preventDefault()
    mainWindow?.webContents.toggleDevTools()
  }
}

function requestOpenPalette(): void {
  if (paletteOpen) {
    return
  }
  onOpenPalette?.()
}

function focusedTeamsContents(): WebContents | undefined {
  const focusedWin = BrowserWindow.getFocusedWindow()
  for (const [id, win] of popouts) {
    if (win === focusedWin) {
      const view = views.get(id)
      if (view && !view.webContents.isDestroyed()) {
        return view.webContents
      }
    }
  }
  const embedded = activeEmbeddedView()
  if (embedded && !embedded.webContents.isDestroyed()) {
    return embedded.webContents
  }
  return undefined
}

function activeEmbeddedView(): WebContentsView | undefined {
  if (!activeProfileId || popouts.has(activeProfileId)) {
    return undefined
  }
  return views.get(activeProfileId)
}

function isViewInMain(view: WebContentsView): boolean {
  if (!mainWindow) {
    return false
  }
  const children = mainWindow.contentView.children as WebContentsView[]
  return children.includes(view)
}

function stageViewBounds(): { x: number; y: number; width: number; height: number } | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null
  }

  const [width, height] = mainWindow.getContentSize()
  const htmlFullscreen = mainWindow.isFullScreen() || mainWindow.isSimpleFullScreen()
  if (!htmlFullscreen && stageBounds) {
    return stageBounds
  }
  return {
    x: htmlFullscreen ? 0 : sidebarOffset,
    y: 0,
    width: Math.max(0, width - (htmlFullscreen ? 0 : sidebarOffset)),
    height
  }
}

function syncActiveBounds(): void {
  layoutEmbeddedViews()
}

function syncPopoutBounds(id: string): void {
  const win = popouts.get(id)
  const view = views.get(id)
  if (!win || win.isDestroyed() || !view) {
    return
  }
  const [width, height] = win.getContentSize()
  applyViewBounds(view, { x: 0, y: 0, width, height })
}

function applyViewBounds(
  view: WebContentsView,
  bounds: { x: number; y: number; width: number; height: number }
): void {
  const next = roundBounds(bounds)
  if (!next) {
    return
  }
  const current = view.getBounds()
  if (
    current.x !== next.x ||
    current.y !== next.y ||
    current.width !== next.width ||
    current.height !== next.height
  ) {
    view.setBounds(next)
  }
  notifyGuestResize(view.webContents)
}

function roundBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } | null {
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height))
  }
}

function notifyGuestResize(contents: WebContents): void {
  if (contents.isDestroyed()) {
    return
  }
  const existing = guestResizeTimers.get(contents)
  if (existing) {
    clearTimeout(existing)
  }
  guestResizeTimers.set(
    contents,
    setTimeout(() => {
      guestResizeTimers.delete(contents)
      if (contents.isDestroyed()) {
        return
      }
      void contents
        .executeJavaScript(
          `(() => {
            window.dispatchEvent(new Event('resize'));
            if (window.visualViewport) {
              window.visualViewport.dispatchEvent(new Event('resize'));
            }
          })()`
        )
        .catch(() => undefined)
    }, 16)
  )
}

function publishDetached(): void {
  onDetachedChange?.(getDetachedIds())
}

function attachUnreadTracking(profileId: string, contents: WebContents): void {
  const inject = (): void => {
    void contents.executeJavaScript(BADGE_SCRIPT, true).catch(() => undefined)
    void contents.executeJavaScript(TEAMS_HELPER_SCRIPT, true).catch(() => undefined)
  }

  contents.on('page-title-updated', (_event, title) => {
    applyTitleUnread(profileId, title)
  })
  contents.on('did-finish-load', () => {
    applyTitleUnread(profileId, contents.getTitle())
    inject()
  })
  contents.on('did-navigate-in-page', () => {
    inject()
  })
  contents.on('console-message', (event, _level, message) => {
    const text = event.message || message
    const composePrefix = '__TEAMS_COMPOSE__:'
    if (text.startsWith(composePrefix)) {
      composingByContents.set(contents, text.slice(composePrefix.length) === '1')
      return
    }
    const prefix = '__TEAMS_BADGE__:'
    if (!text.startsWith(prefix)) {
      return
    }
    const parsed = Number(text.slice(prefix.length))
    if (!Number.isFinite(parsed) || parsed < 0) {
      return
    }
    const next = Math.floor(parsed)
    if (badgeUnread.get(profileId) === next) {
      return
    }
    badgeUnread.set(profileId, next)
    publishUnread(true)
  })
}

function applyTitleUnread(profileId: string, title: string): void {
  const next = parseUnreadTitle(title)
  const previous = titleUnread.get(profileId)
  if (previous && previous.count === next.count && previous.plus === next.plus) {
    return
  }
  titleUnread.set(profileId, next)
  publishUnread(true)
}

export function parseUnreadTitle(title: string): UnreadBadge {
  const match = title.match(/\((\d+)\+?\)/)
  if (!match) {
    return { count: 0, plus: false }
  }
  return {
    count: Number(match[1]),
    plus: /\(\d+\+\)/.test(title)
  }
}

function combinedUnread(profileId: string): UnreadBadge {
  const fromTitle = titleUnread.get(profileId) ?? { count: 0, plus: false }
  const fromBadge = badgeUnread.get(profileId) ?? 0
  return {
    count: Math.max(fromTitle.count, fromBadge),
    plus: fromTitle.plus && fromTitle.count >= fromBadge
  }
}

function publishUnread(emit: boolean): UnreadMap {
  const unread: UnreadMap = {}
  const ids = new Set([...titleUnread.keys(), ...badgeUnread.keys(), ...views.keys()])
  for (const id of ids) {
    unread[id] = combinedUnread(id)
  }
  if (emit) {
    onUnreadChange?.(unread)
  }
  return unread
}
