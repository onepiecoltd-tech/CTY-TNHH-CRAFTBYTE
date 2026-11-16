// Kỹ năng chạy ngầm của Văn phòng AI (đầu não). Trang chỉ gửi {id kỹ năng, tham số}; main process tự quyết URL, đường dẫn và kiểm tra kiểu.
// Mỗi kỹ năng: { id, dept, title, validate(params) -> params sạch (hoặc ném lỗi), run(params, ctx) -> { title, markdown, data }, cancel() }.
"use strict";

const reg = new Map();
for (const file of ["./mst.js", "./crm.js", "./menh.js"]) {
  try { const m = require(file); reg.set(m.id, m); } catch (e) { if (e && e.code !== "MODULE_NOT_FOUND") console.error("skill", file, e.message); }
}

let seq = 0;
const active = new Map(); // runId -> { id, at }

async function run(id, params, send) {
  const s = reg.get(String(id));
  if (!s) return { ok: false, error: "Kỹ năng không có trong Văn phòng" };
  let p;
  try { p = s.validate ? s.validate(params && typeof params === "object" ? params : {}) : {}; }
  catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 200) }; }
  if (s.single && [...active.values()].some((x) => x.id === s.id)) return { ok: false, error: "Kỹ năng này đang chạy, đợi xong hoặc bấm dừng" };
  const runId = ++seq;
  active.set(runId, { id: s.id, at: Date.now() });
  const ctx = { progress: (message) => { try { send && send({ id: s.id, runId, message: String(message).slice(0, 200) }); } catch {} } };
  try { const r = await s.run(p, ctx); return { ok: true, id: s.id, dept: s.dept, ...r }; }
  catch (e) { return { ok: false, id: s.id, dept: s.dept, error: String((e && e.message) || e).slice(0, 300) }; }
  finally { active.delete(runId); }
}

function cancel(id) { const s = reg.get(String(id)); if (s && s.cancel) { try { s.cancel(); } catch {} return { ok: true }; } return { ok: false }; }
function status() { return { skills: [...reg.values()].map((s) => ({ id: s.id, dept: s.dept, title: s.title })), active: [...active.values()] }; }

module.exports = { run, cancel, status };
