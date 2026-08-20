const { contextBridge, ipcRenderer } = require('electron')

const desktopVersionPrefix = '--dsh-desktop-version='
const desktopVersion = process.argv
  .find(value => value.startsWith(desktopVersionPrefix))
  ?.slice(desktopVersionPrefix.length)

if (desktopVersion) {
  contextBridge.exposeInMainWorld('desktopAppInfo', {
    productName: 'Harness Enterprise Desktop',
    version: desktopVersion,
  })
}

window.addEventListener('dsh:desktop-boot-health', event => {
  const detail = event.detail
  if (detail === null || typeof detail !== 'object') return
  ipcRenderer.send('desktop:boot-health', {
    ok: detail.ok === true,
    entries: Array.isArray(detail.entries)
      ? detail.entries.filter(value => typeof value === 'string').slice(0, 256)
      : [],
    ...(typeof detail.error === 'string' ? { error: detail.error.slice(0, 8_000) } : {}),
  })
})

contextBridge.exposeInMainWorld('desktopPreview', {
  readFile: request => ipcRenderer.invoke('desktop:preview-read', request),
  openExternal: request => ipcRenderer.invoke('desktop:preview-open-external', request),
})

contextBridge.exposeInMainWorld('desktopAttachments', {
  open: request => ipcRenderer.invoke('desktop:attachment-open', request),
})

contextBridge.exposeInMainWorld('desktopPersonalMemory', {
  state: () => ipcRenderer.invoke('desktop:personal-memory-state'),
  setEnabled: enabled => ipcRenderer.invoke('desktop:personal-memory-enable', { enabled }),
  remove: id => ipcRenderer.invoke('desktop:personal-memory-remove', { id }),
  clear: () => ipcRenderer.invoke('desktop:personal-memory-clear'),
})

contextBridge.exposeInMainWorld('desktopEnterpriseAccount', {
  state: () => ipcRenderer.invoke('desktop:enterprise-account-state'),
  logout: () => ipcRenderer.invoke('desktop:enterprise-account-logout'),
})

contextBridge.exposeInMainWorld('desktopManagedUpdates', {
  state: () => ipcRenderer.invoke('desktop:managed-update-state'),
  open: () => ipcRenderer.invoke('desktop:managed-update-open'),
  subscribe: listener => {
    const wrapped = (_event, state) => { listener(state) }
    ipcRenderer.on('desktop:managed-update-changed', wrapped)
    return () => { ipcRenderer.removeListener('desktop:managed-update-changed', wrapped) }
  },
})

contextBridge.exposeInMainWorld('desktopManagedSkillSetup', {
  state: externalRef => ipcRenderer.invoke('desktop:managed-skill-setup-state', { externalRef }),
  start: externalRef => ipcRenderer.invoke('desktop:managed-skill-setup-start', { externalRef }),
  cancel: externalRef => ipcRenderer.invoke('desktop:managed-skill-setup-cancel', { externalRef }),
  subscribe: listener => {
    const wrapped = (_event, state) => { listener(state) }
    ipcRenderer.on('desktop:managed-skill-setup-changed', wrapped)
    return () => { ipcRenderer.removeListener('desktop:managed-skill-setup-changed', wrapped) }
  },
})
