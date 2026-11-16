// Cầu nối tới Trạm Phim (LocalVideoTranslator) chạy trên chính máy này.
// Chỉ gọi 127.0.0.1/localhost, chỉ đúng 3 việc: xem trạng thái, bấm nút duyệt cho bài trong hàng đợi, đăng bài chữ/ảnh.
// Việc đăng luôn do trang gọi sau khi Giám đốc đã duyệt và bấm xác nhận; module này không tự đăng gì.
const http = require("http");

const BASE_RE = /^http:\/\/(127\.0\.0\.1|localhost):(\d{2,5})$/;
const ACTIONS = new Set(["ok", "sch", "now", "unsch", "skip", "retry"]); // không cho "force"/"lic": bài vướng bản quyền chỉ xử lý trong Trạm Phim
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

function base(b) {
  b = String(b || "http://127.0.0.1:8765").trim().replace(/\/+$/, "");
  if (!BASE_RE.test(b)) throw new Error("Địa chỉ Trạm Phim phải dạng http://127.0.0.1:8765");
  return b;
}

function call(b, method, path, body, timeout) {
  return new Promise((resolve) => {
    let u; try { u = new URL(base(b) + path); } catch (e) { return resolve({ ok: false, error: e.message }); }
    const data = body == null ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout,
      headers: { "X-LVT": "1", Accept: "application/json", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) } }, (res) => {
      const chunks = []; res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let j = null; const text = Buffer.concat(chunks).toString("utf8"); try { j = JSON.parse(text); } catch {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ ok: true, data: j });
        resolve({ ok: false, status: res.statusCode, error: clean((j && (j.error || j.message)) || text, 300) || "HTTP " + res.statusCode });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ ok: false, error: e.message === "timeout" ? "Trạm Phim không trả lời kịp" : /ECONNREFUSED|ENOTFOUND/.test(e.message) ? "Chưa mở Trạm Phim (LocalVideoTranslator) ở địa chỉ này" : clean(e.message, 160) }));
    if (data) req.write(data);
    req.end();
  });
}

// Chỉ giữ phần trang cần xem, bỏ token và đường dẫn tệp.
function slimState(s) {
  s = s || {}; const fb = s.facebook || {};
  const item = (i) => ({ id: i.id, status: i.status, status_label: i.status_label, title: clean(i.title || i.label, 120), series: clean(i.series, 60), episode: i.episode,
    post_type: i.post_type, when: clean(i.scheduled_text || "", 40), url: /^https?:\/\//.test(i.fb_url || "") ? i.fb_url : "", seo_score: i.seo_score, error: clean(i.error, 160) });
  return {
    page: { connected: !!fb.connected, name: clean(fb.page_name, 80), id: clean(fb.page_id, 30) },
    next_slot: clean(s.next_slot, 40), posted_24h: s.posted_24h | 0, reels_24h: s.reels_24h | 0, reels_limit: s.reels_limit | 0, dry_run: !!s.dry_run,
    items: (s.items || []).slice(0, 40).map(item),
    social: (s.social || []).slice(0, 20).map((r) => ({ at: r.at, kind: r.kind, message: clean(r.message, 120), source: clean(r.source, 40), status: r.status, error: clean(r.error, 160), dry_run: !!r.dry_run, url: /^https?:\/\//.test(r.url || "") ? r.url : "", publish_at: r.publish_at | 0 })),
  };
}

async function state(b) {
  const r = await call(b, "GET", "/api/tramphim", null, 15000);
  return r.ok ? { ok: true, state: slimState(r.data) } : r;
}
async function action(b, id, act) {
  id = Number(id); act = String(act);
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "Mã bài không hợp lệ" };
  if (!ACTIONS.has(act)) return { ok: false, error: "Thao tác không được phép từ Văn phòng AI" };
  const r = await call(b, "POST", `/api/tramphim/items/${id}/${act}`, {}, 30000);
  return r.ok ? { ok: true, message: clean(r.data && r.data.message, 300) } : r;
}
async function post(b, v) {
  v = v || {};
  const body = { message: String(v.message || "").slice(0, 5000), link: clean(v.link, 500), first_comment: String(v.first_comment || "").slice(0, 2000),
    publish_at: Number(v.publish_at) > 0 ? Math.floor(Number(v.publish_at)) : 0, source: clean(v.source, 60) || "Văn phòng AI" };
  if (v.image_base64) body.image_base64 = String(v.image_base64).slice(0, 12 * 1024 * 1024);
  const r = await call(b, "POST", "/api/tramphim/social", body, 240000);
  return r.ok ? { ok: true, entry: r.data && r.data.entry, dry_run: !!(r.data && r.data.dry_run) } : r;
}

module.exports = { state, action, post, base, slimState };
