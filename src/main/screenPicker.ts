import { BrowserWindow, desktopCapturer, ipcMain, type DesktopCapturerSource } from 'electron'
import { join } from 'path'
import pickerHtml from '../../resources/screen-picker.html?asset'

export type PickerSource = {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string
}

let pickerBusy = false

export async function pickDisplaySource(
  parent: BrowserWindow | null
): Promise<DesktopCapturerSource | null> {
  if (pickerBusy) {
    return null
  }
  pickerBusy = true

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })

    if (sources.length === 0) {
      return null
    }

    const payload: PickerSource[] = sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.toDataURL()
    }))

    const selectedId = await showPickerWindow(parent, payload)
    if (!selectedId) {
      return null
    }
    return sources.find((source) => source.id === selectedId) ?? null
  } finally {
    pickerBusy = false
  }
}

function showPickerWindow(
  parent: BrowserWindow | null,
  sources: PickerSource[]
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = `screen-picker:${Date.now()}-${Math.random().toString(36).slice(2)}`
    let settled = false

    const finish = (value: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      ipcMain.removeHandler(`${channel}:list`)
      ipcMain.removeHandler(`${channel}:select`)
      ipcMain.removeHandler(`${channel}:cancel`)
      if (!win.isDestroyed()) {
        win.close()
      }
      resolve(value)
    }

    const win = new BrowserWindow({
      width: 720,
      height: 560,
      minWidth: 560,
      minHeight: 420,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: Boolean(parent && !parent.isDestroyed()),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#1B1A19',
      title: 'Choose what to share',
      webPreferences: {
        preload: join(__dirname, '../preload/screenPicker.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    ipcMain.handle(`${channel}:list`, () => sources)
    ipcMain.handle(`${channel}:select`, (_event, id: string) => {
      finish(typeof id === 'string' ? id : null)
    })
    ipcMain.handle(`${channel}:cancel`, () => {
      finish(null)
    })

    win.on('closed', () => {
      finish(null)
    })

    void win
      .loadFile(pickerHtml, {
        query: { channel }
      })
      .then(() => {
        if (!win.isDestroyed()) {
          win.show()
          win.focus()
        }
      })
  })
}
