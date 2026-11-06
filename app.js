// ====== ISI TIGA BARIS INI SESUAI REPO GITHUB ANDA ======
const GH_OWNER = 'athlan13';
const GH_REPO = 'album-kita';
const GH_BRANCH = 'main';
// =========================================================

const $ = id => document.getElementById(id);
window.addEventListener('error', e => { const m = document.getElementById('msg'); if (m) { m.textContent = 'Error: ' + e.message; m.style.display = 'block'; } });
let token = null, admin = false, busy = false, filter = null, pick = null, pickMarker = null, markers = [];
let drafts = []; // foto yang belum disimpan: {blob, name, place, lat, lng, caption, date, preview}

function el(tag, attrs = {}, text) { const e = document.createElement(tag); Object.assign(e, attrs); if (text != null) e.textContent = text; return e; }
function toast(t) { const m = $('msg'); m.textContent = t; m.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => m.style.display = 'none', 4500); }

// ---------- API GitHub ----------
async function gh(path, opt = {}) {
  const r = await fetch('https://api.github.com/repos/' + GH_OWNER + '/' + GH_REPO + path, {
    ...opt, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).message) || ('Kode ' + r.status));
  return r.json();
}
const blobB64 = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result.split(',')[1]); f.readAsDataURL(b); });
const textB64 = s => { let bin = ''; new TextEncoder().encode(s).forEach(c => bin += String.fromCharCode(c)); return btoa(bin); };
async function readRemote() {
  const f = await gh('/contents/data.js?ref=' + GH_BRANCH + '&_=' + Date.now());
  const txt = new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const i = txt.indexOf('[', txt.indexOf('const PHOTOS'));
  return { list: JSON.parse(txt.slice(i, txt.lastIndexOf(']') + 1)), sha: f.sha };
}
const writeData = (list, sha, message) => gh('/contents/data.js', { method: 'PUT', body: JSON.stringify({
  message, sha, branch: GH_BRANCH, content: textB64('const PHOTOS = ' + JSON.stringify(list, null, 2) + ';\n') }) });

// Baca data.js terbaru, ubah, lalu simpan. Kalau bentrok versi, baca ulang dan coba lagi.
async function updateData(mutate, message) {
  for (let i = 0; ; i++) {
    const r = await readRemote();
    try { return await writeData(mutate(r.list), r.sha, message); }
    catch (e) {
      if (i < 3 && /does not match|conflict|sha/i.test(e.message)) { await new Promise(t => setTimeout(t, 1200 * (i + 1))); continue; }
      throw e;
    }
  }
}

// ---------- Peta ----------
const map = L.map('map').setView([-2.5, 118], 4);
// Peta berwarna seperti semula: OpenStreetMap untuk situs online; Esri untuk file/localhost (OSM sering memblokir akses lokal)
const isLocal = !location.protocol.startsWith('http') || /^(localhost|127\.|192\.168\.|10\.|\[?::1)/.test(location.hostname);
const esriStreet = () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, keepBuffer: 6, attribution: 'Tiles © Esri' });
const mainBase = (isLocal ? esriStreet() : L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, keepBuffer: 6, attribution: '© OpenStreetMap' })).addTo(map);
let tilesOk = 0, tilesBad = 0, fellBack = false;
mainBase.on('tileload', () => tilesOk++);
mainBase.on('tileerror', () => {   // jika OSM gagal dimuat, pakai peta Esri sebagai cadangan
  if (isLocal || fellBack || ++tilesBad < 4 || tilesOk) return;
  fellBack = true; mainBase.remove(); esriStreet().addTo(map);
});
map.on('click', e => {
  if (!admin) return;
  pick = e.latlng;
  if (pickMarker) pickMarker.setLatLng(pick); else pickMarker = L.circleMarker(pick, { radius: 9, color: '#c23b5a', fillOpacity: .6 }).addTo(map);
  $('hint').textContent = 'Lokasi dipilih: ' + pick.lat.toFixed(4) + ', ' + pick.lng.toFixed(4);
});

// ---------- Tampilan ----------
function allPhotos() {
  const saved = (typeof PHOTOS !== 'undefined' ? PHOTOS : []).map(p => ({ ...p, draft: false }));
  const d = drafts.map(p => ({ src: p.preview, place: p.place, lat: p.lat, lng: p.lng, caption: p.caption, date: p.date, address: p.address, draft: true, ref: p }));
  return [...d, ...saved].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

let routeLayer = null;
function stopsList() {   // tempat-tempat berurutan sesuai tanggal kunjungan pertama (yang tanpa tanggal di akhir)
  const g = {};
  allPhotos().forEach(p => { (g[p.place] ||= { place: p.place, lat: p.lat, lng: p.lng, items: [] }).items.push(p); });
  return Object.values(g).map(x => { const ds = x.items.map(i => i.date).filter(Boolean).sort(); return Object.assign(x, { first: ds[0] || '', last: ds[ds.length - 1] || '' }); })
    .sort((a, b) => (a.first || '\uffff').localeCompare(b.first || '\uffff') || a.place.localeCompare(b.place));
}
function openAlbum(place) { stopTour(); filter = place; render(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function render(fit) {
  const photos = allPhotos(), g = {};
  photos.forEach(p => { const x = (g[p.place] ||= { place: p.place, lat: p.lat, lng: p.lng, address: '', items: [] }); if (!x.address && p.address) x.address = p.address; x.items.push(p); });
  const gs = Object.values(g);
  if (filter && !g[filter]) filter = null;
  const cur = filter && g[filter];
  markers.forEach(m => m.remove()); markers = [];
  gs.forEach(x => {
    const m = L.marker([x.lat, x.lng]).addTo(map).bindTooltip(x.place + ' (' + x.items.length + ')');
    m.on('click', () => openAlbum(x.place));
    markers.push(m);
  });
  if (routeLayer) { routeLayer.remove(); routeLayer = null; }
  if (!cur && gs.length > 1) routeLayer = L.polyline(stopsList().map(x => [x.lat, x.lng]), { color: '#ff6f9c', weight: 2.5, opacity: .55, dashArray: '6 8', interactive: false }).addTo(map);
  if (fit) {
    if (cur) map.setView([cur.lat, cur.lng], 14);
    else if (gs.length) map.fitBounds(L.latLngBounds(gs.map(x => [x.lat, x.lng])).pad(.3), { maxZoom: 12 });
  }
  $('places').replaceChildren(...gs.map(x => el('option', { value: x.place })));
  $('allBtn').style.display = cur ? '' : 'none';
  const tb = $('tourBtn'); if (tb) tb.style.display = !cur && gs.length > 1 ? '' : 'none';
  $('info').textContent = cur ? cur.place : photos.length + ' foto di ' + gs.length + ' album';
  const box = $('gallery'); box.replaceChildren();
  // daftar tempat yang sudah dikunjungi (menu geser di kiri atas)
  const fmt = d => new Date(d + 'T00:00').toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  const rows = gs.map(x => { const ds = x.items.map(i => i.date).filter(Boolean).sort(); return { x, first: ds[0] || '', last: ds[ds.length - 1] || '' }; })
    .sort((a, b) => b.last.localeCompare(a.last));
  const dl = $('dlist'); dl.replaceChildren();
  $('dtitle').textContent = 'Tempat yang sudah kita kunjungi (' + gs.length + ')';
  if (!rows.length) dl.append(el('li', { className: 'dempty' }, 'Belum ada tempat.'));
  rows.forEach(r => {
    const li = el('li'), b = el('button', { title: 'Buka album ' + r.x.place });
    if (cur && cur.place === r.x.place) { b.className = 'on'; b.setAttribute('aria-current', 'true'); }
    const when = !r.first ? '' : (fmt(r.first) === fmt(r.last) ? fmt(r.first) : fmt(r.first) + ' – ' + fmt(r.last));
    b.append(el('strong', {}, r.x.place), el('span', {}, (when ? when + ' · ' : '') + r.x.items.length + ' foto'));
    if (r.x.address) b.append(el('small', {}, r.x.address));
    b.onclick = () => { closeDrawer(); openAlbum(r.x.place); };
    li.append(b); dl.append(li);
  });
  if (!gs.length) { box.append(el('div', { className: 'empty' }, 'Belum ada foto. Masuk sebagai admin untuk menambahkan kenangan pertama.')); return; }

  if (!cur) { // tampilan folder
    const grid = el('div', { className: 'folders' });
    gs.forEach(x => {
      const f = el('button', { className: 'folder', title: 'Buka album ' + x.place });
      const body = el('div', { className: 'fbody' });
      body.append(el('img', { src: x.items[0].src, alt: '', loading: 'lazy' }));
      const t = el('div', { className: 'ftext' });
      const last = x.items.map(i => i.date).filter(Boolean).sort().pop();
      t.append(el('strong', {}, x.place), el('span', {}, x.items.length + ' foto' + (last ? ' · ' + new Date(last + 'T00:00').toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }) : '')));
      body.append(t);
      f.append(el('span', { className: 'tab' }), body);
      f.onclick = () => openAlbum(x.place);
      grid.append(f);
    });
    box.append(grid); return;
  }

  // tampilan isi album
  const head = el('div', { className: 'ahead' });
  head.append(el('h2', {}, cur.place));
  const url = mapsUrl(cur.lat, cur.lng);
  if (cur.address) head.append(el('div', { className: 'addr' }, cur.address));
  const meta = el('div', { className: 'meta' });
  meta.append(el('span', {}, cur.items.length + ' foto · ' + cur.lat.toFixed(5) + ', ' + cur.lng.toFixed(5)));
  head.append(meta);
  const acts = el('div', { className: 'acts' });
  acts.append(el('a', { className: 'btn', href: url, target: '_blank', rel: 'noopener' }, 'Buka di Google Maps'));
  const cp = el('button', {}, 'Salin link lokasi'); cp.onclick = () => copyLink(url); acts.append(cp);
  if (admin) {
    const add = el('button', { className: 'primary' }, '+ Tambah foto ke album ini'); add.onclick = () => addPhotosToAlbum(cur); acts.append(add);
    const pend = drafts.filter(d => d.place === cur.place).length;
    if (pend) { const sv = el('button', { className: 'primary' }, 'Simpan ' + pend + ' foto baru ke situs'); sv.onclick = () => $('saveBtn').click(); acts.append(sv); }
    const rn = el('button', {}, 'Ubah nama album'); rn.onclick = () => renameAlbum(cur); acts.append(rn);
    const ed = el('button', {}, 'Ubah lokasi'); ed.onclick = () => editLocation(cur); acts.append(ed);
    const b = el('button', { className: 'danger' }, 'Hapus album ini'); b.onclick = () => removeAlbum(cur.place); acts.append(b);
  }
  head.append(acts);
  box.append(head);
  const grid = el('div', { className: 'grid' });
  cur.items.forEach(p => {
    const f = el('figure');
    const img = el('img', { src: p.src, alt: p.caption || cur.place, loading: 'lazy' });
    img.onclick = () => { $('lbi').src = p.src; $('lbc').textContent = p.caption || ''; $('lb').showModal(); };
    const c = el('figcaption', {}, p.caption || '');
    if (p.date) c.append(el('small', {}, new Date(p.date + 'T00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })));
    f.append(img, c);
    if (p.draft) f.append(el('span', { className: 'draft' }, 'belum disimpan'));
    if (admin) {
      const d = el('button', { className: 'del', title: 'Hapus', ariaLabel: 'Hapus foto' }, '×');
      d.onclick = () => p.draft ? (drafts = drafts.filter(r => r !== p.ref), render(false)) : removeSaved(p);
      f.append(d);
    }
    grid.append(f);
  });
  box.append(grid);
}

// Kecilkan foto (maks 1600px) agar ringan
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = el('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .85));
}

const HINT = 'Klik peta atau tempel link Google Maps untuk menandai lokasi foto.';
function mapsUrl(lat, lng) { return 'https://www.google.com/maps?q=' + lat + ',' + lng; }
function parseLoc(t) {
  try { t = decodeURIComponent(t); } catch (_) {}
  const n = '(-?\\d+(?:\\.\\d+)?)';
  const pats = [new RegExp('!3d' + n + '!4d' + n), new RegExp('@' + n + ',' + n), new RegExp('[?&](?:q|ll|query|destination|center)=(?:loc:)?' + n + ',\\s*' + n), new RegExp('^\\s*' + n + '\\s*[, ]\\s*' + n + '\\s*$')];
  for (const p of pats) { const m = t.match(p); if (m) { const lat = +m[1], lng = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }; } }
  return null;
}
function unreadable(v) { return /goo\.gl|maps\.app/i.test(v) ? 'Link pendek tidak bisa dibaca. Buka link itu di browser, lalu salin alamat lengkap dari bar alamat.' : 'Link atau koordinat tidak dikenali.'; }
$('gmap').addEventListener('input', () => {
  const v = $('gmap').value.trim(); if (!v) return;
  const ll = parseLoc(v);
  if (!ll) { $('hint').textContent = unreadable(v); return; }
  pick = L.latLng(ll.lat, ll.lng);
  if (pickMarker) pickMarker.setLatLng(pick); else pickMarker = L.circleMarker(pick, { radius: 9, color: '#c23b5a', fillOpacity: .6 }).addTo(map);
  map.setView(pick, 17);
  $('hint').textContent = 'Lokasi dari link: ' + ll.lat.toFixed(5) + ', ' + ll.lng.toFixed(5);
});
async function copyLink(url) {
  try { await navigator.clipboard.writeText(url); toast('Link lokasi disalin.'); } catch (_) { prompt('Salin link ini:', url); }
}

$('addBtn').onclick = async () => {
  const place = $('place').value.trim(), files = [...$('files').files];
  if (!place || !files.length) return toast('Isi nama tempat dan pilih foto.');
  const ex = allPhotos().find(p => p.place === place);
  const pos = ex ? { lat: ex.lat, lng: ex.lng } : pick && { lat: +pick.lat.toFixed(5), lng: +pick.lng.toFixed(5) };
  if (!pos) return toast('Tandai lokasi tempat baru ini: klik peta atau tempel link Google Maps.');
  const address = $('addr').value.trim() || (ex && ex.address) || '';
  for (const f of files) {
    const blob = await shrink(f);
    drafts.push({ blob, name: 'foto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg', place, ...pos, address,
      caption: $('cap').value.trim(), date: $('date').value, preview: URL.createObjectURL(blob) });
  }
  if (ex && pick) toast('Album ini sudah punya lokasi, jadi lokasi baru diabaikan. Ubah lewat tombol "Ubah lokasi" di dalam album.');
  $('files').value = ''; $('cap').value = ''; $('gmap').value = ''; $('addr').value = '';
  if (pickMarker) { pickMarker.remove(); pickMarker = null; pick = null; }
  $('hint').textContent = HINT;
  render(false);
};

let addTarget = null;
function addPhotosToAlbum(cur) {
  if (!$('addDlg')) return toast('Perbarui juga index.html ke versi terbaru.');
  addTarget = cur;
  $('addTitle').textContent = 'Tambah foto ke ' + cur.place;
  $('aFiles').value = ''; $('aCap').value = '';
  $('aDate').value = cur.items.map(i => i.date).filter(Boolean).sort().pop() || '';
  $('addDlg').showModal();
}
if ($('addForm')) $('addForm').onsubmit = async e => {
  e.preventDefault();
  if (e.submitter && e.submitter.value === 'cancel') return $('addDlg').close();
  const cur = addTarget, files = [...$('aFiles').files];
  if (!cur || !files.length) return;
  const date = $('aDate').value, caption = $('aCap').value.trim();
  $('addDlg').close();
  toast('Memproses ' + files.length + ' foto…');
  try {
    for (const f of files) {
      const blob = await shrink(f);
      drafts.push({ blob, name: 'foto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg', place: cur.place, lat: cur.lat, lng: cur.lng,
        address: cur.address || '', caption, date, preview: URL.createObjectURL(blob) });
    }
    toast(files.length + ' foto ditambahkan. Klik "Simpan foto baru ke situs" untuk menyimpan.');
  } catch (err) { toast('Gagal memproses foto: ' + err.message); }
  render(false);
};

async function renameAlbum(cur) {
  if (busy) return;
  const old = cur.place;
  const v = prompt('Nama album baru:', old);
  if (v === null) return;
  const name = v.trim();
  if (!name || name === old) return;
  const target = allPhotos().find(p => p.place === name);
  if (target && !confirm('Album "' + name + '" sudah ada. Gabungkan foto album ini ke sana?')) return;
  const apply = x => {
    if (x.place !== old) return;
    x.place = name;
    if (target) { x.lat = target.lat; x.lng = target.lng; if (target.address) x.address = target.address; }
  };
  busy = true;
  try {
    await updateData(list => { list.forEach(apply); return list; }, 'Ubah nama album: ' + old + ' -> ' + name);
    PHOTOS.forEach(apply);
    drafts.forEach(apply);
    filter = name;
    toast('Nama album diubah.');
  } catch (e) { toast('Gagal mengubah nama: ' + e.message); }
  busy = false; render(true);
}

async function editLocation(cur) {
  if (busy) return;
  const v = prompt('Tempel link Google Maps atau koordinat baru.\nKosongkan jika lokasi tidak ingin diubah:', '');
  if (v === null) return;
  let ll = null;
  if (v.trim()) { ll = parseLoc(v.trim()); if (!ll) return toast(unreadable(v)); }
  const a = prompt('Alamat / patokan (opsional):', cur.address || '');
  if (!ll && a === null) return;
  const apply = x => { if (ll) { x.lat = +ll.lat.toFixed(5); x.lng = +ll.lng.toFixed(5); } if (a !== null) x.address = a.trim(); };
  busy = true;
  try {
    await updateData(list => { list.forEach(x => { if (x.place === cur.place) apply(x); }); return list; }, 'Ubah lokasi: ' + cur.place);
    PHOTOS.forEach(x => { if (x.place === cur.place) apply(x); });
    drafts.forEach(x => { if (x.place === cur.place) apply(x); });
    toast('Lokasi album diperbarui.');
  } catch (e) { toast('Gagal mengubah lokasi: ' + e.message); }
  busy = false; render(true);
}

// ---------- Simpan & hapus ke GitHub ----------
$('saveBtn').onclick = async () => {
  if (busy) return;
  if (!drafts.length) return toast('Belum ada foto baru untuk disimpan.');
  busy = true; $('saveBtn').disabled = true;
  try {
    const entries = [];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      toast('Mengunggah foto ' + (i + 1) + ' dari ' + drafts.length + '…');
      await gh('/contents/photos/' + d.name, { method: 'PUT', body: JSON.stringify({ message: 'Tambah foto: ' + d.place, branch: GH_BRANCH, content: await blobB64(d.blob) }) });
      entries.push({ src: 'photos/' + d.name, place: d.place, lat: d.lat, lng: d.lng, address: d.address, caption: d.caption, date: d.date });
    }
    await updateData(list => [...entries, ...list.filter(x => !entries.some(e => e.src === x.src))], 'Perbarui daftar foto');
    entries.forEach((e, i) => PHOTOS.unshift({ ...e, path: e.src, src: drafts[i].preview }));
    drafts = [];
    toast('Tersimpan! Situs publik diperbarui dalam ±1 menit.');
  } catch (e) { toast('Gagal menyimpan: ' + e.message); }
  busy = false; $('saveBtn').disabled = false; render(false);
};

async function removeSaved(p) {
  if (busy || !confirm('Hapus foto ini dari situs?')) return;
  busy = true;
  try {
    const path = p.path || p.src;
    try { // kalau file sudah tidak ada di repo (sisa hapus yang gagal), lanjut bersihkan daftarnya
      const f = await gh('/contents/' + path + '?ref=' + GH_BRANCH);
      await gh('/contents/' + path, { method: 'DELETE', body: JSON.stringify({ message: 'Hapus foto', sha: f.sha, branch: GH_BRANCH }) });
    } catch (e) { if (!/not found/i.test(e.message)) throw e; }
    await updateData(list => list.filter(x => x.src !== path), 'Perbarui daftar foto');
    const i = PHOTOS.findIndex(x => (x.path || x.src) === path);
    if (i >= 0) PHOTOS.splice(i, 1);
    toast('Foto dihapus.');
  } catch (e) { toast('Gagal menghapus: ' + e.message); }
  busy = false; render(false);
}

async function removeAlbum(place) {
  if (busy) return;
  const n = allPhotos().filter(p => p.place === place).length;
  if (!confirm('Hapus album "' + place + '" beserta ' + n + ' foto di dalamnya? Ini tidak bisa dibatalkan.')) return;
  busy = true;
  try {
    drafts = drafts.filter(d => d.place !== place);
    const r = await readRemote();
    const targets = r.list.filter(x => x.place === place);
    for (let i = 0; i < targets.length; i++) {
      toast('Menghapus foto ' + (i + 1) + ' dari ' + targets.length + '…');
      try {
        const f = await gh('/contents/' + targets[i].src + '?ref=' + GH_BRANCH);
        await gh('/contents/' + targets[i].src, { method: 'DELETE', body: JSON.stringify({ message: 'Hapus album: ' + place, sha: f.sha, branch: GH_BRANCH }) });
      } catch (e) { if (!/not found/i.test(e.message)) throw e; } // file sudah tidak ada: lanjut
    }
    await updateData(list => list.filter(x => x.place !== place), 'Hapus album: ' + place);
    for (let i = PHOTOS.length - 1; i >= 0; i--) if (PHOTOS[i].place === place) PHOTOS.splice(i, 1);
    filter = null;
    toast('Album dihapus.');
  } catch (e) { toast('Gagal menghapus album: ' + e.message); }
  busy = false; render(true);
}

// ---------- Login admin (token GitHub) ----------
function setErr(t) { const x = $('loginErr'); if (x) x.textContent = t; }
function loginError(msg) { setErr(msg); toast(msg); }
async function tryLogin(t, remember) {
  if (GH_OWNER.startsWith('USERNAME') || GH_REPO.startsWith('NAMA_REPO')) { loginError('Isi dulu GH_OWNER dan GH_REPO di bagian atas app.js.'); return false; }
  if (!t) { loginError('Tempel token GitHub Anda (bukan kata sandi).'); return false; }
  token = t; setErr('');
  try {
    const repo = await gh('');
    if (!repo.permissions || !repo.permissions.push) throw new Error('Token ini tidak punya izin menulis ke repo. Pastikan Contents = Read and write.');
    if (remember) try { localStorage.setItem('gh_token', t); } catch (_) {}
    $('loginDlg').close(); setAdmin(true); return true;
  } catch (e) {
    token = null;
    const m = e.message;
    loginError(/bad credentials/i.test(m) ? 'Token salah atau sudah kedaluwarsa.'
      : /not found/i.test(m) ? 'Repo tidak ditemukan atau token tidak punya akses. Cek GH_OWNER dan GH_REPO di app.js, serta pilihan repo saat membuat token.'
      : /failed to fetch/i.test(m) ? 'Tidak bisa terhubung ke GitHub. Cek koneksi internet.' : m);
    return false;
  }
}
$('loginBtn').onclick = () => { setErr(''); const d = $('loginDlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); };
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  if (e.submitter && e.submitter.value === 'cancel') return $('loginDlg').close();
  const t = $('pw').value.trim();
  if (await tryLogin(t, $('remember').checked)) $('pw').value = '';
};
$('logoutBtn').onclick = () => {
  if (drafts.length && !confirm('Ada foto yang belum disimpan. Tetap keluar?')) return;
  drafts = []; token = null;
  try { localStorage.removeItem('gh_token'); } catch (_) {}
  setAdmin(false);
};
function setAdmin(v) {
  admin = v;
  $('admin').style.display = v ? 'block' : 'none';
  $('loginBtn').style.display = v ? 'none' : '';
  setTimeout(() => map.invalidateSize(), 50);
  render(false);
}

function openDrawer() { $('drawer').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); }
function closeDrawer() { $('drawer').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = openDrawer;
$('closeDrawer').onclick = closeDrawer;
$('scrim').onclick = closeDrawer;
$('dhome').onclick = () => { closeDrawer(); filter = null; render(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
$('allBtn').onclick = () => { filter = null; render(true); };
$('lb').onclick = () => $('lb').close();
render(true);
try { const t = localStorage.getItem('gh_token'); if (t) tryLogin(t, true); } catch (_) {}

// <tour>
// ---------- Putar perjalanan: peta terbang dari tempat ke tempat sesuai urutan tanggal ----------
const tour = { id: 0, paused: false, card: null, line: null, pts: [], pins: [], veh: null, snap: null };
const MOTO = '<svg viewBox="0 0 64 44" width="64" height="44" aria-hidden="true">'
  + '<g class="sl" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".75"><path d="M1 14h9M0 20h7M3 26h8"/></g>'
  + '<g class="mb"><rect x="10" y="30" width="16" height="2.6" rx="1.3" fill="#9aa5b8"/>'
  + '<path d="M13 29 C14 22 20 21 26 22 L41 21 C45 21 46 24 45 27 L42 30 L20 30 Z" fill="#ff6f9c"/>'
  + '<rect x="14" y="19" width="19" height="3.6" rx="1.8" fill="#2b0715"/>'
  + '<path d="M44 15 L50 31" stroke="#2b0715" stroke-width="2.6" stroke-linecap="round"/><path d="M41 14.5 H47" stroke="#2b0715" stroke-width="2.6" stroke-linecap="round"/>'
  + '<circle cx="48.5" cy="19" r="2.2" fill="#ffe08a"/>'
  + '<rect x="16.5" y="9" width="6" height="11" rx="3" fill="#ff9db8"/><circle cx="19.5" cy="6" r="3.7" fill="#fff8f0"/><path d="M15.8 6 a3.7 3.7 0 0 1 7.4 0z" fill="#ff6f9c"/>'
  + '<rect x="27" y="9.5" width="6.5" height="11" rx="3.2" fill="#4a5068"/><circle cx="30.5" cy="6.4" r="3.8" fill="#f1a550"/>'
  + '<path d="M32 13 L42 15.5" stroke="#4a5068" stroke-width="2.8" stroke-linecap="round"/><path d="M30 20 L35 27" stroke="#4a5068" stroke-width="3" stroke-linecap="round"/></g>'
  + '<g class="wh"><circle cx="14" cy="32" r="8" fill="none" stroke="#2b0715" stroke-width="3.4"/><circle cx="14" cy="32" r="3" fill="#ff9db8"/><path d="M14 24v16M6 32h16" stroke="#2b0715" stroke-width="1.2"/></g>'
  + '<g class="wh"><circle cx="50" cy="32" r="8" fill="none" stroke="#2b0715" stroke-width="3.4"/><circle cx="50" cy="32" r="3" fill="#ff9db8"/><path d="M50 24v16M42 32h16" stroke="#2b0715" stroke-width="1.2"/></g></svg>';
const motoIcon = flip => L.divIcon({ className: 'moto', html: '<div class="mo' + (flip ? ' flip' : '') + '">' + MOTO + '</div>', iconSize: [64, 44], iconAnchor: [32, 40] });
const HANDLERS = ['dragging', 'scrollWheelZoom', 'touchZoom', 'doubleClickZoom', 'boxZoom', 'keyboard'];
function lockMap(on) {   // saat perjalanan: peta dikunci agar tidak bentrok dengan gerak kamera
  HANDLERS.forEach(h => map[h] && map[h][on ? 'disable' : 'enable']());
  if (on && tour.snap === null) { tour.snap = map.options.zoomSnap; map.options.zoomSnap = 0; }   // zoom pecahan agar mulus
  if (!on && tour.snap !== null) { map.options.zoomSnap = tour.snap; tour.snap = null; }
}
const fmtMY = d => d ? new Date(d + 'T00:00').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '';
const tourWait = (ms, id) => new Promise(res => {   // menunggu, ikut berhenti saat dijeda; false jika perjalanan dibatalkan
  let left = ms;
  const tick = () => { if (id !== tour.id) return res(false); if (!tour.paused) left -= 100; if (left <= 0) return res(true); setTimeout(tick, 100); };
  tick();
});
// Satu perhitungan per frame: kamera, garis, dan motor selalu di titik yang sama (tidak ada selisih)
function glide(a, b, za, zb, dip, ms, id, onFrame) {
  return new Promise(res => {
    if (ms <= 0) { map.setView(b, zb, { animate: false }); if (onFrame) onFrame(b); return res(id === tour.id); }
    const t0 = performance.now();
    const f = now => {
      if (id !== tour.id) return res(false);
      const k = Math.min(1, (now - t0) / ms), e = k * k * k * (k * (6 * k - 15) + 10);
      const p = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
      map.setView(p, za + (zb - za) * e - dip * Math.sin(Math.PI * k), { animate: false });
      if (onFrame) onFrame(p);
      k < 1 ? requestAnimationFrame(f) : res(true);
    };
    requestAnimationFrame(f);
  });
}
function tourClear() {
  if (tour.line) tour.line.remove();
  if (tour.veh) tour.veh.remove();
  tour.pins.forEach(p => p.remove());
  if (tour.card) tour.card.remove();
  tour.line = tour.card = tour.veh = null; tour.pins = []; tour.pts = [];
  lockMap(false);
  $('map').classList.remove('touring');
  setTimeout(() => map.invalidateSize(), 350);
}
function stopTour() { tour.id++; tour.paused = false; tourClear(); }
function tourCardBase() {
  if (!tour.card) { const c = el('div', { className: 'tourcard' }); L.DomEvent.disableClickPropagation(c); L.DomEvent.disableScrollPropagation(c); map.getContainer().append(c); tour.card = c; }
  tour.card.replaceChildren(); return tour.card;
}
function tourCard(i, n, s) {
  const c = tourCardBase();
  const t = el('div', { className: 'tt' });
  t.append(el('small', {}, 'Tempat ' + (i + 1) + ' dari ' + n), el('strong', {}, s.place), el('span', {}, [fmtMY(s.first), s.items.length + ' foto'].filter(Boolean).join(' · ')));
  const b = el('div', { className: 'tb' });
  const pa = el('button', {}, tour.paused ? 'Lanjut' : 'Jeda'); pa.onclick = () => { tour.paused = !tour.paused; pa.textContent = tour.paused ? 'Lanjut' : 'Jeda'; };
  const op = el('button', {}, 'Buka album'); op.onclick = () => { stopTour(); openAlbum(s.place); };
  const x = el('button', { className: 'x', title: 'Hentikan' }, '×'); x.setAttribute('aria-label', 'Hentikan perjalanan'); x.onclick = stopTour;
  b.append(pa, op);
  c.append(el('img', { src: s.items[0].src, alt: s.place }), t, x, b);
}
function tourDone(stops) {
  const c = tourCardBase(), photos = stops.reduce((a, s) => a + s.items.length, 0);
  const t = el('div', { className: 'tt' });
  t.append(el('small', {}, 'Perjalanan selesai'), el('strong', {}, stops.length + ' tempat'), el('span', {}, photos + ' foto kenangan'));
  const b = el('div', { className: 'tb' });
  const again = el('button', { className: 'primary' }, 'Putar lagi'); again.onclick = playTour;
  const close = el('button', {}, 'Tutup'); close.onclick = stopTour;
  b.append(again, close);
  c.append(el('img', { src: stops[stops.length - 1].items[0].src, alt: '' }), t, b);
}
async function playTour() {
  const stops = stopsList();
  if (!stops.length) return;
  stopTour();
  const id = tour.id, reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (typeof closeDrawer === 'function') closeDrawer();
  filter = null; render(true); window.scrollTo({ top: 0, behavior: 'smooth' });
  $('map').classList.add('touring');
  if (!await tourWait(500, id)) return;
  map.invalidateSize(); lockMap(true);
  tour.line = L.polyline([], { color: '#ff6f9c', weight: 4, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i], ll = [s.lat, s.lng];
    if (i === 0) {
      const c = map.getCenter();
      if (!await glide([c.lat, c.lng], ll, map.getZoom(), 13, 0, reduce ? 0 : 2200, id)) return;
      tour.pts = [ll]; tour.line.setLatLngs([ll]);
    } else {
      const prev = tour.pts[tour.pts.length - 1], km = map.distance(prev, ll) / 1000, ms = reduce ? 0 : Math.min(7000, 2600 + km * 9);
      const fit = map.getBoundsZoom(L.latLngBounds([prev, ll]), false, L.point(70, 150));
      const dip = 13 - Math.max(3, Math.min(13, fit - .4));   // zoom keluar sedikit agar kedua tempat terlihat
      if (!reduce) tour.veh = L.marker(prev, { icon: motoIcon(ll[1] < prev[1]), interactive: false, zIndexOffset: 1000 }).addTo(map);
      const ok = await glide(prev, ll, 13, 13, dip, ms, id, p => { if (tour.veh) tour.veh.setLatLng(p); tour.line.setLatLngs([...tour.pts, p]); });
      if (tour.veh) { tour.veh.remove(); tour.veh = null; }
      if (!ok) return;
      tour.pts.push(ll); tour.line.setLatLngs(tour.pts);
    }
    tour.pins.push(L.marker(ll, { icon: L.divIcon({ className: 'tourpin', html: String(i + 1), iconSize: [26, 26] }), interactive: false, zIndexOffset: 500 }).addTo(map));
    tourCard(i, stops.length, s);
    if (!await tourWait(3400, id)) return;
  }
  lockMap(false);
  map.fitBounds(L.latLngBounds(stops.map(x => [x.lat, x.lng])).pad(.3), { maxZoom: 12, animate: !reduce, duration: 1.6 });
  tourDone(stops);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && tour.card) stopTour(); });
(function () {
  const st = document.createElement('style');
  st.textContent = '#map{transition:height .3s}#map.touring{height:clamp(320px,62vh,560px)}'
    + '.tourcard{position:absolute;left:12px;right:12px;bottom:12px;max-width:380px;z-index:1001;display:grid;grid-template-columns:56px 1fr auto;gap:6px 12px;align-items:center;background:rgba(36,16,25,.92);color:var(--ink);border:1px solid var(--line);border-radius:16px;padding:10px 12px;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);box-shadow:0 8px 28px rgba(0,0,0,.5);animation:tcIn .35s ease-out}'
    + '@keyframes tcIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}'
    + '.tourcard img{width:56px;height:56px;object-fit:cover;border-radius:12px;grid-row:1 / span 2}'
    + '.tourcard .tt{display:flex;flex-direction:column;min-width:0}.tourcard .tt small,.tourcard .tt span{color:var(--mute);font-size:12px}'
    + ".tourcard .tt strong{font:600 17px/1.2 'Fraunces',serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
    + '.tourcard .tb{grid-column:2 / span 2;display:flex;gap:8px;flex-wrap:wrap}.tourcard .tb button{padding:5px 12px;font-size:13px}'
    + '.tourcard .x{grid-column:3;grid-row:1;align-self:start;border:0;background:none;font-size:22px;line-height:1;padding:0 4px}'
    + ".tourpin{background:var(--accent);color:#2b0715;font:700 13px/22px 'DM Sans',sans-serif;text-align:center;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5)}"
    + '.leaflet-container{background:#1b1b1f}.leaflet-control-attribution{background:rgba(20,7,13,.75)!important;color:#c9a3b3!important}.leaflet-control-attribution a{color:#ff9db8!important}'
    + '.leaflet-bar a{background:#241019;color:#fbeef3;border-bottom-color:#4a2535}.leaflet-bar a:hover{background:#3a1a2a;color:#fff}'
    + '.moto{background:none;border:0}.moto .mo{width:64px;height:44px;filter:drop-shadow(0 0 1.2px rgba(255,255,255,.95)) drop-shadow(0 3px 3px rgba(0,0,0,.55))}.moto .mo.flip{transform:scaleX(-1)}'
    + '.moto .wh{transform-box:fill-box;transform-origin:center;animation:whspin .3s linear infinite}@keyframes whspin{to{transform:rotate(360deg)}}'
    + '.moto .mb{animation:mbob .32s ease-in-out infinite}@keyframes mbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.4px)}}'
    + '.moto .sl{animation:slf .45s linear infinite}@keyframes slf{0%{transform:translateX(4px);opacity:0}30%{opacity:.8}100%{transform:translateX(-6px);opacity:0}}'
    + '@media (prefers-reduced-motion:reduce){.tourcard{animation:none}#map{transition:none}.moto .wh,.moto .mb,.moto .sl{animation:none}}';
  document.head.append(st);
  const b = el('button', { id: 'tourBtn', className: 'primary' }, '▶ Putar perjalanan');
  b.style.display = 'none'; b.onclick = playTour;
  const all = $('allBtn'); if (all) all.before(b);
  render(false);   // tampilkan tombol sesuai jumlah tempat
})();
// </tour>

// ---------- Musik latar (tetap berputar saat login atau pindah album) ----------
// Taruh file lagu di repo dengan nama di bawah ini (satu folder dengan index.html).
const MUSIC_SRC = 'lagu.mp3';
const MUSIC_TITLE = 'Lagu kita';
(function () {
  const a = $('bgm'), btn = $('musicBtn'), box = $('player'), vol = $('vol');
  if (!a) return;
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
  $('musicTitle').textContent = MUSIC_TITLE;
  a.volume = ls.get('bgm_vol') !== null ? +ls.get('bgm_vol') : .5;
  vol.value = a.volume;
  const setBtn = () => { btn.innerHTML = a.paused ? '&#9654;' : '&#10074;&#10074;'; btn.setAttribute('aria-label', a.paused ? 'Putar musik' : 'Jeda musik'); };
  a.addEventListener('play', setBtn); a.addEventListener('pause', setBtn);
  a.addEventListener('error', () => { box.hidden = true; });
  // Browser memblokir suara otomatis: kalau gagal, lagu mulai pada klik/ketukan pertama di mana saja.
  function arm() {
    const evs = ['pointerdown', 'keydown'];
    const go = e => {
      if (e.target && e.target.closest && e.target.closest('#player')) return;
      evs.forEach(x => document.removeEventListener(x, go));
      if (ls.get('bgm_off') !== '1') a.play().catch(() => {});
    };
    evs.forEach(x => document.addEventListener(x, go));
  }
  a.addEventListener('loadedmetadata', () => {
    box.hidden = false;
    const p = +ls.get('bgm_pos');
    if (p > 0 && p < a.duration) a.currentTime = p;
    if (ls.get('bgm_off') !== '1') a.play().catch(arm);
  });
  btn.onclick = () => {
    if (a.paused) { ls.set('bgm_off', '0'); a.play().catch(() => {}); }
    else { ls.set('bgm_off', '1'); a.pause(); }
  };
  vol.oninput = () => { a.volume = +vol.value; ls.set('bgm_vol', vol.value); };
  setInterval(() => { if (!a.paused) ls.set('bgm_pos', Math.floor(a.currentTime)); }, 3000);
  a.src = MUSIC_SRC;
})();

// ---------- Animasi: hati melayang + dua kucing (lari, manjat, jatuh) ----------
const PET_ON = true;       // false = tanpa kucing
const HEARTS_ON = true;    // false = tanpa hati melayang
const CAT_LEAD = { kind: 'orange', body: '#f1a550', dark: '#d97f2b', white: '#fff8f0', eye: '#d7a93a' };   // kucing oranye-putih
const CAT_CHASE = { kind: 'gray', body: '#b7adb3', dark: '#716b79', white: '#fcfaf8', eye: '#6db3e8' };    // kucing abu-abu bermata biru
const WORDS_LEAD = ['Wlee, tangkap aku! 😜', 'Sayang kamu ❤', 'Kangen kamu 💕', 'Semangat ya! ✨'];
const WORDS_CHASE = ['Awas ya, kukejar! 😼', 'Meong~ 🐾', 'Peluk dong 🤗', 'Kalian lucu banget! 💞'];
const WORDS_FALL = ['Aduh! 😵', 'Bruk! 🙀', 'Hehe, jatuh 😅'];

// <cat>
const catSVG = c => {
  const gray = c.kind === 'gray';
  const leg = (cls, cx, far) => '<g class="leg ' + cls + '"><rect x="' + (cx - 3.3) + '" y="28" width="6.6" height="9.2" rx="3.3" fill="' + (far ? c.dark : c.body) + '"/>'
    + '<g class="low"><rect x="' + (cx - 3) + '" y="35.6" width="6" height="7.6" rx="3" fill="' + (far ? c.dark : c.body) + '"/><rect x="' + (cx - 3) + '" y="39" width="6" height="4.2" rx="2.1" fill="' + c.white + '"/></g></g>';
  const ear = gray ? c.dark : c.body;
  return '<svg viewBox="0 0 66 44" width="66" height="44" aria-hidden="true">'
    + '<g class="tail"><path d="M10 25 C0 26 0 11 7 7" stroke="' + c.body + '" stroke-width="6.5" stroke-linecap="round" fill="none"/>' + (gray ? '<circle cx="7" cy="7.5" r="3.3" fill="' + c.dark + '"/>' : '') + '</g>'
    + leg('l2', 20, true) + leg('l4', 39, true)
    + '<g class="body"><ellipse cx="28" cy="25" rx="20.5" ry="11.5" fill="' + c.body + '"/>'
    + (gray ? '' : '<ellipse cx="21" cy="19" rx="9" ry="4" fill="' + c.dark + '" opacity=".35"/>')
    + '<ellipse cx="27" cy="33" rx="15" ry="4.6" fill="' + c.white + '"/><ellipse cx="41" cy="29" rx="8.5" ry="8" fill="' + c.white + '"/>'
    + '<g class="head"><path d="M43 11.5 L44.6 1.2 L51.5 8.2Z" fill="' + ear + '"/><path d="M52.5 8 L58 1.2 L61 12.5Z" fill="' + ear + '"/><path d="M45.2 9.2 L45.6 4.8 L48.6 7.8Z" fill="#f3a2bb"/>'
    + '<circle cx="51.5" cy="17.5" r="10.5" fill="' + c.body + '"/>'
    + (gray ? '<ellipse cx="54" cy="18.5" rx="8.6" ry="7.6" fill="' + c.dark + '" opacity=".85"/><path d="M51.2 8.6 Q54.4 14 56 20 L52.4 20 Q50 14 51.2 8.6Z" fill="' + c.white + '"/>' : '')
    + '<ellipse cx="58" cy="21.2" rx="5" ry="4" fill="' + c.white + '"/>'
    + '<ellipse cx="55.4" cy="16.2" rx="2.5" ry="2.2" fill="' + c.eye + '"/><ellipse cx="55.9" cy="16.2" rx="1" ry="1.8" fill="#1b1b1b"/><circle cx="56.3" cy="15.4" r=".55" fill="#fff"/>'
    + '<path d="M60.6 19.3 q1.4 .2 1 1.5 q-.8 .9 -1.8 0 q-.6 -1.2 .8 -1.5z" fill="' + (gray ? '#3a3036' : '#ff8fb1') + '"/>'
    + '<path d="M59 22 L65.5 21 M59 23.2 L65.5 25" stroke="#fff" stroke-width=".7" opacity=".85"/></g></g>'
    + leg('l1', 15, false) + leg('l3', 44, false) + '</svg>';
};
// </cat>

// <sim>  (logika gerak: murni angka, tanpa DOM)
const rnd = (a, b) => a + Math.random() * (b - a);
const newCat = (x, d) => ({ x, y: 0, d, face: d, v: 0, mode: 'ground', wall: null, rot: 0, r0: 0, H: 0, hang: 0, clk: 0, slip: false, vy: 0, hopV: 0, fT: 0, fTot: 1,
  pause: 0, ph: 0, look: 0, lookT: 0, lookTo: 0, shake: 0, crouch: 0, awayDir: 0, moving: false, landed: false, started: false, bounced: false });
function drive(c, dir, speed, dt) {   // percepatan halus menuju kecepatan tujuan (tidak langsung ngebut atau berhenti)
  const a = 300 * dt;
  c.v += Math.max(-a, Math.min(a, dir * speed - c.v));
  c.x += c.v * dt; c.moving = Math.abs(c.v) > 8;
}
function startClimb(c, wall, H, maxX) { c.mode = 'climb'; c.wall = wall; c.d = wall === 'L' ? -1 : 1; c.x = wall === 'L' ? -11 : maxX + 11; c.v = 0; c.H = H; c.hang = 0; c.clk = 0; c.slip = false; c.started = true; }
function climb(c, dt) {
  c.clk += dt;
  c.y = Math.min(c.H, c.y + (46 + 20 * Math.sin(c.clk * 9)) * dt); c.moving = c.y < c.H;   // memanjat dengan tarikan bergelombang
  c.rot += ((c.wall === 'L' ? 90 : -90) - c.rot) * Math.min(1, 10 * dt);
  if (c.y >= c.H) {
    c.hang += dt; c.slip = c.hang > .45;   // cakar mulai tergelincir sebelum jatuh
    if (c.hang > .8) { c.mode = 'fall'; c.vy = 0; c.fT = 0; c.fTot = Math.max(.25, Math.sqrt(2 * c.y / 1500)); c.r0 = c.rot; c.moving = false; }
  }
}
function fall(c, dt, maxX) {
  c.fT += dt; c.vy -= 1500 * dt; c.y += c.vy * dt; c.x += (c.wall === 'L' ? 1 : -1) * 45 * dt;
  const k = Math.min(1, c.fT / (c.fTot * .55));   // refleks kucing: badan membalik tegak dalam separuh awal jatuhan
  c.rot = c.r0 * (1 - (1 - (1 - k) * (1 - k)));    // dari tegak-lurus ke datar, searah terpendek, tanpa salto
  if (c.y <= 0) { c.y = 0; c.mode = 'ground'; c.rot = 0; c.awayDir = c.wall === 'L' ? 1 : -1; c.x = Math.min(maxX, Math.max(0, c.x)); c.v = 0; c.pause = 1.1; c.crouch = .45; c.shake = .8; c.slip = false; c.landed = true; c.wall = null; }
}
function step(S, dt, maxX, maxH) {
  const { lead, chase } = S;
  S.phase += dt; S.hold = Math.max(0, S.hold - dt);
  for (const c of [lead, chase]) {
    c.moving = c.landed = c.started = c.bounced = false;
    if (c.mode === 'ground' && c.awayDir && c.pause <= 0) { c.d = c.awayDir; c.awayDir = 0; }   // setelah pulih, baru berbalik menjauh dari dinding
    if (c.mode === 'ground' && (c.x < 0 || c.x > maxX)) { c.x = Math.min(maxX, Math.max(0, c.x)); c.v = 0; }
    if (c.mode === 'fall') fall(c, dt, maxX);
    if (c.mode === 'ground' && (c.hopV || c.y > 0)) { c.y += c.hopV * dt; c.hopV -= 1400 * dt; if (c.y <= 0) { c.y = 0; c.hopV = 0; c.bounced = true; c.crouch = .22; } }
  }
  if (S.hold > 0) { for (const c of [lead, chase]) if (c.mode === 'ground') drive(c, c.d, 0, dt); return; }
  S.nextClimb -= dt;
  if (lead.mode === 'ground') {
    if (!S.wall && S.nextClimb <= 0 && chase.mode === 'ground') { S.wall = lead.x < maxX / 2 ? 'L' : 'R'; lead.d = S.wall === 'L' ? -1 : 1; lead.pause = 0; }
    if (S.wall) {
      drive(lead, lead.d, 118, dt);   // berlari semangat menuju dinding
      if ((S.wall === 'L' && lead.x <= 0) || (S.wall === 'R' && lead.x >= maxX)) startClimb(lead, S.wall, rnd(.45, .9) * maxH, maxX);
    } else if (lead.pause > 0) { lead.pause -= dt; drive(lead, lead.d, 0, dt); }
    else {
      drive(lead, lead.d, 66, dt);
      if (lead.x < 24 && lead.d < 0) lead.d = 1; else if (lead.x > maxX - 24 && lead.d > 0) lead.d = -1;
      if (Math.random() < dt * .08) lead.d = -lead.d;
      if (Math.random() < dt * .12) lead.pause = rnd(1.2, 3);
    }
  } else if (lead.mode === 'climb') climb(lead, dt);
  if (lead.landed) { S.wall = null; S.nextClimb = rnd(9, 16); }
  if (chase.mode === 'ground') {
    if (chase.pause > 0) { chase.pause -= dt; drive(chase, chase.d, 0, dt); }
    else {
      const edge = S.wall === 'L' ? 0 : maxX;
      const gap = 75 + Math.sin(S.phase * .6) * 50;
      const target = S.wall ? edge : Math.min(maxX, Math.max(0, lead.x - lead.d * gap));
      const diff = target - chase.x;
      if (Math.abs(diff) > 8) { chase.d = diff > 0 ? 1 : -1; drive(chase, chase.d, Math.min(125, Math.abs(diff) * 2.4), dt); }
      else {
        drive(chase, chase.d, 0, dt);
        chase.d = S.wall ? (S.wall === 'L' ? -1 : 1) : lead.d;
        if (S.wall && lead.mode === 'climb') startClimb(chase, S.wall, Math.max(70, lead.H * .6), maxX);
      }
      if (!S.wall && chase.y === 0 && Math.abs(lead.x - chase.x) < 60 && Math.abs(lead.v) > 20 && Math.random() < dt * .35) chase.hopV = 300;   // melompat menerkam
    }
  } else if (chase.mode === 'climb') climb(chase, dt);
}
// Pose tubuh: sudut tiap sendi, goyangan badan, kepala, dan ekor
function poseOf(c, t, dt) {
  const m = c.mode, fl = m === 'fall', hop = m === 'ground' && c.y > 0;
  const sp = m === 'ground' ? Math.abs(c.v) : m === 'climb' ? (c.slip ? 120 : c.moving ? 60 : 0) : 110;
  const g = m === 'ground' ? Math.min(1, sp / 35) : m === 'climb' ? (c.slip || c.moving ? 1 : .3) : 1;
  if (sp > 4) c.ph += dt * sp * .185;
  c.lookT -= dt; if (c.lookT <= 0) { c.lookTo = rnd(-16, 16); c.lookT = rnd(1.2, 3.2); }
  c.look += (c.lookTo - c.look) * Math.min(1, 3 * dt); c.shake = Math.max(0, c.shake - dt * 1.2); c.crouch = Math.max(0, c.crouch - dt);
  const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  const w1 = sm(62, 96, sp), w2 = sm(104, 124, sp);   // pelan = jalan 4-ketuk, lebih cepat = trot, kencang = lari melompat
  const P = Math.PI, walk = [0, P, P / 2, 1.5 * P], trot = [0, P, P, 2 * P], gal = [.8 * P, .8 * P + .2, 0, 2 * P + .2];
  const offs = walk.map((a, i) => a + (trot[i] - a) * w1).map((a, i) => a + (gal[i] - a) * w2);
  const A = Math.min(38, 15 + sp * .17), K = 42, cr = Math.min(1, c.crouch / .3), fp = fl ? c.fT / c.fTot : 0;
  const legs = offs.map((o, i) => {
    const front = i >= 2, a2 = c.ph + i * 1.7;
    if (hop) { const s = c.hopV / 300; return front ? [-34 + 10 * s, 14] : [34 - 8 * s, 22]; }   // badan terentang saat melompat
    if (fl) return fp < .5 ? [30 * Math.sin(a2), 38 + 10 * Math.sin(a2 + 1)] : (front ? [-26, 6] : [20, 10]);   // menggapai, lalu kaki terjulur siap mendarat
    if (c.slip) return [48 * Math.sin(a2), 22 * Math.max(0, -Math.cos(a2))];   // cakar menggaruk dinding
    if (cr > 0) return [front ? -16 * cr : 16 * cr, 62 * cr];                   // menekuk meredam benturan
    const a = c.ph + o;
    return [A * g * Math.sin(a), K * g * Math.max(0, -Math.cos(a))];
  });
  const arch = (1 - w2) * Math.abs(Math.sin(c.ph)) + w2 * (.5 + .5 * Math.sin(c.ph + .8));
  return {
    legs,
    bob: hop ? 0 : cr > 0 ? 3.2 * cr : -arch * (2.2 + 1.6 * w2) * g,
    pitch: hop ? -8 * c.hopV / 300 : fl ? (fp < .5 ? 0 : -4) : cr > 0 ? 3 * cr : ((1 - w2) * 1.6 * Math.sin(2 * c.ph) + w2 * 5 * Math.sin(c.ph + .8)) * g,
    head: c.look * (1 - g) + 3 * Math.sin(2 * c.ph - .8) * g + 12 * c.shake * Math.sin(t / 22),
    tail: -4 - 18 * Math.min(1, sp / 130) - (fl ? 30 : 0) + (9 + (1 - g) * 5) * Math.sin(t / (420 - Math.min(200, sp)))
  };
}
// </sim>

(function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hearts = $('hearts');
  if (!hearts) return;
  const GLYPHS = ['♥', '♥', '💗', '💕'];
  function spawn(x, y, pop) {
    if (hearts.children.length > 40) return;
    const h = document.createElement('span');
    h.className = 'heart' + (pop ? ' pop' : '');
    h.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    h.style.left = x + 'px';
    if (pop) h.style.top = y + 'px';
    h.style.fontSize = (pop ? 14 + Math.random() * 12 : 12 + Math.random() * 22) + 'px';
    h.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
    h.style.animationDuration = (pop ? .9 + Math.random() * .5 : 7 + Math.random() * 6) + 's';
    h.addEventListener('animationend', () => h.remove());
    hearts.append(h);
  }
  if (HEARTS_ON && !reduce) setInterval(() => { if (!document.hidden) spawn(Math.random() * innerWidth, 0, false); }, 1800);
  if (!PET_ON) return;

  // Pengaman: CSS lama di index.html (jika belum diperbarui) tidak boleh mengganggu gerak kaki, ekor, dan kepala.
  const fix = document.createElement('style');
  fix.textContent = '.pet .leg,.pet .low,.pet .tail,.pet .body,.pet .head{transform-box:view-box!important;transform-origin:0 0!important;animation:none!important}';
  document.head.append(fix);
  const S = { hold: 0, phase: 0, nextClimb: rnd(6, 10), wall: null };
  const pick = a => a[Math.floor(Math.random() * a.length)];
  function talk(c, text) {
    c.bubble.textContent = text; c.el.classList.add('say');
    clearTimeout(c.timer); c.timer = setTimeout(() => c.el.classList.remove('say'), 2200);
  }
  function makeCat(colors, label, words, x, d) {
    const el = document.createElement('div');
    el.className = 'pet'; el.tabIndex = 0;
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', label + '. Klik untuk menyapa');
    el.innerHTML = '<span class="bubble"></span><span class="rot"><span class="dir">' + catSVG(colors) + '</span></span>';
    document.body.append(el);
    const q = k => el.querySelector(k);
    const legs = [['l1', 15], ['l2', 20], ['l3', 44], ['l4', 39]].map(([k, cx]) => ({ cx, up: q('.' + k), low: q('.' + k + ' .low') }));
    const c = Object.assign(newCat(x, d), { el, rotEl: q('.rot'), dir: q('.dir'), bubble: q('.bubble'), bodyEl: q('.body'), headEl: q('.head'), tailEl: q('.tail'), legs, timer: null });
    const poke = () => {
      const r = el.getBoundingClientRect();
      if (!reduce) {
        if (c.mode === 'ground' && c.y === 0) c.hopV = 260;
        for (let i = 0; i < 7; i++) spawn(r.left + r.width / 2 + (Math.random() * 30 - 15), r.top, true);
      }
      talk(c, pick(words)); S.hold = 2.4;
    };
    el.addEventListener('click', poke);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); } });
    return c;
  }
  S.lead = makeCat(CAT_LEAD, 'Kucing oranye', WORDS_LEAD, 170, 1);
  S.chase = makeCat(CAT_CHASE, 'Kucing abu-abu', WORDS_CHASE, 40, 1);
  const cats = [S.lead, S.chase];
  function render(c, t, dt) {
    const p = poseOf(c, t, dt), f = n => n.toFixed(1);
    c.legs.forEach((L, i) => {
      L.up.setAttribute('transform', 'rotate(' + f(p.legs[i][0]) + ' ' + L.cx + ' 29)');
      L.low.setAttribute('transform', 'rotate(' + f(p.legs[i][1]) + ' ' + L.cx + ' 36.5)');
    });
    c.bodyEl.setAttribute('transform', 'translate(0 ' + p.bob.toFixed(2) + ') rotate(' + p.pitch.toFixed(2) + ' 16 29)');
    c.headEl.setAttribute('transform', 'rotate(' + f(p.head) + ' 46 22)');
    c.tailEl.setAttribute('transform', 'rotate(' + f(p.tail) + ' 10 25)');
    c.face += (c.d - c.face) * Math.min(1, 10 * dt);   // berbalik arah dengan halus
    const lift = Math.abs(Math.sin(c.rot * Math.PI / 180)) * 11;
    c.el.style.transform = 'translate(' + c.x + 'px,' + (-c.y - lift) + 'px)';
    c.rotEl.style.transform = 'rotate(' + c.rot + 'deg)';
    c.dir.style.transform = 'scaleX(' + c.face.toFixed(2) + ')';
  }
  if (reduce) { cats.forEach(c => render(c, 0, 0)); return; }
  let last = performance.now();
  function tick(t) {
    const dt = Math.min(.1, (t - last) / 1000); last = t;
    const maxX = Math.max(0, innerWidth - 66), maxH = Math.max(90, Math.min(300, innerHeight * .55 - 60));
    step(S, dt, maxX, maxH);
    cats.forEach(c => {
      if (c.started) talk(c, 'Manjat ah~ 🧗');
      if (c.landed || c.bounced) { c.el.classList.remove('land'); void c.el.offsetWidth; c.el.classList.add('land'); }
      if (c.landed) talk(c, pick(WORDS_FALL));
    });
    render(S.lead, t, dt); render(S.chase, t * 1.15, dt);
    if (S.lead.mode === 'ground' && S.chase.mode === 'ground' && Math.abs(S.lead.x - S.chase.x) < 45 && Math.random() < dt * .6) {
      const r = S.chase.el.getBoundingClientRect(); spawn(r.left + r.width / 2, r.top, true);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
