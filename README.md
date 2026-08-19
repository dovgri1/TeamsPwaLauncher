# Teams PWA Launcher

A desktop app for Microsoft Teams web on **Linux** and **Windows**. Create named profiles (Work, Personal, …), each with its own login and cookies, and switch between them from a sidebar. You do not need a separate installed PWA per account.

## Run locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

## Use

1. Click **Add profile**, pick a name, icon, and color.
2. Sign in to Teams in that profile.
3. Add more profiles for other accounts. Each one stays signed in independently.
4. Click a profile in the sidebar to switch. Background profiles stay loaded.

Shortcuts:

- `Ctrl+1` … `Ctrl+9` — switch profiles
- `Ctrl+R` — reload the active Teams view
- Right-click a profile — edit, reload, or delete
- Double-click a profile — edit

Deleting a profile signs it out and clears that profile’s cookies and local Teams data.

## Install on Windows

On a Windows machine, from this repo:

```bash
npm install
npm run build:win
```

That writes under `dist/`:

- `teams-pwa-launcher-1.0.0-setup.exe` — installer (Start Menu + optional desktop shortcut)
- `teams-pwa-launcher-1.0.0-portable.exe` — run without installing

Run the setup exe and follow the prompts. After that, launch **Teams PWA Launcher** from the Start Menu.

You can also copy a setup exe built on another machine and install it on Windows. Building the Windows installer **from Linux** needs extra tools (Wine); building on Windows is the reliable path.

## Package for Linux

```bash
npm run build:linux
```

This writes an AppImage and a `.deb` under `dist/`.

```bash
sudo apt install ./dist/teams-pwa-launcher-1.0.0.deb
```

On Linux, screen sharing uses PipeWire (`xdg-desktop-portal`). Camera and microphone prompts are allowed for Teams calls on both platforms.

## Data

Profiles and session data:

- Linux: `~/.config/teams-pwa-launcher/`
- Windows: `%APPDATA%\teams-pwa-launcher\`

Removing that directory resets the app, including saved logins.
