// Kỹ năng Mệnh lý: tính số liệu bát tự / tử vi / gieo quẻ / tarot bằng menh-engine (đã gói thành menh.bundle.js).
// Chỉ tính toán trên máy, không gọi mạng. Phần luận giải do AI của Văn phòng viết trên JSON này ở phía trang.
const path = require("path");
let eng = null;
function engine() { if (!eng) eng = require(path.join(__dirname, "menh.bundle.js")); return eng; }
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const KINDS = new Set(["batu", "tuvi", "hoso", "que", "tarot"]);
const SPREADS = new Set(["mot-la", "ba-la", "tinh-huong", "celtic-cross"]);

function birth(p) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(clean(p.date, 12)), t = /^(\d{1,2}):(\d{2})$/.exec(clean(p.time, 6));
  if (!m || !t) throw new Error("Cần ngày giờ sinh dương lịch dạng 1990-05-15 14:30");
  const nam = +m[1], thang = +m[2], ngay = +m[3], gio = +t[1], phut = +t[2];
  const dim = new Date(nam, thang, 0).getDate();
  if (nam < 1900 || nam > 2100 || thang < 1 || thang > 12 || ngay < 1 || ngay > dim || gio > 23 || phut > 59) throw new Error("Ngày giờ sinh không hợp lệ");
  if (!["nam", "nu"].includes(p.gender)) throw new Error("Cần giới tính nam hoặc nữ");
  const tz = p.tz == null ? 7 : Number(p.tz); if (!(tz >= -12 && tz <= 14)) throw new Error("Múi giờ không hợp lệ");
  return { nam, thang, ngay, gio, phut, gioiTinh: p.gender, muiGio: tz };
}

const fmt = (s) => `${String(s.ngay).padStart(2, "0")}/${String(s.thang).padStart(2, "0")}/${s.nam} ${String(s.gio).padStart(2, "0")}:${String(s.phut).padStart(2, "0")} (${s.gioiTinh === "nam" ? "nam" : "nữ"})`;
function mdBatTu(b) {
  const T = b.tuTru, o = b.nguHanh, dv = (b.daiVan && b.daiVan.danhSach) || [];
  return [`**Bát tự** · Nhật chủ ${b.nhatChu.can} (${b.nhatChu.hanh}, ${b.nhatChu.amDuong}) · tiết khí ${b.tietKhi}`,
    `| Trụ | Năm | Tháng | Ngày | Giờ |\n|---|---|---|---|---|\n| Can chi | ${T.nam.ten} | ${T.thang.ten} | ${T.ngay.ten} | ${T.gio.ten} |`,
    `- **Ngũ hành:** ${Object.entries(o).map(([k, v]) => k + " " + v).join(" · ")}${b.hanhThieu && b.hanhThieu.length ? " · thiếu " + b.hanhThieu.join(", ") : ""}`,
    dv.length ? `- **Đại vận:** ` + dv.slice(0, 5).map((d) => `${d.tuoiBatDau}-${d.tuoiKetThuc} tuổi ${d.canChi}`).join(" · ") : ""].filter(Boolean).join("\n");
}
function mdTuVi(t) {
  const g = (c) => (c.chinhTinh || []).map((s) => s.ten).join(", ") || "vô chính diệu";
  const cm = t.cung.find((c) => c.ten === "Mệnh"), th = t.cung.find((c) => c.laCungThan);
  return [`**Tử vi** · ${t.amDuong}, ${t.thuanNghich} · bản mệnh ${t.banMenh} · ${t.cuc} · giờ ${String(t.gioSinh).replace(/^giờ /, "")}`,
    `- **Âm lịch:** ${t.amLich.ngay}/${t.amLich.thang}/${t.amLich.nam}${t.amLich.nhuan ? " (nhuận)" : ""} · năm ${t.amLich.canChiNam}`,
    `- **Cung Mệnh** (${t.cungMenhTai}): ${cm ? g(cm) : "—"} · **Thân** cư ${t.thanCu}${th ? ": " + g(th) : ""}`,
    `- **Mệnh chủ:** ${t.menhChu} · **Thân chủ:** ${t.thanChu}`].join("\n");
}
function mdQue(q) {
  return [`**Gieo quẻ** · ${q.cauHoi ? "câu hỏi: " + q.cauHoi : "không nêu câu hỏi"} (${q.phuongPhap})`,
    `- **Quẻ chủ:** ${q.queChu.ten} (số ${q.queChu.so}, ${q.queChu.thuongQuai} trên ${q.queChu.haQuai} dưới)`,
    q.queBien ? `- **Quẻ biến:** ${q.queBien.ten} (số ${q.queBien.so}) · hào động: ${(q.haoDong || []).join(", ")}` : "- Không có hào động.",
    q.loiQue && q.loiQue.daCoNguyenVan ? "- Đã có nguyên văn lời quẻ, lời hào." : "- Chưa có nguyên văn lời quẻ cho quẻ này; luận giải phải nói rõ."].join("\n");
}
function mdTarot(r) {
  return [`**Tarot** · trải ${r.kieuTrai}${r.cauHoi ? " · câu hỏi: " + r.cauHoi : ""}`, ...r.cacLa.map((c) => `- **${c.viTri}:** ${c.la.ten} (${c.la.tenAnh})${c.nguoc ? " — ngược" : ""}`)].join("\n");
}

module.exports = {
  id: "menh", dept: "tech", title: "Mệnh lý (bát tự, tử vi, quẻ, tarot)",
  validate(p) {
    const kind = String(p.kind || ""); if (!KINDS.has(kind)) throw new Error("Loại xem mệnh lý không hợp lệ");
    const o = { kind };
    if (kind === "batu" || kind === "tuvi" || kind === "hoso") o.sinh = birth(p);
    if (kind === "que") { o.method = p.method === "maihoa" ? "maihoa" : "xu"; o.question = clean(p.question, 200); }
    if (kind === "tarot") { o.spread = SPREADS.has(p.spread) ? p.spread : "ba-la"; o.question = clean(p.question, 200); }
    return o;
  },
  async run(p, ctx) {
    ctx.progress("Tính số liệu");
    const E = engine(); let data, md;
    if (p.kind === "batu") { data = { thongTinSinh: p.sinh, batTu: E.lapBatTu(p.sinh) }; md = mdBatTu(data.batTu); }
    else if (p.kind === "tuvi") { data = { thongTinSinh: p.sinh, tuVi: E.lapTuVi(p.sinh) }; md = mdTuVi(data.tuVi); }
    else if (p.kind === "hoso") { data = { thongTinSinh: p.sinh, batTu: E.lapBatTu(p.sinh), tuVi: E.lapTuVi(p.sinh) }; md = mdBatTu(data.batTu) + "\n\n" + mdTuVi(data.tuVi); }
    else if (p.kind === "que") { data = { que: E.ganLoiQue(p.method === "maihoa" ? E.gieoQueMaiHoa(p.question) : E.gieoQueDongXu(p.question)) }; md = mdQue(data.que); }
    else { data = { tarot: E.rutBai(p.spread, p.question) }; md = mdTarot(data.tarot); }
    const head = p.sinh ? `Sinh ${fmt(p.sinh)}\n\n` : "";
    return { title: { batu: "Bát tự", tuvi: "Tử vi", hoso: "Bát tự và tử vi", que: "Gieo quẻ", tarot: "Rút tarot" }[p.kind], markdown: head + md + "\n\n_Số liệu do máy tính; phần luận giải mang tính tham khảo._", data };
  },
};
