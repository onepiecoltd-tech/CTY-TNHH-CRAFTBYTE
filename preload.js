// Cầu nối an toàn giữa trang và ứng dụng: chỉ gọi tới 3 máy chủ AI và chỉ ghi/mở trong thư mục sản phẩm.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopAI", {
  fetch: (url, init) => ipcRenderer.invoke("ai-fetch", { url, init: { method: init && init.method, headers: init && init.headers, body: init && init.body } }),
});
contextBridge.exposeInMainWorld("desktopApp", {
  saveProduct: (slug, files) => ipcRenderer.invoke("save-product", { slug, files }),
  openPath: (p) => ipcRenderer.invoke("open-path", p),
  productsDir: () => ipcRenderer.invoke("products-dir"),
});
contextBridge.exposeInMainWorld("desktopCC", {
  run: (system, user, model) => ipcRenderer.invoke("cc-run", { system, user, model }),
  status: () => ipcRenderer.invoke("cc-status"),
});
contextBridge.exposeInMainWorld("desktopLive", {
  start: (req) => ipcRenderer.invoke("live-start", req),
  stop: (platform) => ipcRenderer.invoke("live-stop", platform),
  onEvent: (cb) => { ipcRenderer.removeAllListeners("live-event"); ipcRenderer.on("live-event", (_e, ev) => cb(ev)); },
});
contextBridge.exposeInMainWorld("desktopTP", {
  state: (base) => ipcRenderer.invoke("tp-state", base),
  action: (base, id, act) => ipcRenderer.invoke("tp-action", base, id, act),
  post: (base, v) => ipcRenderer.invoke("tp-post", base, v),
});
contextBridge.exposeInMainWorld("desktopApps", {
  list: () => ipcRenderer.invoke("apps-list"),
  status: (id) => ipcRenderer.invoke("apps-status", id),
  launch: (id) => ipcRenderer.invoke("apps-launch", id),
  openWeb: (id) => ipcRenderer.invoke("apps-web", id),
});
contextBridge.exposeInMainWorld("desktopSkills", {
  run: (id, params) => ipcRenderer.invoke("skill-run", id, params),
  cancel: (id) => ipcRenderer.invoke("skill-cancel", id),
  status: () => ipcRenderer.invoke("skill-status"),
  onEvent: (cb) => { ipcRenderer.removeAllListeners("skill-event"); ipcRenderer.on("skill-event", (_e, ev) => cb(ev)); },
});
