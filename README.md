# Văn phòng AI: mã nguồn ứng dụng Windows

Electron 44, không có thư viện chạy kèm ngoài three.js 0.160 và phông Be Vietnam Pro / JetBrains Mono (đã nằm trong `web/vendor`).

- `main.js`: tạo cửa sổ, phục vụ thư mục `web/` qua giao thức `app://` để ES module chạy offline, mở link ngoài bằng trình duyệt, và gọi AI hộ trang (chỉ cho phép `api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`).
- `cc.js`: cầu nối bộ não Claude Code (gói Pro).
- `live.js`: đọc bình luận livestream (YouTube API chính thức, TikTok qua thư viện tiktok-live-connector).
- `tp.js`: cầu nối tới Trạm Phim (LocalVideoTranslator) trên chính máy này, chỉ gọi 127.0.0.1: xem trạng thái, bấm nút duyệt cho video trong hàng đợi, đăng bài chữ/ảnh.
- `apps.js`: sổ đăng ký dự án (`apps.json` cạnh exe): mở đúng các chương trình có trong sổ và kiểm tra trạng thái qua 127.0.0.1; trang chỉ gửi id.
- `preload.js`: cầu nối `desktopAI`, `desktopCC`, `desktopLive`, `desktopTP`, `desktopApps` cho trang, không cấp quyền gì khác.
- `web/index.html`: toàn bộ giao diện ngân hàng ảo (các phòng nghiệp vụ, 3D), JARVIS, phân bổ mô hình, livestream, Facebook.

```
npm install
npm start
npm run build:win
```

Xem hướng dẫn đầy đủ ở `..\HUONG-DAN.md`.
