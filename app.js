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
// OpenStreetMap untuk situs online; Esri untuk file/localhost (OSM sering memblokir akses lokal)
const isLocal = !location.protocol.startsWith('http') || /^(localhost|127\.|192\.168\.|10\.|\[?::1)/.test(location.hostname);
if (!isLocal) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
else L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }).addTo(map);
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

function openAlbum(place) { filter = place; render(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }

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
  if (fit) {
    if (cur) map.setView([cur.lat, cur.lng], 14);
    else if (gs.length) map.fitBounds(L.latLngBounds(gs.map(x => [x.lat, x.lng])).pad(.3), { maxZoom: 12 });
  }
  $('places').replaceChildren(...gs.map(x => el('option', { value: x.place })));
  $('allBtn').style.display = cur ? '' : 'none';
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

// ---------- Animasi: hati melayang + hewan peliharaan ----------
const PET_ON = true;            // ubah ke false untuk mematikan hewan peliharaan
const HEARTS_ON = true;         // ubah ke false untuk mematikan hati melayang
const PET_EMOJI = '🐱';         // contoh lain: 🐶 🐰 🦊 🐼 🐥
const PET_WORDS = ['Sayang kamu ❤', 'Meong~', 'Kangen kamu 💕', 'Peluk dong 🤗', 'Foto kalian lucu banget!', 'Semangat ya! ✨'];
(function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hearts = $('hearts'), pet = $('pet');
  if (!hearts || !pet) return;
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
  pet.hidden = false;
  $('petBody').textContent = PET_EMOJI;
  let x = 20, dir = 1, pause = 0, hold = 0, last = performance.now();
  let say = null;
  function talk(t) {
    $('petBubble').textContent = t; pet.classList.add('say');
    clearTimeout(say); say = setTimeout(() => pet.classList.remove('say'), 2200);
  }
  function poke() {
    const r = pet.getBoundingClientRect();
    if (!reduce) {
      pet.classList.remove('jump'); void pet.offsetWidth; pet.classList.add('jump');
      for (let i = 0; i < 7; i++) spawn(r.left + r.width / 2 + (Math.random() * 30 - 15), r.top, true);
    }
    talk(PET_WORDS[Math.floor(Math.random() * PET_WORDS.length)]);
    hold = 2.2; // diam sebentar saat disapa
  }
  pet.addEventListener('click', poke);
  pet.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); poke(); } });
  function tick(t) {
    const dt = Math.min(.1, (t - last) / 1000); last = t;
    const maxX = Math.max(0, innerWidth - 44);
    let bob = 0;
    if (hold > 0) hold -= dt;
    else if (pause > 0) pause -= dt;
    else {
      x += dir * 42 * dt;
      bob = -Math.abs(Math.sin(t / 130)) * 4;
      if (x < 0) { x = 0; dir = 1; } else if (x > maxX) { x = maxX; dir = -1; }
      if (Math.random() < dt * .22) pause = 1.5 + Math.random() * 3;
      else if (Math.random() < dt * .1) dir = -dir;
    }
    pet.style.transform = 'translate(' + x + 'px,' + bob + 'px)';
    $('petDir').style.transform = dir < 0 ? 'scaleX(-1)' : 'none';
    requestAnimationFrame(tick);
  }
  if (reduce) pet.style.transform = 'translate(20px,0)'; else requestAnimationFrame(tick);
})();
