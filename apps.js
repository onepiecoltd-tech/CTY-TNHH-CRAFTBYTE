// Sổ đăng ký ứng dụng: Văn phòng AI mở và theo dõi các dự án khác của Craftbyte trên chính máy này.
// An toàn: trang chỉ gửi id; đường dẫn exe và địa chỉ web luôn lấy từ apps.json do main process đọc.
// Chỉ mở file có trong sổ, chỉ ping 127.0.0.1/localhost. Không đọc .env, khoá hay dữ liệu của dự án khác.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const URL_RE = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const DEPTS = new Set(["finance", "hr", "mkt", "khdn", "khcn", "dvkh", "credit", "tech"]);
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

// Đường dẫn trong mặc định tính từ thư mục chứa apps.json (E:\CRAFTBYTE\VanPhongAI), nên ".." là E:\CRAFTBYTE.
const DEFAULTS = [
  { id: "tramphim", name: "Trạm Phim", dept: "mkt", exe: "..\\LocalVideoTranslator\\LocalVideoTranslator.exe", url: "http://127.0.0.1:8765", note: "Dịch phim, đăng Facebook cho Trạm Phim. Đã nối sâu qua tab Facebook." },
  { id: "crm", name: "BankRM AI (CRM)", dept: "khdn", exe: "..\\CRM\\CRM.exe", url: "http://127.0.0.1:8080", note: "CRM cho đội Khách hàng doanh nghiệp." },
  { id: "leadhunter", name: "Craftbyte Lead Hunter", dept: "khdn", exe: "..\\Craftbyte Lead Hunter\\Craftbyte Lead Hunter.exe", url: "", note: "Săn khách hàng tiềm năng." },
  { id: "menhly3d", name: "Mệnh Lý 3D", dept: "tech", exe: "..\\MenhLy3D\\MenhLy3D-1.6.0.exe", url: "", note: "Tử vi, bát tự, chiêm tinh, Kinh Dịch, tarot." },
  { id: "trashquarium", name: "TrashQuarium", dept: "tech", exe: "..\\TRASHQUARIUM\\trashquarium.exe", url: "", note: "Bể cá trên màn hình desktop." },
];

const dirOf = () => process.env.VPAI_APPS_DIR || process.env.PORTABLE_EXECUTABLE_DIR || path.join(os.homedir(), "VanPhongAI");
const fileOf = () => path.join(dirOf(), "apps.json");

function ensureFile() {
  const f = fileOf();
  if (!fs.existsSync(f)) {
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ apps: DEFAULTS }, null, 2), "utf8"); } catch {}
  }
  return f;
}

// Đọc và làm sạch: id lạ/trùng bị bỏ, địa chỉ ngoài loopback bị từ chối (urlRejected), phòng không hợp lệ về "tech".
function load() {
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(ensureFile(), "utf8")); } catch (e) { return { apps: [], error: "Không đọc được apps.json: " + clean(e.message, 120) }; }
  const arr = Array.isArray(raw) ? raw : raw && Array.isArray(raw.apps) ? raw.apps : [];
  const seen = new Set(), apps = [];
  for (const a of arr) {
    if (!a || typeof a !== "object" || !ID_RE.test(String(a.id || "")) || seen.has(a.id)) continue;
    seen.add(a.id);
    if (a.id === "buzzlingo" && /^Học tiếng Trung\. Cần build exe/.test(String(a.note || ""))) continue; // bản mặc định cũ của 1.7: BuzzLingo không còn trong danh sách
    const url = clean(a.url, 60).replace(/\/+$/, "");
    const exe = clean(a.exe, 400);
    apps.push({ id: a.id, name: clean(a.name || a.id, 60), dept: DEPTS.has(a.dept) ? a.dept : "tech", exe: exe ? path.resolve(dirOf(), exe) : "", url: URL_RE.test(url) ? url : "", urlRejected: !!url && !URL_RE.test(url), note: clean(a.note, 200) });
  }
  return { apps };
}

const children = new Map(); // id -> tiến trình do Văn phòng mở trong phiên này
const exeOk = (a) => {
  if (!a.exe) return false;
  if (process.platform === "win32" && !/\.exe$/i.test(a.exe)) return false;
  try { return fs.statSync(a.exe).isFile(); } catch { return false; }
};
const find = (id) => load().apps.find((a) => a.id === id);

function ping(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { return resolve(false); }
    if (!URL_RE.test(url)) return resolve(false);
    const req = http.request({ host: u.hostname, port: u.port, path: "/", method: "GET", timeout: 2000 }, (res) => { res.resume(); resolve(true); });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(false));
    req.end();
  });
}

// state: running | stopped | missing | unknown (không có địa chỉ web nên không biết ứng dụng mở sẵn từ ngoài hay chưa)
async function statusOf(a) {
  const base = { id: a.id, hasUrl: !!a.url };
  if (a.url && (await ping(a.url))) return { ...base, state: "running", label: "Đang chạy" };
  const ch = children.get(a.id);
  if (ch && ch.exitCode == null && !ch.killed) return { ...base, state: "running", label: "Đang chạy" };
  if (!exeOk(a)) return { ...base, state: "missing", label: "Không tìm thấy file" };
  return a.url ? { ...base, state: "stopped", label: "Chưa mở" } : { ...base, state: "unknown", label: "Chưa mở (không theo dõi được)" };
}

async function list() {
  const { apps, error } = load();
  const out = [];
  for (const a of apps) out.push({ id: a.id, name: a.name, dept: a.dept, url: a.url, urlRejected: a.urlRejected, note: a.note, ...(await statusOf(a)) });
  return { ok: true, apps: out, error: error || "", file: fileOf() };
}

async function status(id) {
  const a = find(String(id || ""));
  if (!a) return { ok: false, error: "Không có ứng dụng này trong apps.json" };
  return { ok: true, name: a.name, ...(await statusOf(a)) };
}

async function launch(id) {
  const a = find(String(id || ""));
  if (!a) return { ok: false, error: "Không có ứng dụng này trong apps.json" };
  const st = await statusOf(a);
  if (st.state === "running") return { ok: true, already: true, name: a.name, message: a.name + " đang chạy rồi" };
  if (!exeOk(a)) return { ok: false, name: a.name, error: "Không tìm thấy file: " + a.exe };
  try {
    const ch = spawn(a.exe, [], { cwd: path.dirname(a.exe), detached: true, stdio: "ignore", windowsHide: false, shell: false });
    ch.on("error", () => children.delete(a.id));
    ch.on("exit", () => children.delete(a.id));
    ch.unref();
    children.set(a.id, ch);
    return { ok: true, name: a.name, message: "Đã gửi lệnh mở " + a.name };
  } catch (e) { return { ok: false, name: a.name, error: clean(e.message, 160) }; }
}

async function openWeb(id) {
  const a = find(String(id || ""));
  if (!a) return { ok: false, error: "Không có ứng dụng này trong apps.json" };
  if (!a.url) return { ok: false, error: a.urlRejected ? "Địa chỉ web phải dạng http://127.0.0.1:cổng" : "Ứng dụng này không có trang web" };
  try { await require("electron").shell.openExternal(a.url); return { ok: true }; } catch (e) { return { ok: false, error: clean(e.message, 160) }; }
}

module.exports = { list, status, launch, openWeb, load, fileOf };
