# Dựng lại menh.bundle.js

Nguồn: `E:\CRAFTBYTE\MenhLy3D\menh-engine` (chỉ đọc, không sửa). Tạo thư mục tạm, chép `src` (bỏ `src/ai` và `src/cli.ts`), `data/kinhdich/loi-que.json`, `package.json`, `tsconfig.json`,
rồi `menh-entry.ts.txt` đổi tên thành `entry.ts` (gọi `datLoiQue` với dữ liệu lời quẻ nhúng sẵn) và chạy:

    npm i astronomy-engine iztro lunar-typescript esbuild
    npx esbuild entry.ts --bundle --platform=node --format=cjs --target=node20 --minify --outfile=menh.bundle.js

Chép `menh.bundle.js` vào thư mục `skills`. esbuild chỉ dùng lúc build, ứng dụng không cần cài gì thêm.
