import { contextBridge, ipcRenderer } from 'electron'

const params = new URLSearchParams(window.location.search)
const channel = params.get('channel') ?? ''

contextBridge.exposeInMainWorld('screenPicker', {
  list: (): Promise<
    Array<{ id: string; name: string; kind: 'screen' | 'window'; thumbnail: string }>
  > => ipcRenderer.invoke(`${channel}:list`),
  select: (id: string): Promise<void> => ipcRenderer.invoke(`${channel}:select`, id),
  cancel: (): Promise<void> => ipcRenderer.invoke(`${channel}:cancel`)
})
