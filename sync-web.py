# Tạo web/index.html cho bản exe từ bản web gốc: phông và three.js nạp cục bộ.
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
old_fonts = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">'''
assert old_fonts in s
s = s.replace(old_fonts, "\n".join([f'<link rel="stylesheet" href="vendor/fonts/be-vietnam-pro/{w}.css">' for w in (400,500,600,700,800)] + [f'<link rel="stylesheet" href="vendor/fonts/jetbrains-mono/{w}.css">' for w in (500,700)]))
old_map = '{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"}}'
assert old_map in s
s = s.replace(old_map, '{"imports":{"three":"./vendor/three/three.module.js","three/addons/":"./vendor/three/addons/"}}')
s = s.replace('<title>Văn phòng AI 3D</title>', '<title>Văn phòng AI</title>')
open(dst, 'w', encoding='utf-8').write(s)
print("synced", len(s))
