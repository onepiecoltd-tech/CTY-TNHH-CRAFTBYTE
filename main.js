// Văn phòng AI - ứng dụng Windows (Electron).
// Nạp trang từ thư mục web/ qua giao thức app:// để thư viện 3D (ES module) chạy được khi không có mạng.
const { app, BrowserWindow, protocol, shell, ipcMain, net } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const cc = require("./cc");
const { makeLive } = require("./live");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const ROOT = path.join(__dirname, "web");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".glb": "model/gltf-binary", ".webp": "image/webp",
};

if (!app.requestSingleInstanceLock()) app.quit();
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 620,
    backgroundColor: "#05080c", title: "Văn phòng AI", autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  win.setMenuBarVisibility(false);
  // Link ngoài (lấy khoá API, GitHub) mở bằng trình duyệt mặc định, không mở trong ứng dụng.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("app://")) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  win.loadURL("app://local/index.html");
}

// Gọi AI từ tiến trình chính: không phụ thuộc CORS của nhà cung cấp, đi theo cấu hình mạng/proxy của Windows.
const AI_HOSTS = new Set(["api.openai.com", "generativelanguage.googleapis.com", "api.anthropic.com"]);
ipcMain.handle("ai-fetch", async (_e, { url, init }) => {
  const u = new URL(url);
  if (u.protocol !== "https:" || !AI_HOSTS.has(u.hostname)) throw new Error("Máy chủ không được phép: " + u.hostname);
  // VPAI_MOCK_URL: chỉ dùng khi kiểm thử tự động, chuyển lệnh gọi sang máy chủ giả lập.
  const target = process.env.VPAI_MOCK_URL ? process.env.VPAI_MOCK_URL + u.pathname : url;
  const r = await net.fetch(target, { method: init.method || "GET", headers: init.headers || {}, body: init.body });
  return { status: r.status, ok: r.ok, text: await r.text() };
});

// Sản phẩm do công ty AI làm ra: lưu vào thư mục "san-pham" cạnh file exe (bản chạy ngay),
// hoặc Tài liệu\VanPhongAI\san-pham khi chạy từ mã nguồn.
const productsBase = () => process.env.PORTABLE_EXECUTABLE_DIR
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "san-pham")
  : path.join(app.getPath("documents"), "VanPhongAI", "san-pham");
ipcMain.handle("save-product", async (_e, { slug, files }) => {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(slug))) throw new Error("Tên thư mục sản phẩm không hợp lệ");
  const dir = path.join(productsBase(), slug);
  await fs.mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files || {})) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(name)) continue;
    // Ảnh (Gemini vẽ) gửi sang dạng { b64 }, còn lại là chữ.
    if (content && typeof content === "object" && typeof content.b64 === "string") await fs.writeFile(path.join(dir, name), Buffer.from(content.b64, "base64"));
    else await fs.writeFile(path.join(dir, name), String(content ?? ""), "utf8");
  }
  return dir;
});
ipcMain.handle("open-path", async (_e, p) => {
  const base = path.resolve(productsBase()), full = path.resolve(String(p));
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error("Chỉ mở được trong thư mục sản phẩm");
  const err = await shell.openPath(full);
  if (err) throw new Error(err);
  return true;
});
ipcMain.handle("products-dir", () => productsBase());

// Bộ não Claude Code (gói Pro): chạy chương trình claude đã cài trên máy, đăng nhập bằng tài khoản của chính người dùng.
ipcMain.handle("cc-run", (_e, req) => cc.ask(req || {}));
ipcMain.handle("cc-status", () => cc.status());

// Livestream: đọc bình luận YouTube (API chính thức) và TikTok (thư viện không chính thức). Trang chỉ nhận sự kiện đã làm sạch.
const live = makeLive(
  (url) => net.fetch(url).then(async (r) => ({ ok: r.ok, status: r.status, text: () => r.text() })),
  (ev) => { if (win && !win.isDestroyed()) win.webContents.send("live-event", ev); }
);
ipcMain.handle("live-start", (_e, req) => live.start(req || {}));
ipcMain.handle("live-stop", (_e, platform) => { live.stop(String(platform)); return true; });
app.on("before-quit", () => live.stopAll());

// Trạm Phim (đăng Facebook): chỉ gọi 127.0.0.1, việc đăng do trang gọi sau khi Giám đốc duyệt.
const tp = require("./tp.js");
ipcMain.handle("tp-state", (_e, b) => tp.state(b));
ipcMain.handle("tp-action", (_e, b, id, act) => tp.action(b, id, act));
ipcMain.handle("tp-post", (_e, b, v) => tp.post(b, v));
const apps = require("./apps.js");
ipcMain.handle("apps-list", () => apps.list());
ipcMain.handle("apps-status", (_e, id) => apps.status(id));
ipcMain.handle("apps-launch", (_e, id) => apps.launch(id));
ipcMain.handle("apps-web", (_e, id) => apps.openWeb(id));
const skills = require("./skills");
ipcMain.handle("skill-run", (e, id, params) => skills.run(id, params, (ev) => { try { e.sender.send("skill-event", ev); } catch {} }));
ipcMain.handle("skill-cancel", (_e, id) => skills.cancel(id));
ipcMain.handle("skill-status", () => skills.status());

app.whenReady().then(() => {
  protocol.handle("app", async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === "/" || p === "") p = "/index.html";
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return new Response("Không tìm thấy", { status: 404 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" } });
    } catch { return new Response("Không tìm thấy", { status: 404 }); }
  });
  createWindow();
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("window-all-closed", () => app.quit());
