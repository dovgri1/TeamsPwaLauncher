# Teams PWA Launcher

**One desktop app for multiple Microsoft Teams accounts** — on Linux, Windows, and macOS.

Instead of installing a separate Teams PWA (or browser profile) for every work, school, or personal tenant, Teams PWA Launcher keeps each account in its own isolated session inside a single application. Switch tenants from a sidebar, pop one out for a call, and keep chatting in another.

This app embeds the official [Microsoft Teams web](https://teams.microsoft.com) client. It is not affiliated with Microsoft.

## Why use it

| Without this app | With Teams PWA Launcher |
| --- | --- |
| Multiple browser PWAs or Chrome profiles clutter your dock/Start Menu | One app icon |
| Easy to mix cookies / get signed into the wrong tenant | Each tenant has its own cookies and storage |
| Hard to watch a call and message another account at once | Detach a tenant into its own window |
| Screen share often grabs the wrong display | Built-in picker for screen or window |

## Features

- **Named tenants** — Work, Personal, Client A, … with custom colors and icons  
- **Isolated logins** — each profile uses a separate Chromium partition (`persist:<id>`)  
- **Unread badges** — see notification counts per tenant in the sidebar (only for loaded tenants; enable **Load all on startup** in the sidebar, or **View → Load all tenants on startup**)  
- **Detachable windows** — keep a call in a pop-out while messaging in another tenant  
- **Screen share picker** — choose which monitor or window to share  
- **Collapsible sidebar** — icon rail when collapsed, full tenant list when expanded (`Ctrl+B` / `⌘B`)  
- **Linux, Windows & macOS** — `.deb` / AppImage, Windows installer / portable exe, and a macOS `.dmg` 

## Install on Linux

### Option A — Debian / Ubuntu package (`.deb`)

1. Download `teams-pwa-launcher-*-amd64.deb` (or `teams-pwa-launcher-*.deb`) from the project’s **Releases**.
2. Install it:

```bash
sudo apt install ./teams-pwa-launcher-1.1.3.deb
```

3. Open **Teams PWA Launcher** from your application menu.

To remove later:

```bash
sudo apt remove teams-pwa-launcher
```

### Option B — AppImage

1. Download `teams-pwa-launcher-*.AppImage` from Releases.
2. Make it executable and run:

```bash
chmod +x teams-pwa-launcher-1.1.3.AppImage
./teams-pwa-launcher-1.1.3.AppImage
```

### Build from source (Linux)

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+.

```bash
git clone https://github.com/dovgri1/TeamsPwaLauncher.git
cd TeamsPwaLauncher
npm install
npm run build:linux
sudo apt install ./dist/teams-pwa-launcher-1.1.3.deb
```

Screen sharing on Linux uses PipeWire (`xdg-desktop-portal`). Camera and microphone prompts are allowed for Teams calls.

## Install on Windows

### Option A — Installer

1. Download `teams-pwa-launcher-*-setup.exe` from Releases.
2. Run the installer (Start Menu shortcut and optional desktop shortcut).
3. Launch **Teams PWA Launcher** from the Start Menu.

### Option B — Portable

1. Download `teams-pwa-launcher-*-portable.exe`.
2. Run it — no install required.

### Build from source (Windows)

Build the Windows packages **on a Windows machine** (recommended):

```bat
git clone <this-repository-url>
cd TeamsPwaLauncher
npm install
npm run build:win
```

Artifacts appear under `dist\`:

- `teams-pwa-launcher-1.1.3-setup.exe` — installer  
- `teams-pwa-launcher-1.1.3-portable.exe` — portable  

Building a Windows installer from Linux is possible with Wine, but building on Windows is more reliable.

## Install on macOS

Release builds are produced on GitHub-hosted Mac runners (not from Linux). Prefer the **`.dmg`**.

- Apple silicon (M1/M2/M3/M4): `teams-pwa-launcher-*-arm64.dmg`
- Intel: `teams-pwa-launcher-*-x64.dmg`

1. Open the disk image and drag **Teams PWA Launcher** to **Applications**.
2. First launch: in Finder, **Control-click** the app → **Open** → **Open**.  
   macOS may warn that the developer is unidentified until the app is notarized with an Apple Developer ID. You should **not** need Terminal.
3. Allow **Camera**, **Microphone**, and **Screen Recording** when prompted.

A `.zip` of the same `.app` is also on the release if you prefer it.

To remove later, drag the app from Applications to the Trash. Session data stays in `~/Library/Application Support/teams-pwa-launcher/` until you delete that folder.

### Build from source (macOS)

Requires [Node.js](https://nodejs.org/) 20.19+ or 22.12+. Build **on a Mac**:

```bash
git clone https://github.com/dovgri1/TeamsPwaLauncher.git
cd TeamsPwaLauncher
npm install
npm run build:mac
```

Artifacts appear under `dist/`:

- `teams-pwa-launcher-1.1.3-arm64.dmg` / `teams-pwa-launcher-1.1.3-x64.dmg`
- matching `.zip` archives

Notarization needs an Apple Developer ID. GitHub Actions tags (`v*`) run the same Mac build automatically.

## How to use

1. Click **Add profile**, choose a name, icon, and color.  
2. Sign in to Microsoft Teams in that profile.  
3. Add more profiles for other accounts — each stays signed in on its own.  
4. Click a profile in the sidebar to switch. Background profiles stay loaded.  

### Detach a tenant (calls + multitasking)

- Click **↗** on a profile, or right-click → **Detach window**, or press **Ctrl+Shift+D** (macOS: **⌘⇧D**).  
- That tenant opens in its own window (e.g. stay on a call there).  
- In the main window, switch to another tenant to chat or browse.  
- Close the pop-out, or right-click → **Return to main window**, to put it back.  

### Screen sharing

When Teams asks to share your screen, a picker lists your **screens** and **windows**. Select one, then Share.

### Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+1` … `Ctrl+9` (macOS: `⌘1`–`⌘9`) | Switch to tenant 1–9 |
| `Ctrl+R` (macOS: `⌘R`) | Reload the focused Teams view |
| `Ctrl+B` (macOS: `⌘B`) | Collapse / expand the tenant sidebar (icons stay visible when collapsed) |
| `Ctrl+Shift+D` (macOS: `⌘⇧D`) | Detach the active tenant |
| Right-click a profile | Edit, detach/reattach, reload, clear session, or delete |
| Double-click a profile | Edit name / icon / color |

**Clear session** (right-click a profile, or **View → Clear session for active profile**) signs that tenant out and wipes its cookies and local Teams data, then reloads a fresh sign-in page. Use this when a login is stuck (e.g. AADSTS errors). The profile itself stays in the sidebar.

**Switch account** (right-click a profile, or **View → Switch account**) opens Microsoft’s account picker in that profile without wiping the session. Use this to pick a different account in the same tenant slot.

Logins are **not** stored as passwords. Each profile keeps Microsoft’s own cookies and tokens in its Chromium partition (`persist:<id>`). After you sign in once, the app flushes those cookies on quit and keeps short-lived “session” cookies for about 14 days so you usually do not retype the password on the next launch.

Your tenant can still require a password or MFA on a schedule (Conditional Access / sign-in frequency). The app cannot bypass that. A new profile, another computer, or **Clear session** always means a full sign-in.

Deleting a profile also clears that profile’s cookies and local Teams data, and removes it from the list.

Sign-in prefers **work or school** accounts (email entry). Windows personal Microsoft account shortcuts are steered away so you can type the tenant email normally.

## Develop locally

```bash
npm install
npm run dev
```

```bash
npm run build:linux   # Linux packages
npm run build:win     # Windows packages (on Windows)
npm run build:mac     # macOS packages (on a Mac)
```

## Where data is stored

Profiles, preferences, and Teams session data live outside the install folder:

| Platform | Path |
| --- | --- |
| Linux | `~/.config/teams-pwa-launcher/` |
| Windows | `%APPDATA%\teams-pwa-launcher\` |
| macOS | `~/Library/Application Support/teams-pwa-launcher/` |

Reinstalling the app does **not** remove this folder. Delete it yourself only if you want a full reset (including all saved logins).

The app does **not** save Microsoft account passwords. Stay-signed-in comes from cookies and tokens already in that folder. `profiles.json` only stores names, colors, and icons.

### Diagnostics logs

Startup, tenant load stages, navigations, failed loads, and Teams console warnings/errors are written as JSON lines under `logs/` in that folder (for example `logs/launcher-2026-08-26.log`). Open them from **View → Open logs folder** or **View → Reveal current log**. Auth tokens in URLs are redacted. Logs older than 14 days are pruned automatically.

## Privacy & security

- Logins stay on your machine in isolated browser partitions (cookies and tokens, not stored passwords).  
- The app does not send your Teams data to a third-party server.  
- You sign in through Microsoft’s own sign-in pages, same as Teams in a normal browser.  
- Tenant policies (MFA, Conditional Access, sign-in frequency) still apply; this app cannot skip them.  
- Navigation is limited to known Microsoft / Teams hosts; other links open in your system browser over `https` only.  
- Profile entry URLs are validated so partitions cannot be pointed at arbitrary sites.

## License

MIT — see [LICENSE](LICENSE). Contributions and issue reports are welcome.
