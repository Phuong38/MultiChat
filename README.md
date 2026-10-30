# MultiChat Hub

Extension Chromium Manifest V3 gom Zalo, Messenger, Telegram và Discord vào một tab lưới Bento duy nhất trên macOS / Dia Browser.

## Tính năng

- **Lưới Bento Zero-Reload**: Hiển thị đồng thời 1 khung chính (`66%`) và 3 khung phụ (`34%`) qua CSS Grid mà không tải lại `iframe` khi đổi chỗ.
- **Maximize 100% bảo toàn cuộn**: Phóng to bất kỳ khung nào toàn màn hình bằng nút trên header hoặc `Alt/Option + M`, thoát nhanh bằng `Esc` mà không mất vị trí cuộn hay nháp đang gõ.
- **Thanh công cụ tự ẩn (Auto-Hide Top Drawer)**: Tiết kiệm tối đa chiều dọc màn hình với dải cảm biến `2px` sát mép trên, hỗ trợ ghim cố định khi cần.
- **Thông báo native macOS chuẩn xác**: Chặn và chuyển tiếp `window.Notification` kèm cơ chế dự phòng quét DOM sau `1500ms`, hiển thị icon riêng từng ứng dụng theo định dạng `{Ứng dụng} • {Người gửi}`.
- **Lọc hội thoại tắt chuông (Muted-Chat Silence)**: Bỏ qua nhóm, kênh và thư mục lưu trữ đã tắt thông báo trên Telegram WebK/WebA, Zalo, Messenger, Discord khỏi bộ đếm tin chưa đọc và thông báo dự phòng.
- **Đồng bộ huy hiệu chưa đọc**: Cập nhật trực tiếp tổng số tin chưa đọc lên icon thanh công cụ trình duyệt (`chrome.action`), tiêu đề tab và favicon động vẽ qua Canvas.
- **Tối ưu RAM & GPU**: Hạ nhịp `requestAnimationFrame` khung phụ xuống `~2fps` (`500ms`, tự mở lại `60fps` khi rê chuột vào), tắt CSS animation/sidebar phụ, chặn request telemetry (`diet.json`), tùy chọn chặn GIF tự phát (`lite-media.json`) và chế độ Tạm dừng giải phóng `0 MB RAM` (`about:blank` + opaque `sandbox=""`).
- **CookieBridge & Re-Auth**: Tự nâng cấp cookie phiên đăng nhập sang `SameSite=None; Secure` (tuân thủ chuẩn `__Host-` và `partitionKey`) để duy trì đăng nhập trong `sub_frame`, kèm nút mở popup xác thực lại khi hết phiên.
- **Dọn tab trùng**: Tự phát hiện các tab Zalo, Messenger, Telegram, Discord mở rời ngoài Workspace và cho phép đóng gọn bằng một cú nhấp.

## Kiến trúc

```text
dia-extension/
├── public/
│   ├── manifest.json          # Cấu hình MV3, deterministic RSA public key, DNR & dual-world scripts
│   ├── workspace.html         # Khung giao diện Bento Grid & Auto-Hide Topbar
│   ├── workspace.css          # Giao diện tối Matte Dark, splitter kéo thả, Maximize overlay
│   └── rules/
│       ├── framing.json       # Gỡ X-Frame-Options/CSP cho sub_frame từ extension & sửa Sec-Fetch-Dest cho Messenger
│       ├── diet.json          # Chặn telemetry của Discord, Sentry, Messenger/Facebook, Zalo
│       └── lite-media.json    # Ruleset tùy chọn chặn tự tải ảnh/video GIF từ Tenor & Giphy
├── scripts/
│   ├── build.mjs              # Đóng gói esbuild (chrome124) & bơm host cục bộ khi chạy --test
│   └── icons-gen.mjs          # Bộ sinh icon PNG Retina 4x4 SSAA thuần Node (node:zlib, zero native deps)
├── src/
│   ├── background/
│   │   ├── service-worker.ts  # Điều phối lifecycle MV3, hydration session storage, action badge, message bus
│   │   ├── cookie-bridge.ts   # Đồng bộ & nâng cấp SameSite=no_restriction cho cookie 4 nền tảng
│   │   ├── notify-router.ts   # Chống trùng lặp 3000ms, lọc khung đang focus, định dạng banner & xử lý click
│   │   └── tab-coordinator.ts # Mở/ghim tab Workspace duy nhất & quét tab chat trùng bên ngoài
│   ├── content/
│   │   ├── notify-hook.main.ts     # MAIN world: bọc proxy window.Notification & bộ điều tiết rAF 2fps
│   │   ├── raf-governor.ts         # Cài đặt rAF governor & Notification proxy lưu FIFO 50 token click
│   │   ├── frame-agent.isolated.ts # ISOLATED world: cầu nối postMessage/CustomEvent, phím tắt, theo dõi unread
│   │   └── unread-observer.ts      # Bộ đếm fallback 1500ms chống báo kép & bơm CSS tiết kiệm cho khung phụ
│   ├── providers/
│   │   └── registry.ts        # Khai báo URL, selector DOM, lọc hội thoại tắt chuông & trích xuất preview tin nhắn
│   ├── shared/
│   │   ├── shortcuts.ts       # Xử lý phím tắt Alt/Option+1..4 và Alt/Option+M đa bàn phím macOS
│   │   └── types.ts           # Định nghĩa kiểu TypeScript cho cấu hình, prefs và message bus
│   └── workspace/
│       ├── workspace.ts       # Gắn kết 4 khung chat, kéo thả vách ngăn, điều khiển Pause/Reload/Re-Auth/Maximize
│       ├── bento-state.ts     # Hàm thuần quản lý thứ tự khung, giới hạn độ rộng 45%..80% & làm sạch prefs
│       ├── favicon.ts         # Vẽ favicon 64x64 kèm badge đếm tin chưa đọc qua HTMLCanvasElement
│       └── icons.ts           # Tạo inline SVG logo thương hiệu và icon thao tác
└── tests/
    ├── unit/                  # Bộ unit & DOM integration test chạy trên Vitest + jsdom
    └── e2e/                   # Kiểm thử đầu-cuối extension MV3 thật trên Chromium qua Playwright
```

## Yêu cầu hệ thống

- **Node.js**: `>= 22`
- **Trình duyệt**: Dia Browser hoặc trình duyệt nhân Chromium `>= 124` (Chrome, Arc, Brave, Edge) trên macOS.

## Cài đặt & Sử dụng

1. Cài đặt dependencies:

```bash
npm install
```

2. Build bản phân phối vào thư mục `dist/`:

```bash
npm run build
```

3. Nạp extension vào Dia Browser / Chromium:
- Mở `chrome://extensions` trên thanh địa chỉ.
- Bật chế độ **Developer mode** ở góc trên bên phải.
- Nhấn **Load unpacked** và chọn thư mục `dist/` vừa tạo.
- Nhấp vào biểu tượng **MultiChat Hub** trên thanh công cụ để mở và tự động ghim tab Workspace.

> **Lưu ý thông báo trên macOS**: Hãy bật quyền gửi thông báo cho **Dia** (hoặc **Google Chrome**) trong `System Settings > Notifications` để nhận banner native từ `chrome.notifications`.

## Phím tắt & Thao tác

| Thao tác | Tác dụng |
| :--- | :--- |
| `Alt/Option + 1` | Đưa **Zalo** lên khung chính (tự mở lại nếu đang tạm dừng) |
| `Alt/Option + 2` | Đưa **Messenger** lên khung chính |
| `Alt/Option + 3` | Đưa **Telegram** lên khung chính |
| `Alt/Option + 4` | Đưa **Discord** lên khung chính |
| `Alt/Option + M` | Bật/tắt phóng to `100%` cho khung đang tương tác (hoạt động xuyên `iframe`) |
| `Esc` | Thoát chế độ phóng to `100%` về lại lưới Bento |
| Kéo thanh chia dọc | Điều chỉnh tỷ lệ cột chính trong khoảng `45% - 80%` |
| Nháy đúp thanh chia dọc | Khôi phục tỷ lệ cột chính mặc định `66% / 34%` |

## Lệnh phát triển & Kiểm thử

```bash
# Kiểm tra kiểu TypeScript nghiêm ngặt (strict + noUncheckedIndexedAccess)
npm run typecheck

# Chạy toàn bộ unit test & DOM integration test (Vitest)
npm test

# Build bản sản xuất đã minify vào dist/
npm run build

# Build bản kiểm thử (thêm quyền 127.0.0.1 & inline sourcemap) vào dist/
npm run build:test

# Build bản kiểm thử và chạy Playwright E2E trên Chromium thật
npm run test:e2e
```

## Bảo mật & Bất biến thiết kế

- **Khóa Extension ID cố định**: Trường `key` trong `public/manifest.json` là khóa công khai RSA (SPKI) giữ cố định ID `ndcplbpbnmkeikikgmpgkaaiefmecmjh` để khớp `initiatorDomains` trong `framing.json` và bảo toàn IndexedDB (PIN E2EE của Messenger, phiên Telegram WebK, Zalo, Discord) qua các lần cập nhật.
- **Chống Clickjacking từ web ngoài**: Ruleset `framing.json` chỉ gỡ `X-Frame-Options` và `Content-Security-Policy` trên tài nguyên `sub_frame` được khởi tạo từ chính Extension ID và các miền chat hợp lệ, tuyệt đối không mở khóa framing cho trang web bên thứ ba.
- **Cô lập ngữ cảnh Content Script**: Cả `notify-hook.main.ts` và `frame-agent.isolated.ts` đều từ chối kích hoạt trên tab thông thường (`window === window.top`), khung cháu (`window.parent !== window.top`), hoặc khung nhúng không thuộc `chrome-extension://` trong `location.ancestorOrigins`.
- **Zero Runtime Dependencies**: Mã chạy thực tế trong trình duyệt chỉ dùng Vanilla TypeScript, CSS Grid và inline SVG (`~51 KB` tổng 4 bundle đã minify), không phụ thuộc framework ngoài.
