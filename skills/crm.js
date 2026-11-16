// Kỹ năng CRM (BankRM AI) cho phòng Khách hàng doanh nghiệp: đọc dữ liệu CRM và lưu khách mới sau khi Giám đốc xác nhận hai bước.
// An toàn: chỉ gọi http://127.0.0.1|localhost:<cổng>; chỉ một danh sách (phương thức + đường dẫn) cố định; token lưu bằng Electron safeStorage,
// không lưu mật khẩu, không đưa token ra trang. Không bao giờ gọi send-batch, delete, admin/* hay endpoint gửi tin.
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { app, safeStorage } = require("electron");

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;
const DEFAULT_URL = "http://127.0.0.1:8000";
const MST_RE = /^\d{10}(-\d{3})?$/; // CRM chỉ nhận 10 số hoặc 10 số-3 số (không nhận 12 số)
const ALLOW = [
  ["POST", /^\/api\/auth\/login$/],
  ["GET", /^\/api\/auth\/me$/],
  ["GET", /^\/api\/corp\/customers$/],
  ["GET", /^\/api\/corp\/customers\/[A-Za-z0-9_-]{1,20}$/],
  ["GET", /^\/api\/corp\/signals$/],
  ["GET", /^\/api\/corp\/followups\/due$/],
  ["GET", /^\/api\/corp\/kpis$/],
  ["POST", /^\/api\/corp\/customers$/], // chỉ khi có mã xác nhận hợp lệ (xem save)
];
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

const authFile = () => path.join(app.getPath("userData"), "crm-auth.json");
let mem = { url: DEFAULT_URL, user: "", token: "", name: "" }; // token luôn nằm trong bộ nhớ; ghi ra đĩa chỉ khi mã hoá được
let loaded = false;
function loadAuth() {
  if (loaded) return; loaded = true;
  try {
    const j = JSON.parse(fs.readFileSync(authFile(), "utf8"));
    if (LOOPBACK.test(j.url || "")) mem.url = j.url;
    mem.user = clean(j.user, 60); mem.name = clean(j.name, 80);
    if (j.token && safeStorage.isEncryptionAvailable()) mem.token = safeStorage.decryptString(Buffer.from(j.token, "base64"));
  } catch {}
}
function saveAuth() {
  try {
    const out = { url: mem.url, user: mem.user, name: mem.name };
    if (mem.token && safeStorage.isEncryptionAvailable()) out.token = safeStorage.encryptString(mem.token).toString("base64");
    fs.mkdirSync(path.dirname(authFile()), { recursive: true });
    fs.writeFileSync(authFile(), JSON.stringify(out), "utf8");
  } catch {}
}

function call(method, p, { query, body, auth = true } = {}) {
  return new Promise((resolve) => {
    if (!ALLOW.some(([m, re]) => m === method && re.test(p))) return resolve({ ok: false, error: "Đường dẫn CRM không được phép" });
    if (!LOOPBACK.test(mem.url)) return resolve({ ok: false, error: "Địa chỉ CRM phải dạng http://127.0.0.1:cổng" });
    let u; try { u = new URL(mem.url + p + (query ? "?" + new URLSearchParams(query) : "")); } catch { return resolve({ ok: false, error: "Địa chỉ CRM không hợp lệ" }); }
    const data = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const headers = { Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) };
    if (auth && mem.token) headers.Authorization = "Bearer " + mem.token;
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 8000, headers }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8"); let j = null; try { j = JSON.parse(text); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ ok: true, data: j });
        const d = j && (j.detail || j.error || j.message);
        resolve({ ok: false, status: res.statusCode, error: clean(typeof d === "string" ? d : JSON.stringify(d || text), 200) || "HTTP " + res.statusCode });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ ok: false, down: /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(e.message), error: e.message === "timeout" ? "CRM không trả lời kịp" : /ECONNREFUSED|ENOTFOUND/.test(e.message) ? `CRM chưa mở ở ${mem.url} (mở CRM rồi nhắn lại)` : clean(e.message, 120) }));
    if (data) req.write(data);
    req.end();
  });
}

// Lý do không dùng được CRM, nói đúng nguyên nhân.
function why(r) {
  if (r.down) return r.error;
  if (r.status === 401) { mem.token = ""; saveAuth(); return "Phiên đăng nhập CRM đã hết hạn. Anh đăng nhập lại ở Cài đặt → CRM."; }
  return r.error || "CRM trả lỗi";
}
const needLogin = () => { loadAuth(); return mem.token ? null : "Chưa đăng nhập CRM. Anh đăng nhập một lần ở Cài đặt → CRM (Văn phòng chỉ giữ token, không lưu mật khẩu)"; };

// Mã xác nhận một lần cho thao tác ghi: prepare tạo, save dùng và huỷ. Hết hạn sau 2 phút.
const armed = new Map();
function arm(rec) { const nonce = crypto.randomBytes(12).toString("hex"); armed.set(nonce, { rec, at: Date.now() }); for (const [k, v] of armed) if (Date.now() - v.at > 120000) armed.delete(k); return nonce; }

const money = (v) => (v == null ? "—" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: 1 }));
const SAFE = (s) => String(s == null ? "" : s).replace(/\|/g, "/").replace(/\s+/g, " ").trim();

const ACTIONS = new Set(["status", "login", "logout", "find", "signals", "followups", "kpi", "check", "prepare", "save"]);
module.exports = {
  id: "crm", dept: "khdn", title: "CRM BankRM AI",
  validate(p) {
    const a = String(p.action || ""); if (!ACTIONS.has(a)) throw new Error("Thao tác CRM không hợp lệ");
    const o = { action: a };
    if (a === "login") {
      o.url = clean(p.url, 40).replace(/\/+$/, "") || DEFAULT_URL; if (!LOOPBACK.test(o.url)) throw new Error("Địa chỉ CRM phải dạng http://127.0.0.1:8000");
      o.username = clean(p.username, 60); o.password = String(p.password == null ? "" : p.password).slice(0, 200);
      if (!o.username || !o.password) throw new Error("Nhập tài khoản và mật khẩu CRM");
    }
    if (a === "find") { o.q = clean(p.q, 80); if (o.q.length < 2) throw new Error("Nhập tên hoặc MST khách cần tìm"); }
    if (a === "check") {
      o.codes = [...new Set((Array.isArray(p.codes) ? p.codes : []).map((c) => clean(c, 20)))].slice(0, 20);
      if (!o.codes.length) throw new Error("Chưa có MST để đối chiếu");
    }
    if (a === "prepare") {
      o.name = clean(p.name, 200); o.taxCode = clean(p.taxCode, 20); o.representative = clean(p.representative, 80); o.phone = clean(p.phone, 40);
      if (o.name.length < 2) throw new Error("Thiếu tên doanh nghiệp"); if (!MST_RE.test(o.taxCode)) throw new Error("CRM chỉ nhận MST 10 số (hoặc 10 số-3 số); mã này không lưu được vào CRM");
    }
    if (a === "save") { o.nonce = clean(p.nonce, 40); if (!/^[a-f0-9]{24}$/.test(o.nonce)) throw new Error("Thiếu mã xác nhận lưu CRM"); }
    return o;
  },
  async run(p, ctx) {
    loadAuth();
    if (p.action === "login") {
      mem.url = p.url;
      const r = await call("POST", "/api/auth/login", { body: { username: p.username, password: p.password }, auth: false });
      p.password = "";
      if (!r.ok) throw new Error(r.status === 401 || r.status === 429 ? r.error : why(r));
      mem.token = clean(r.data && r.data.token, 400); mem.user = p.username; mem.name = clean(r.data && r.data.user && (r.data.user.full_name || r.data.user.username), 80);
      saveAuth();
      return { title: "Đã đăng nhập CRM", markdown: `Đã đăng nhập CRM (${mem.url}) với tài khoản **${SAFE(mem.name || mem.user)}**.`, data: { loggedIn: true, user: mem.name || mem.user, url: mem.url, persisted: safeStorage.isEncryptionAvailable() } };
    }
    if (p.action === "logout") { mem.token = ""; mem.name = ""; saveAuth(); return { title: "Đã đăng xuất CRM", markdown: "Đã xoá phiên đăng nhập CRM trên máy.", data: { loggedIn: false } }; }
    if (p.action === "status") {
      const out = { url: mem.url, user: mem.user, loggedIn: !!mem.token, up: false, reason: "" };
      if (!mem.token) { const r = await call("GET", "/api/auth/me", { auth: false }); out.up = r.ok || !r.down; out.reason = out.up ? "Chưa đăng nhập CRM" : r.error; }
      else { const r = await call("GET", "/api/auth/me"); out.up = r.ok || (!r.down && r.status === 401); if (!r.ok) out.reason = why(r), out.loggedIn = !!mem.token; else out.name = clean(r.data && (r.data.full_name || r.data.username), 80); }
      return { title: "Trạng thái CRM", markdown: out.reason ? `CRM: ${out.reason}` : `CRM đang chạy, đã đăng nhập (${SAFE(out.name || mem.user)}).`, data: out };
    }
    const nl = needLogin(); if (nl && p.action !== "status") { const err = new Error(nl); err.code = "NO_LOGIN"; throw err; }

    if (p.action === "find") {
      ctx.progress("Tìm trong CRM: " + p.q);
      const r = await call("GET", "/api/corp/customers", { query: { q: p.q, limit: "5" } }); if (!r.ok) throw new Error(why(r));
      const items = (r.data && r.data.items) || [];
      if (!items.length) return { title: "CRM: " + p.q, markdown: `Không có khách nào khớp "${SAFE(p.q)}" trong CRM.`, data: { items: [] } };
      const md = items.map((c) => `### ${SAFE(c.name)} (${c.customer_id})\n- **Loại khách:** ${c.lifecycle === "existing" ? "hiện hữu" : "tiềm năng"} · ${SAFE(c.segment)} · ${SAFE(c.ownership)}\n- **Ngành / tỉnh:** ${SAFE(c.industry)} · ${SAFE(c.province)}\n- **Doanh thu / dư nợ (tỷ):** ${money(c.annual_revenue_bn)} / ${money(c.loan_outstanding_bn)}\n- **Cán bộ phụ trách:** ${SAFE(c.rm_name) || "chưa phân"} · liên hệ: ${SAFE(c.contact_name) || "—"}\n- **Gợi ý:** ${SAFE(c.next_best_action) || SAFE(c.headline) || "—"}`).join("\n\n");
      return { title: "CRM: " + p.q, markdown: md, data: { items: items.map((c) => ({ id: c.customer_id, name: c.name })) } };
    }
    if (p.action === "check") {
      const found = {};
      for (const code of p.codes) {
        if (!MST_RE.test(code)) { found[code] = { skip: "CRM không nhận mã này" }; continue; }
        const r = await call("GET", "/api/corp/customers", { query: { q: code, limit: "5" } }); if (!r.ok) throw new Error(why(r));
        for (const it of ((r.data && r.data.items) || []).slice(0, 3)) {
          const d = await call("GET", "/api/corp/customers/" + encodeURIComponent(it.customer_id)); if (!d.ok) throw new Error(why(d));
          if (d.data && d.data.customer && d.data.customer.tax_code === code) { found[code] = { id: it.customer_id, name: it.name, rm: it.rm_name || "" }; break; }
        }
      }
      return { title: "Đối chiếu CRM", markdown: p.codes.map((c) => found[c] && found[c].id ? `- ${c}: đã có trong CRM (${SAFE(found[c].name)}, ${found[c].id})` : `- ${c}: chưa có trong CRM`).join("\n"), data: { found } };
    }
    if (p.action === "signals") {
      const r = await call("GET", "/api/corp/signals", { query: { limit: "5" } }); if (!r.ok) throw new Error(why(r));
      const G = { limit_expiry: "Hạn mức sắp hết hạn", inflow_drop: "Doanh số giảm", debt: "Nợ nhóm ≥ 2", high_util: "Sử dụng hạn mức cao", casa_drop: "CASA giảm" };
      const d = r.data || {}, parts = []; let total = 0;
      for (const [k, label] of Object.entries(G)) { const g = d[k]; if (!g || !g.count) continue; total += g.count; parts.push(`**${label}** (${g.count})\n` + (g.items || []).map((x) => `- ${SAFE(x.name)}: ${SAFE(x.text).slice(0, 160)}`).join("\n")); }
      return { title: "CRM: việc cần làm hôm nay", markdown: parts.length ? parts.join("\n\n") : "Hôm nay CRM chưa có tín hiệu cần xử lý.", data: { total } };
    }
    if (p.action === "followups") {
      const r = await call("GET", "/api/corp/followups/due"); if (!r.ok) throw new Error(why(r));
      const items = (r.data && r.data.items) || [];
      return { title: "CRM: khách cần follow", markdown: items.length ? `Có ${r.data.total} khách cần follow:\n` + items.slice(0, 10).map((x) => `- **${SAFE(x.name)}**: đã ${x.days} ngày chưa phản hồi (nhắc lần ${x.step} ngày)`).join("\n") : "Hôm nay không có khách nào cần follow.", data: { total: (r.data && r.data.total) || 0 } };
    }
    if (p.action === "kpi") {
      const r = await call("GET", "/api/corp/kpis"); if (!r.ok) throw new Error(why(r)); const k = r.data || {};
      return { title: "KPI CRM", markdown: [`- **Tổng khách:** ${k.total} (tiềm năng ${k.prospects}, hiện hữu ${k.existing}, FDI ${k.fdi})`, `- **Dư nợ:** ${money(k.loans_bn)} tỷ · **CASA:** ${money(k.casa_bn)} tỷ · **Huy động:** ${money(k.deposit_bn)} tỷ`, `- **Pipeline:** ${k.pipeline_count} cơ hội, ${money(k.pipeline_value_bn)} tỷ (có trọng số ${money(k.pipeline_weighted_bn)} tỷ)`].join("\n"), data: { total: k.total } };
    }
    if (p.action === "prepare") {
      // Chưa ghi gì: chỉ chuẩn bị bản ghi và cấp mã xác nhận một lần.
      const phone = (p.phone.split(/[;,]/)[0] || "").replace(/[^\d+]/g, ""), rec = { name: p.name, tax_code: p.taxCode, contact_name: p.representative || null, contact_phone: /^\+?\d{8,13}$/.test(phone) ? phone : null, lifecycle: "prospect" };
      return { title: "Chuẩn bị lưu CRM", markdown: `Sẽ tạo khách **${SAFE(rec.name)}** (MST ${rec.tax_code}, loại: tiềm năng)${rec.contact_name ? `, liên hệ ${SAFE(rec.contact_name)}` : ""}${rec.contact_phone ? ` ${rec.contact_phone}` : ""}.`, data: { nonce: arm(rec), record: rec } };
    }
    if (p.action === "save") {
      const a = armed.get(p.nonce); armed.delete(p.nonce);
      if (!a || Date.now() - a.at > 120000) throw new Error("Mã xác nhận đã hết hạn. Anh bấm 'Lưu vào CRM' lại.");
      ctx.progress("Ghi khách vào CRM");
      const r = await call("POST", "/api/corp/customers", { body: a.rec });
      if (!r.ok) throw new Error(r.status === 409 ? "Mã số thuế này đã có trong CRM" : why(r));
      return { title: "Đã lưu vào CRM", markdown: `Đã lưu **${SAFE(a.rec.name)}** vào CRM với mã ${SAFE(r.data && r.data.customer_id)}.`, data: { id: r.data && r.data.customer_id } };
    }
    throw new Error("Thao tác CRM không hợp lệ");
  },
};
