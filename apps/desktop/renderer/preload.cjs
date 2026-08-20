const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktopAuth', {
  login: request => ipcRenderer.invoke('desktop:authenticate', request),
  requestHubKey: request => ipcRenderer.invoke('desktop:request-hub-key', request),
  retrySavedModelKey: request => ipcRenderer.invoke('desktop:retry-saved-model-key', request),
})
