// Kỹ năng "Tra MST" (phòng Khách hàng doanh nghiệp). Port từ Craftbyte Lead Hunter (connector.js + mst.js), chỉ đọc dữ liệu công khai.
// Luồng: coccoc.com/search?query=<MST> -> hồ sơ masothue.com / tracuumasothue.com / yellowpages.vn khớp ĐÚNG MST;
// chưa có thì tìm bằng ô tìm kiếm của masothue.com. Gặp CAPTCHA/chặn thì DỪNG và hiện cửa sổ nguồn để Giám đốc tự xác minh, không tự vượt.
"use strict";
const fs = require("fs");
const path = require("path");
const { BrowserWindow, session } = require("electron");

const PARTITION = "persist:vpai-mst"; // tách khỏi ứng dụng: ứng dụng không bao giờ tải mã từ web
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/;
const TEST = LOOPBACK.test(process.env.VPAI_MST_TEST_ORIGIN || "") ? process.env.VPAI_MST_TEST_ORIGIN : ""; // chỉ để kiểm thử bằng máy chủ giả
const SEARCH = (TEST || "https://coccoc.com") + "/search?";
const MASOTHUE = TEST || "https://masothue.com";
const GAP_MS = Math.max(0, Number(process.env.VPAI_MST_GAP_MS) || 4000); // tối thiểu giữa hai lần mở trang
const TRIES = Math.max(4, Number(process.env.VPAI_MST_TRIES) || 120);   // 120 x 500ms = 60 giây
const MAX_CODES = 20;
const MST_RE = /^(\d{10}(-\d{3})?|\d{12})$/;

const PAGE_SRC = (() => { try { return fs.readFileSync(path.join(__dirname, "mst-page.js"), "utf8").replace("__TEST_ORIGIN__", JSON.stringify(TEST)); } catch { return ""; } })();
const TARGET_HOST = /(^|\.)(coccoc\.com|masothue\.com|tracuumasothue\.com|yellowpages\.vn)$/i;
const TRANSIENT = /Script failed to execute|Render frame was disposed|context is destroyed|frame was removed|Cannot access contents|ERR_ABORTED|WebFrameMain|is not defined|destroyed/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Blocked extends Error { constructor(message) { super(message); this.blocked = true; } }

let win = null, signal = null, stop = false, lastNav = 0, watching = false;

function watch() {
  if (watching) return; watching = true;
  session.fromPartition(PARTITION).webRequest.onCompleted((d) => {
    if (![403, 429, 503].includes(d.statusCode)) return;
    let host; try { host = new URL(d.url).hostname; } catch { return; }
    if (!(TARGET_HOST.test(host) || (TEST && new URL(TEST).hostname === host))) return;
    if (d.statusCode !== 429 && !["mainFrame", "subFrame"].includes(d.resourceType)) return;
    signal = { status: d.statusCode, host };
  });
}
function ensureWin() {
  if (win && !win.isDestroyed()) return win;
  watch();
  win = new BrowserWindow({ width: 1180, height: 820, show: false, autoHideMenuBar: true, title: "Văn phòng AI · nguồn tra MST",
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.on("closed", () => { win = null; });
  return win;
}
function closeWin() { if (win && !win.isDestroyed()) win.destroy(); win = null; }
function reveal() { if (win && !win.isDestroyed()) { win.show(); win.focus(); } }

// Mỗi lần mở trang cách lần trước tối thiểu GAP_MS.
async function navigate(url) {
  const w = ensureWin();
  const wait = lastNav + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  if (stop) throw new Error("Đã dừng");
  lastNav = Date.now();
  signal = null;
  await w.webContents.loadURL(url).catch(() => {});
}
function checkHttp() {
  if (!signal) return; const s = signal; signal = null;
  throw new Blocked(`${s.host} ${s.status === 403 ? "từ chối truy cập" : s.status === 503 ? "đang quá tải" : "đang giới hạn tốc độ"} (HTTP ${s.status}). Phiên đã dừng; thử lại sau.`);
}
async function command(action, taxCode) {
  const wc = win.webContents;
  const ready = await wc.executeJavaScript("typeof window.__plh_mst==='object'").catch(() => false);
  if (!ready) await wc.executeJavaScript(PAGE_SRC);
  return wc.executeJavaScript(`window.__plh_mst[${JSON.stringify(action)}](${JSON.stringify({ taxCode })})`);
}
// Trang render dần: chỉ nhận khi 4 lần đọc liên tiếp giống nhau.
async function stable(action, taxCode) {
  let prev = "", n = 0, lastUrl = "";
  for (let i = 0; i < TRIES; i++) {
    if (stop) throw new Error("Đã dừng");
    if (!win || win.isDestroyed()) throw new Error("Cửa sổ nguồn đã đóng");
    checkHttp();
    const url = win.webContents.getURL();
    if (url !== lastUrl) { prev = ""; n = 0; lastUrl = url; }
    if (!win.webContents.isLoadingMainFrame()) {
      let r;
      try { r = await command(action, taxCode); } catch (e) { checkHttp(); if (!TRANSIENT.test(String(e && e.message))) throw e; }
      if (r && r.blocked) throw new Blocked(r.blocked);
      if (r && !r.pending) {
        const { checkedAt, ...rest } = r; const stamp = JSON.stringify(rest);
        n = stamp === prev ? n + 1 : 1; prev = stamp;
        if (n >= 4) return r;
      }
    }
    await sleep(500);
  }
  throw new Error(`Chưa đọc được ${action === "search" ? "kết quả Cốc Cốc" : "hồ sơ doanh nghiệp"} cho MST ${taxCode} sau ${Math.round(TRIES / 2)} giây`);
}
async function openByForm(taxCode) {
  await navigate(MASOTHUE + "/");
  let sub = null;
  for (let n = 0; n < Math.min(20, TRIES) && !(sub && sub.submitted); n++) {
    if (stop) throw new Error("Đã dừng");
    checkHttp();
    if (!win.webContents.isLoadingMainFrame()) {
      const gap = lastNav + GAP_MS - Date.now(); if (gap > 0) await sleep(gap); // gửi form cũng là một lần mở trang: cách lần trước tối thiểu GAP_MS
      try { sub = await command("formSearch", taxCode); } catch (e) { if (!TRANSIENT.test(String(e && e.message))) throw e; }
      if (sub && sub.blocked) throw new Blocked(sub.blocked);
    }
    await sleep(500);
  }
  if (!(sub && sub.submitted)) return false;
  lastNav = Date.now();
  for (let n = 0; n < Math.min(40, TRIES); n++) {
    if (stop) throw new Error("Đã dừng");
    checkHttp();
    let moved = false; try { moved = new URL(win.webContents.getURL()).pathname !== "/"; } catch {}
    if (moved && !win.webContents.isLoadingMainFrame()) return true;
    await sleep(500);
  }
  return false;
}

// Chỉ nhận hồ sơ khớp đúng MST và có tên; lệch thì bỏ.
function merge(res, taxCode, p) {
  if (!p || p.taxCode !== taxCode || !p.name) return false;
  if (!res.name) res.name = p.name;
  if (!res.operatingStatus && p.operatingStatus) res.operatingStatus = p.operatingStatus;
  for (const k of ["address", "representative", "phone", "industry"]) if (!res[k] && p[k]) res[k] = p[k];
  if (!res.industries && p.industries) res.industries = p.industries;
  if (!res.sources.includes(p.sourceURL)) res.sources.push(p.sourceURL);
  res.status = "Khớp MST";
  return true;
}
const profileOk = (u, code) => { try { const x = new URL(u); return (TEST && x.origin === TEST) || (x.protocol === "https:" && /(^|\.)(masothue\.com|tracuumasothue\.com|yellowpages\.vn)$/.test(x.hostname)); } catch { return false; } };

async function lookup(taxCode, ctx, direct) {
  const res = { taxCode, status: "Không tìm thấy hồ sơ khớp MST", name: "", address: "", representative: "", phone: "", industry: "", industries: "", operatingStatus: "", sources: [], checkedAt: new Date().toISOString() };
  let urls = [];
  if (direct && profileOk(direct, taxCode)) urls = [direct]; // đã có link hồ sơ từ bước tra theo tên: mở thẳng
  else {
    ctx.progress(`MST ${taxCode}: tìm trên Cốc Cốc`);
    await navigate(SEARCH + new URLSearchParams({ query: taxCode }));
    let found = null;
    try { found = await stable("search", taxCode); } catch (e) { if (stop || e.blocked) throw e; }
    urls = ((found && found.urls) || []).filter((u) => profileOk(u, taxCode));
  }
  for (const url of urls) {
    if (stop) throw new Error("Đã dừng");
    ctx.progress(`MST ${taxCode}: đọc ${new URL(url).hostname}`);
    await navigate(url);
    let p; try { p = await stable("profile", taxCode); } catch (e) { if (stop || e.blocked) throw e; continue; }
    if (!merge(res, taxCode, p)) continue;
    if (res.address && res.representative && res.phone && res.operatingStatus) break;
  }
  if (res.status !== "Khớp MST") {
    ctx.progress(`MST ${taxCode}: tìm trên Mã Số Thuế`);
    let opened = false; try { opened = await openByForm(taxCode); } catch (e) { if (stop || e.blocked) throw e; }
    if (opened) { let p = null; try { p = await stable("profile", taxCode); } catch (e) { if (stop || e.blocked) throw e; } merge(res, taxCode, p); }
  }
  return res;
}


const slugOf = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Tên -> MST: chỉ nhận hồ sơ có tên (dạng slug) trùng tuyệt đối; còn lại chỉ gợi ý để Giám đốc tự chọn bằng MST.
async function lookupByName(name, ctx) {
  const res = { requested: name, taxCode: "", status: "Không tìm thấy hồ sơ trùng tên", name: "", address: "", representative: "", phone: "", industry: "", industries: "", operatingStatus: "", sources: [], suggestions: [], checkedAt: new Date().toISOString() };
  const want = slugOf(name);
  ctx.progress(`"${name}": tìm trên Cốc Cốc`);
  await navigate(SEARCH + new URLSearchParams({ query: name + " mã số thuế" }));
  let found = null;
  try { found = await stable("nameSearch", ""); } catch (e) { if (stop || e.blocked) throw e; }
  const cands = (found && found.candidates) || [];
  const exact = cands.filter((c) => c.slug === want);
  res.suggestions = cands.filter((c) => c.slug !== want && (c.slug.includes(want) || want.includes(c.slug))).slice(0, 5).map((c) => ({ taxCode: c.mst, slug: c.slug }));
  const mstSet = [...new Set(exact.map((c) => c.mst))];
  if (mstSet.length > 1) { res.status = "Nhiều hồ sơ trùng tên"; res.suggestions = mstSet.map((m) => ({ taxCode: m, slug: want })); return res; }
  if (mstSet.length === 0) return res;
  const r = await lookup(mstSet[0], ctx, (exact.find((c) => c.mst === mstSet[0]) || {}).url);
  if (r.status !== "Khớp MST") { res.status = "Tìm thấy MST " + mstSet[0] + " nhưng chưa đọc được hồ sơ"; res.taxCode = mstSet[0]; return res; }
  if (slugOf(r.name) !== want) { res.status = "Hồ sơ đọc được có tên khác"; res.taxCode = r.taxCode; res.suggestions = [{ taxCode: r.taxCode, slug: slugOf(r.name), name: r.name }]; return res; }
  return { ...r, requested: name };
}

const esc = (s) => String(s || "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
function card(r) {
  if (r.requested && r.status !== "Khớp MST") {
    const sg = (r.suggestions || []).map((x) => `- MST ${x.taxCode}${x.name ? " (" + esc(x.name) + ")" : ""}: ${x.slug}`).join("\n");
    return `### "${esc(r.requested)}"\n${r.status}. Em không đoán thông tin.${sg ? "\nCó thể là một trong các hồ sơ sau, anh nhắn mã số thuế để em tra chính xác:\n" + sg : ""}`;
  }
  if (r.status !== "Khớp MST") return `### MST ${r.taxCode}\nKhông tìm thấy hồ sơ khớp MST trên Cốc Cốc và Mã Số Thuế. Có thể chưa có hồ sơ công khai hoặc MST sai; không đoán thông tin.`;
  return [`### ${r.name}`, `- **MST:** ${r.taxCode}`, `- **Tình trạng:** ${esc(r.operatingStatus) || "chưa đọc được"}`, `- **Địa chỉ:** ${esc(r.address) || "chưa đọc được"}`,
    `- **Người đại diện:** ${esc(r.representative) || "chưa đọc được"}`, `- **Điện thoại:** ${esc(r.phone) || "không công khai"}`, `- **Ngành chính:** ${esc(r.industry) || "chưa đọc được"}`,
    `- **Nguồn:** ${r.sources.join(" · ")}`, `- **Tra lúc:** ${new Date(r.checkedAt).toLocaleString("vi-VN")}`].join("\n");
}

module.exports = {
  id: "mst", dept: "khdn", title: "Tra cứu mã số thuế", single: true,
  validate(p) {
    const codes = [...new Set((Array.isArray(p.codes) ? p.codes : []).map((c) => String(c).trim()))];
    const names = [...new Set((Array.isArray(p.names) ? p.names : []).map((c) => String(c).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)).filter((c) => c.length >= 4))].slice(0, 5);
    if (!codes.length && !names.length) throw new Error("Chưa có mã số thuế hoặc tên doanh nghiệp");
    if (codes.length + names.length > MAX_CODES) throw new Error(`Mỗi lệnh tra tối đa ${MAX_CODES} mã số thuế`);
    const bad = codes.find((c) => !MST_RE.test(c)); if (bad) throw new Error(`"${String(bad).slice(0, 20)}" không phải mã số thuế (10 số, 10 số-3 số, hoặc 12 số)`);
    if (!PAGE_SRC) throw new Error("Thiếu mst-page.js trong bản cài");
    return { codes, names };
  },
  async run(p, ctx) {
    stop = false; const results = []; let blockedMsg = "";
    const jobs = [...p.codes.map((c) => ({ code: c, label: c })), ...(p.names || []).map((n) => ({ name: n, label: `"${n}"` }))];
    try {
      for (const j of jobs) {
        if (stop) break;
        try { results.push(j.code ? await lookup(j.code, ctx) : await lookupByName(j.name, ctx)); }
        catch (e) { if (e.blocked) { blockedMsg = e.message; reveal(); break; } if (stop) break; results.push({ taxCode: j.code || "", requested: j.name, status: "Lỗi: " + String(e.message).slice(0, 120), sources: [], checkedAt: new Date().toISOString() }); }
      }
    } finally { if (!blockedMsg) closeWin(); }
    const left = jobs.slice(results.length).map((j) => j.label);
    const md = results.map((r) => (r.status === "Khớp MST" || r.requested && !/^Lỗi/.test(r.status) || /^Không/.test(r.status)) ? card(r) : `### ${r.requested ? '"' + r.requested + '"' : "MST " + r.taxCode}\n${r.status}`).join("\n\n")
      + (blockedMsg ? `\n\n> ⚠ **Đã dừng:** ${blockedMsg} Em đã mở cửa sổ nguồn: anh xác minh/CAPTCHA ở đó rồi nhắn lại để tra tiếp.${left.length ? ` Còn chưa tra: ${left.join(", ")}.` : ""}` : stop ? `\n\n> Đã dừng theo lệnh. Chưa tra: ${left.join(", ")}.` : "");
    return { title: results.length === 1 && results[0].name ? "Tra MST: " + results[0].name : `Tra MST (${results.length}/${jobs.length})`, markdown: md, data: { results, blocked: blockedMsg || "", left } };
  },
  cancel() { stop = true; },
};
