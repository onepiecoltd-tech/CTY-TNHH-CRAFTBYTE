// Ported from connector-coccoc-v1.7.0/mst-worker.js: tra cứu theo MST.
// Đọc kết quả Cốc Cốc và hồ sơ doanh nghiệp (Mã Số Thuế, Tra Cứu Mã Số Thuế, Trang Vàng).
// Chỉ đọc dữ liệu công khai; mọi hồ sơ phải khớp MST mới được trả về.
(() => {
  if (window.__plh_mst) return;
  const TEST_ORIGIN = __TEST_ORIGIN__; // chỉ khác rỗng khi kiểm thử với máy chủ giả trên 127.0.0.1
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
  const norm = value => clean(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
  const profileURL = (raw, taxCode) => {
    try {
      const url = new URL(raw, location.href);
      if (TEST_ORIGIN && url.origin === TEST_ORIGIN && new RegExp(`^/${taxCode}-[a-z0-9-]+/?$`, 'i').test(url.pathname)) return true;
      return url.protocol === 'https:' && (
        ['masothue.com', 'www.masothue.com', 'tracuumasothue.com', 'www.tracuumasothue.com'].includes(url.hostname) && new RegExp(`^/${taxCode}-[a-z0-9-]+/?$`, 'i').test(url.pathname)
        || ['yellowpages.vn', 'www.yellowpages.vn'].includes(url.hostname) && /^\/lgs\/\d+\/[^/]+\.html$/i.test(url.pathname));
    } catch { return false; }
  };
  function blocked() {
    if (/\/sorry\//.test(location.pathname)) return true;
    if (/unusual traffic|verify you are human|xác minh bạn là con người|không phải rô.?bốt|sorry, you have been blocked/i.test(document.body?.innerText || '')) return true;
    return [...document.querySelectorAll('#challenge-running,iframe[src*="bframe"],iframe[src*="hcaptcha"],#captcha')].some(visible);
  }
  const BLOCKED = { blocked: 'Nguồn yêu cầu xác minh/CAPTCHA. Phiên đã dừng; hãy kiểm tra cửa sổ nguồn rồi tiếp tục.' };

  // Cốc Cốc gói link kết quả trong nhiều lớp mã hoá; chỉ nhận URL hồ sơ đúng MST.
  function destination(anchor, taxCode) {
    for (const attribute of ['href', 'data-href', 'data-url']) {
      let raw = anchor.getAttribute(attribute) || '';
      for (let n = 0; n < 4 && raw; n++) {
        if (profileURL(raw, taxCode)) return new URL(raw, location.href).href;
        const match = raw.match(new RegExp(`https://(?:www\\.)?(?:masothue\\.com|tracuumasothue\\.com)/${taxCode}-[a-z0-9-]+/?|https://(?:www\\.)?yellowpages\\.vn/lgs/\\d+/[^/?#]+\\.html`, 'i'));
        if (match && profileURL(match[0], taxCode)) return match[0];
        try { const next = decodeURIComponent(raw); if (next === raw) break; raw = next; } catch { break; }
      }
    }
    return '';
  }

  function search(row) {
    if (blocked()) return BLOCKED;
    if (!(/(^|\.)coccoc\.com$/.test(location.hostname) || (TEST_ORIGIN && location.origin === TEST_ORIGIN)) || document.readyState !== 'complete') return { pending: true };
    const urls = [...new Set([...document.querySelectorAll('a[href]')].filter(visible).map(anchor => destination(anchor, row.taxCode)).filter(Boolean))];
    // Mã Số Thuế trước, rồi Tra Cứu Mã Số Thuế, cuối cùng Trang Vàng.
    const order = url => url.includes('tracuumasothue.com') ? 1 : url.includes('yellowpages.vn') ? 2 : 0;
    urls.sort((a, b) => order(a) - order(b));
    if (urls.length) return { urls: urls.slice(0, 8) };
    // Trang kết quả tải xong mà nội dung không có MST: Cốc Cốc không có hồ sơ này.
    // Báo ngay để không chờ hết 60 giây.
    const body = clean(document.body?.innerText);
    if (/Có [\d.]+ kết quả/i.test(body) && !body.includes(row.taxCode)) return { empty: true };
    return { pending: true };
  }

  function field(table, labels) {
    for (const row of table.querySelectorAll('tr')) {
      const cells = [...row.children].filter(cell => ['TD', 'TH'].includes(cell.tagName));
      if (cells.length < 2) continue;
      const label = norm(cells[0].innerText).replace(/^[^a-z0-9]+/, '');
      if (labels.some(value => label === norm(value))) return cells[1];
    }
    return null;
  }
  const firstLine = cell => String(cell?.innerText || '').split(/\r?\n/).map(clean).find(Boolean) || '';
  // Mã Số Thuế che một phần số ("02223751150 0982 Ẩn số điện thoại") nên chuỗi bắt được
  // có thể dính hai cụm. Giữ tiền tố hợp lệ dài nhất, bỏ phần bị che.
  const PHONE = /^(?:0\d{9,10}|\+84\d{9,10}|1800\d{4,6}|1900\d{4,6})$/;
  const validPhone = digits => {
    for (let length = digits.length; length >= 9; length--) {
      const candidate = digits.slice(0, length);
      if (PHONE.test(candidate)) return candidate;
    }
    return '';
  };

  function taxProfile(row) {
    const taxCode = row.taxCode;
    if (!profileURL(location.href, taxCode)) return { pending: true };
    const tables = [...document.querySelectorAll('table')];
    const table = tables.find(candidate => clean(field(candidate, ['Mã số thuế'])?.innerText) === taxCode);
    if (!table || document.readyState !== 'complete') return { pending: true };
    const name = clean(table.querySelector('thead')?.innerText || document.querySelector('h1')?.innerText).replace(new RegExp(`^${taxCode}\\s*[-–:]\\s*`), '');
    if (!name) return { pending: true };
    const representativeCell = field(table, ['Người đại diện', 'Người đại diện pháp luật', 'Đại diện pháp luật']);
    const representative = clean([...representativeCell?.querySelectorAll('a') || []].find(visible)?.innerText || firstLine(representativeCell));
    const address = clean(field(table, ['Địa chỉ'])?.innerText || field(table, ['Địa chỉ thuế'])?.innerText);
    const operatingStatus = clean(field(table, ['Tình trạng', 'Tình trạng hoạt động', 'Trạng thái hoạt động'])?.innerText);
    const industry = firstLine(field(table, ['Ngành nghề chính']));
    const rawPhone = String(field(table, ['Điện thoại', 'Số điện thoại'])?.innerText || '');
    const phone = [...new Set((rawPhone.match(/(?:\+84|0)\d(?:[\s().-]*\d){8,10}|(?:1800|1900)(?:[\s.-]*\d){4,6}/g) || []).map(value => validPhone(value.replace(/[\s().-]/g, ''))).filter(Boolean))].join('; ');
    const industryTable = tables.find(candidate => candidate !== table && norm(candidate.querySelector('thead')?.innerText).includes('nganh'));
    const industries = industryTable ? [...industryTable.querySelectorAll('tbody tr')].map(item => clean(item.innerText)).filter(Boolean).join('\n') : '';
    return { taxCode, name, address, operatingStatus, representative, industry, industries, phone, sourceURL: location.origin + location.pathname, checkedAt: new Date().toISOString() };
  }

  function yellowProfile(row) {
    const taxCode = row.taxCode;
    if (!profileURL(location.href, taxCode)) return { pending: true };
    const heading = document.querySelector('h1');
    const scope = heading?.parentElement;
    const lists = [...document.querySelectorAll('dl.ypl-dl')];
    const value = (list, label) => clean([...list.querySelectorAll('dt')].find(dt => norm(dt.innerText) === norm(label))?.nextElementSibling?.innerText);
    const matches = lists.filter(list => value(list, 'Mã số thuế') === taxCode && norm(value(list, 'Tên công ty')) === norm(heading?.innerText));
    if (matches.length !== 1 || !scope) return { pending: true };
    const phones = [...new Set([...scope.querySelectorAll('a[href^="tel:"]')].filter(visible).map(anchor => anchor.getAttribute('href').slice(4).replace(/[\s().-]/g, '')).filter(value => /^(?:0\d{9,10}|\+84\d{9,10})$/.test(value)))];
    return { taxCode, name: value(matches[0], 'Tên công ty'), address: value(matches[0], 'Trụ sở'), phone: phones.length === 1 ? phones[0] : '', sourceURL: location.origin + location.pathname, checkedAt: new Date().toISOString() };
  }

  function profile(row) {
    if (blocked()) return BLOCKED;
    return /yellowpages\.vn$/.test(location.hostname) ? yellowProfile(row) : taxProfile(row);
  }

  // Cấu trúc nguồn đổi thì báo "chưa đọc được", không làm hỏng cả lượt.
  const guard = fn => row => { try { return fn(row); } catch (error) { return { blocked: `Không đọc được cấu trúc trang: ${error.message}` }; } };
  // Mở hồ sơ bằng chính ô tìm kiếm của Mã Số Thuế (form có token); mở /Search/?q= trực tiếp sẽ ra doanh nghiệp khác.
  function formSearch(row) {
    if (blocked()) return BLOCKED;
    const form = [...document.querySelectorAll('form')].find(item => { try { return new URL(item.action, location.href).pathname.startsWith('/Search'); } catch { return false; } });
    const input = form && form.querySelector('input[name="q"]');
    if (!input) return document.readyState === 'complete' ? { missing: true } : { pending: true };
    const token = form.querySelector('input[name="token"]');
    if (document.readyState !== 'complete' || (token && !token.value)) return { pending: true };
    input.value = row.taxCode;
    setTimeout(() => form.requestSubmit ? form.requestSubmit() : form.submit(), 0);
    return { submitted: true };
  }

  // Tra theo tên: Cốc Cốc trả link hồ sơ có MST nằm trong đường dẫn. Chỉ gom {mst, slug, url}; việc so tên và xác minh do bên main làm.
  const NAME_URL = /https:\/\/(?:www\.)?(?:masothue\.com|tracuumasothue\.com)\/(\d{10}(?:-\d{3})?)-([a-z0-9-]+)\/?/i;
  function nameSearch() {
    if (blocked()) return BLOCKED;
    if (!(/(^|\.)coccoc\.com$/.test(location.hostname) || (TEST_ORIGIN && location.origin === TEST_ORIGIN)) || document.readyState !== 'complete') return { pending: true };
    const seen = new Map();
    for (const anchor of [...document.querySelectorAll('a[href]')].filter(visible)) {
      for (const attribute of ['href', 'data-href', 'data-url']) {
        let raw = anchor.getAttribute(attribute) || '';
        for (let n = 0; n < 4 && raw; n++) {
          let m = raw.match(NAME_URL);
          if (!m && TEST_ORIGIN) { try { const u = new URL(raw, location.href); if (u.origin === TEST_ORIGIN) m = u.href.match(/\/(\d{10}(?:-\d{3})?)-([a-z0-9-]+)\/?$/i); if (m) m[0] = u.href; } catch {} }
          if (m) { if (!seen.has(m[1])) seen.set(m[1], { mst: m[1], slug: m[2].toLowerCase(), url: m[0].startsWith('http') ? m[0] : '' }); break; }
          try { const next = decodeURIComponent(raw); if (next === raw) break; raw = next; } catch { break; }
        }
      }
    }
    if (seen.size) return { candidates: [...seen.values()].slice(0, 12) };
    const body = clean(document.body?.innerText);
    if (/Có [\d.]+ kết quả/i.test(body)) return { empty: true };
    return { pending: true };
  }
  window.__plh_mst = { nameSearch: guard(nameSearch), search: guard(search), profile: guard(profile), formSearch: guard(formSearch) };
})();
