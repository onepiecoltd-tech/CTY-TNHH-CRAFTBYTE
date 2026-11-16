// Bộ não "Claude Code (gói Pro)": gọi chương trình claude chính chủ đã cài trên máy anh, đăng nhập bằng tài khoản của chính anh.
// Ứng dụng KHÔNG đọc, không lưu, không chuyển tiếp thông tin đăng nhập: chỉ chạy lệnh `claude -p` và đọc câu trả lời.
const { spawn, execFile } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");
const fsp = require("fs/promises");

const WIN = process.platform === "win32";
const TIMEOUT = 15 * 60 * 1000;

function candidates() {
  const names = WIN ? ["claude.exe", "claude.cmd"] : ["claude"];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const home = os.homedir();
  dirs.push(path.join(home, ".local", "bin"));
  if (WIN) {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
  } else dirs.push("/usr/local/bin", "/opt/homebrew/bin");
  const out = [];
  for (const n of names) for (const d of dirs) out.push(path.join(d, n));
  return out;
}
let cached = null;
function findClaude() {
  if (process.env.VPAI_CLAUDE_BIN) return process.env.VPAI_CLAUDE_BIN; // chỉ dùng khi kiểm thử tự động
  if (cached && fs.existsSync(cached)) return cached;
  for (const c of candidates()) { try { if (fs.statSync(c).isFile()) return (cached = c); } catch {} }
  return null;
}

// Bỏ các biến môi trường làm Claude Code tính tiền API thay vì dùng gói đăng ký.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"]) delete env[k];
  if (!env.CLAUDE_CODE_MAX_OUTPUT_TOKENS) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = "32000";
  return env;
}

function run(bin, args, { input = "", timeout = TIMEOUT, cwd } = {}) {
  return new Promise((resolve) => {
    const isCmd = WIN && /\.(cmd|bat)$/i.test(bin);
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    let child;
    try {
      child = isCmd
        ? spawn([q(bin), ...args.map(q)].join(" "), { shell: true, cwd, env: cleanEnv(), windowsHide: true })
        : spawn(bin, args, { cwd, env: cleanEnv(), windowsHide: true });
    } catch (e) { return resolve({ code: -1, out: "", err: String(e.message), spawnError: e.code || "ERR" }); }
    let out = "", err = "", finished = false, timedOut = false;
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { if (err.length < 20000) err += d; });
    const kill = () => {
      if (WIN && child.pid) execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => {});
      else { try { child.kill("SIGKILL"); } catch {} }
    };
    const t = setTimeout(() => { if (!finished) { timedOut = true; kill(); } }, timeout);
    child.on("error", (e) => { if (finished) return; finished = true; clearTimeout(t); resolve({ code: -1, out, err: String(e.message), spawnError: e.code || "ERR" }); });
    child.on("close", (code) => { if (finished) return; finished = true; clearTimeout(t); resolve({ code, out, err, timedOut }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input, "utf8");
  });
}

function friendly(m) {
  m = String(m || "").trim();
  if (/not logged in|please run \/login|\/login|invalid api key|authenticat|unauthori[sz]ed|\b401\b|oauth token/i.test(m)) return "Claude Code chưa đăng nhập. Mở PowerShell, gõ claude rồi đăng nhập bằng tài khoản gói Pro của anh";
  if (/usage limit|limit reached|rate.?limit|\b429\b|quota|out of (extra )?usage/i.test(m)) return "gói Claude đang hết hạn mức tạm thời (giới hạn 5 giờ hoặc theo tuần), anh thử lại sau. Chi tiết: " + m.slice(0, 140);
  if (/overloaded|\b529\b/i.test(m)) return "máy chủ Claude đang quá tải, thử lại sau ít phút";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|fetch failed/i.test(m)) return "Claude Code không kết nối được mạng";
  return "Claude Code báo lỗi: " + (m.slice(0, 240) || "không rõ");
}

function parse(r) {
  if (r.timedOut) return { ok: false, error: "Claude Code chạy quá 15 phút nên đã dừng" };
  if (r.spawnError) return { ok: false, error: r.spawnError === "ENOENT" ? "không tìm thấy Claude Code trên máy" : "không chạy được Claude Code: " + r.err };
  const txt = (r.out || "").trim();
  let j = null;
  try { j = JSON.parse(txt); } catch {
    const lines = txt.split(/\r?\n/).reverse();
    for (const l of lines) { try { const v = JSON.parse(l); if (v && (v.type === "result" || "result" in v)) { j = v; break; } } catch {} }
  }
  if (Array.isArray(j)) j = j.slice().reverse().find((m) => m && m.type === "result") || null;
  if (!j) return { ok: false, error: friendly(r.err || txt || `thoát với mã ${r.code}`) };
  if (j.is_error || (j.subtype && j.subtype !== "success")) return { ok: false, error: friendly(j.result || (Array.isArray(j.errors) ? j.errors.join("; ") : "") || r.err || j.subtype) };
  return { ok: true, text: String(j.result || ""), usage: j.usage || null, ms: j.duration_ms || 0 };
}

let safeMode = true; // --safe-mode: không nạp CLAUDE.md, hook, plugin, MCP của máy để câu trả lời sạch. Bản cũ không có thì bỏ.
async function ask({ system, user, model } = {}) {
  const bin = findClaude();
  if (!bin) return { ok: false, error: "chưa cài Claude Code trên máy (xem hướng dẫn trong Cài đặt)" };
  const alias = /^[A-Za-z0-9][A-Za-z0-9.\-\[\]]{0,48}$/.test(String(model || "")) ? String(model) : "sonnet";
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "vpai-cc-"));
  const sp = path.join(dir, "he-thong.txt");
  await fsp.writeFile(sp, String(system || ""), "utf8");
  const base = ["-p", "--output-format", "json", "--model", alias, "--system-prompt-file", sp,
    "--tools", "", "--disallowedTools", "mcp__*", "--strict-mcp-config", "--no-session-persistence"];
  try {
    let r = await run(bin, safeMode ? [...base, "--safe-mode"] : base, { input: String(user || ""), cwd: dir });
    if (safeMode && r.code !== 0 && /unknown option|safe-mode/i.test(r.err + r.out)) {
      safeMode = false;
      r = await run(bin, base, { input: String(user || ""), cwd: dir });
    }
    return parse(r);
  } finally { fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function status() {
  const bin = findClaude();
  if (!bin) return { installed: false };
  const v = await run(bin, ["--version"], { timeout: 30000, cwd: os.tmpdir() });
  if (v.code !== 0) return { installed: false, bin, error: (v.err || v.out || "").trim().slice(0, 200) };
  const a = await run(bin, ["auth", "status"], { timeout: 30000, cwd: os.tmpdir() });
  let info = null;
  try { const s = a.out; info = JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1)); } catch {}
  const method = (info && info.authMethod) || (a.code === 0 ? "unknown" : "none");
  return {
    installed: true, bin, version: (v.out || "").trim().split(/\r?\n/)[0],
    loggedIn: a.code === 0 && method !== "none", method,
    subscription: method === "claude.ai" || method === "oauth_token",
  };
}

module.exports = { ask, status };
