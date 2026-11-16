// Đọc bình luận livestream cho Văn phòng AI (chạy trong tiến trình chính, trang chỉ nhận sự kiện đã làm sạch).
//  - YouTube: API chính thức YouTube Data API v3 (khoá API của người dùng, chỉ đọc chat công khai).
//  - TikTok: thư viện tiktok-live-connector (KHÔNG chính thức, dựa vào máy chủ ký của EulerStream, có thể hỏng khi TikTok đổi).
// Ứng dụng không đăng nhập hộ tài khoản nào và không gửi tin nhắn lên nền tảng.
const path = require("path");
const { pathToFileURL } = require("url");

const YT_BASE = process.env.VPAI_YT_BASE || "https://www.googleapis.com/youtube/v3";
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function videoId(s) {
  s = String(s || "").trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s);
    if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split("/")[0] || "";
    if (/youtube\.com$/i.test(u.hostname)) { if (u.searchParams.get("v")) return u.searchParams.get("v"); const m = u.pathname.match(/\/(?:live|embed|shorts)\/([\w-]{11})/); if (m) return m[1]; }
  } catch {}
  return "";
}
function ytError(j, status) {
  const e = j && j.error, reason = e && e.errors && e.errors[0] && e.errors[0].reason, msg = (e && e.message) || "HTTP " + status;
  if (reason === "quotaExceeded" || reason === "rateLimitExceeded") return "Khoá YouTube đã hết hạn mức trong ngày (hạn mức tính lại mỗi ngày). Thử lại ngày mai hoặc dùng khoá khác";
  if (reason === "keyInvalid" || /API key not valid/i.test(msg)) return "Khoá YouTube API không hợp lệ";
  if (reason === "accessNotConfigured" || /has not been used|is disabled/i.test(msg)) return "Dự án Google của khoá chưa bật YouTube Data API v3. Vào Google Cloud, bật \"YouTube Data API v3\" rồi thử lại";
  if (reason === "liveChatDisabled") return "Video này đã tắt chat trực tiếp";
  if (reason === "liveChatEnded") return "Buổi phát trực tiếp đã kết thúc";
  if (reason === "forbidden" || status === 403) return "YouTube từ chối đọc chat bằng khoá API này (" + clean(msg, 120) + ")";
  return clean(msg, 160);
}

function makeLive(fetcher, emit) {
  const sessions = {};
  const say = (platform, state, msg, extra = {}) => emit({ type: "status", platform, state, msg, ...extra });

  async function startYouTube({ key, video }) {
    key = clean(key, 120); const id = videoId(video);
    if (!key) throw new Error("Chưa nhập khoá YouTube Data API");
    if (!id) throw new Error("Không đọc được ID video. Dán link buổi live (youtube.com/watch?v=… hoặc youtube.com/live/…) hoặc mã 11 ký tự");
    const getJson = async (url) => { const r = await fetcher(url); let j = {}; try { j = JSON.parse(await r.text()); } catch {} if (!r.ok) throw Object.assign(new Error(ytError(j, r.status)), { fatal: true, status: r.status }); return j; };
    const j = await getJson(`${YT_BASE}/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}`);
    const it = j.items && j.items[0];
    if (!it) throw new Error("Không tìm thấy video này (kiểm tra link, video riêng tư sẽ không đọc được)");
    const det = it.liveStreamingDetails || {}, chat = det.activeLiveChatId;
    if (!chat) throw new Error("Video này không đang phát trực tiếp hoặc đã tắt chat");
    const s = { stop: false, timer: null, page: "", first: true, title: clean(it.snippet && it.snippet.title, 80) };
    sessions.youtube = s;
    say("youtube", "on", s.title ? "Đang đọc chat: " + s.title : "Đang đọc chat", { viewers: det.concurrentViewers ? Number(det.concurrentViewers) : null });
    const poll = async () => {
      if (s.stop) return;
      let wait = 6000;
      try {
        const q = `${YT_BASE}/liveChat/messages?liveChatId=${encodeURIComponent(chat)}&part=snippet,authorDetails&maxResults=200&key=${encodeURIComponent(key)}` + (s.page ? `&pageToken=${encodeURIComponent(s.page)}` : "");
        const r = await getJson(q);
        s.page = r.nextPageToken || s.page;
        wait = Math.max(5000, Number(r.pollingIntervalMillis) || 6000);
        const items = r.items || [];
        if (s.first) s.first = false; // lô đầu là tin cũ: bỏ qua để không trả lời lại bình luận đã qua
        else for (const m of items) {
          const sn = m.snippet || {}, au = m.authorDetails || {};
          if (sn.type === "chatEndedEvent") { say("youtube", "off", "Buổi phát trực tiếp đã kết thúc"); s.stop = true; return; }
          let text = "";
          if (sn.type === "textMessageEvent") text = (sn.textMessageDetails && sn.textMessageDetails.messageText) || sn.displayMessage;
          else if (sn.type === "superChatEvent" && sn.superChatDetails) text = `[Super Chat ${sn.superChatDetails.amountDisplayString || ""}] ${sn.superChatDetails.userComment || ""}`;
          text = clean(text, 200); if (!text) continue;
          emit({ type: "comment", platform: "youtube", user: clean(au.displayName, 40) || "Khách", text });
        }
      } catch (e) {
        if (e.fatal && e.status !== 500 && e.status !== 503) { say("youtube", "error", e.message); s.stop = true; return; }
        say("youtube", "on", "Mất kết nối tạm thời, đang thử lại…"); wait = 15000;
      }
      if (!s.stop) s.timer = setTimeout(poll, wait);
    };
    poll();
    return { ok: true };
  }

  async function startTikTok({ user, key }) {
    user = clean(user, 40).replace(/^@/, "");
    if (!/^[\w.]{2,40}$/.test(user)) throw new Error("Tên tài khoản TikTok không hợp lệ (nhập dạng @tenkenh)");
    let mod;
    try { mod = await import(process.env.VPAI_TT_MODULE ? pathToFileURL(path.resolve(process.env.VPAI_TT_MODULE)).href : "tiktok-live-connector"); }
    catch (e) { throw new Error("Không nạp được thư viện TikTok: " + clean(e.message, 100)); }
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = mod;
    const opts = { processInitialData: false }; if (clean(key, 200)) opts.signApiKey = clean(key, 200);
    const conn = new TikTokLiveConnection(user, opts);
    const s = { stop: false, conn };
    const nameOf = (d) => clean((d.user && (d.user.nickname || d.user.uniqueId)) || d.nickname || d.uniqueId, 40) || "Khách";
    conn.on(WebcastEvent.CHAT, (d) => { const text = clean(d.comment, 200); if (text) emit({ type: "comment", platform: "tiktok", user: nameOf(d), text }); });
    conn.on(WebcastEvent.ROOM_USER, (d) => { if (d && d.viewerCount != null) say("tiktok", "on", "Đang đọc chat @" + user, { viewers: Number(d.viewerCount) }); });
    conn.on(WebcastEvent.STREAM_END, () => { say("tiktok", "off", "Buổi phát trực tiếp đã kết thúc"); stop("tiktok"); });
    conn.on(ControlEvent.DISCONNECTED, () => { if (!s.stop) { say("tiktok", "off", "Đã ngắt kết nối"); stop("tiktok"); } });
    conn.on(ControlEvent.ERROR, (e) => say("tiktok", "on", "Có lỗi nhỏ: " + clean(e && (e.message || e.info || e), 100)));
    sessions.tiktok = s;
    try { await conn.connect(); }
    catch (e) {
      sessions.tiktok = null; s.stop = true;
      const n = (e && e.constructor && e.constructor.name) || "", m = clean(e && e.message, 200);
      if (/UserOffline/i.test(n) || /not (currently )?live|offline/i.test(m)) throw new Error("Tài khoản @" + user + " không đang phát trực tiếp");
      if (/RateLimit/i.test(n) || /rate.?limit|429/i.test(m)) throw new Error("Máy chủ ký của EulerStream đang giới hạn lượt. Nhập khoá API EulerStream (miễn phí tại eulerstream.com) rồi thử lại");
      if (/InvalidUniqueId/i.test(n)) throw new Error("Không tìm thấy tài khoản TikTok @" + user);
      throw new Error("Không kết nối được TikTok: " + (m || n || "lỗi không rõ"));
    }
    say("tiktok", "on", "Đang đọc chat @" + user);
    return { ok: true };
  }

  function stop(platform) {
    const s = sessions[platform]; if (!s) return;
    s.stop = true; sessions[platform] = null;
    if (s.timer) clearTimeout(s.timer);
    if (s.conn) { try { s.conn.disconnect(); } catch {} }
    say(platform, "off", "Đã ngắt kết nối");
  }
  return {
    async start(req) {
      const p = req && req.platform;
      if (p !== "youtube" && p !== "tiktok") throw new Error("Nền tảng không hỗ trợ");
      if (sessions[p]) stop(p);
      say(p, "connecting", "Đang kết nối…");
      try { return p === "youtube" ? await startYouTube(req) : await startTikTok(req); }
      catch (e) { say(p, "error", e.message); return { ok: false, error: e.message }; }
    },
    stop,
    stopAll() { Object.keys(sessions).forEach(stop); },
  };
}
module.exports = { makeLive, videoId, clean };
