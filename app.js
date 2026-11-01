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
    ...opt,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) }
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).message) || ('Kode ' + r.status));
  return r.json();
}
const blobB64 = b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result.split(',')[1]); f.readAsDataURL(b); });
const textB64 = s => { let bin = ''; new TextEncoder().encode(s).forEach(c => bin += String.fromCharCode(c)); return btoa(bin); };
async function readRemote() {
  const f = await gh('/contents/data.js?ref=' + GH_BRANCH);
  const txt = new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const i = txt.indexOf('[', txt.indexOf('const PHOTOS'));
  return { list: JSON.parse(txt.slice(i, txt.lastIndexOf(']') + 1)), sha: f.sha };
}
const writeData = (list, sha, message) => gh('/contents/data.js', { method: 'PUT', body: JSON.stringify({
  message, sha, branch: GH_BRANCH, content: textB64('const PHOTOS = ' + JSON.stringify(list, null, 2) + ';\n') }) });

// ---------- Peta ----------
const map = L.map('map').setView([-2.5, 118], 4);
// OpenStreetMap saat dibuka lewat alamat web; Esri saat dibuka langsung dari file lokal (OSM memblokir yang ini)
if (location.protocol.startsWith('http')) L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
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
  const d = drafts.map(p => ({ src: p.preview, place: p.place, lat: p.lat, lng: p.lng, caption: p.caption, date: p.date, draft: true, ref: p }));
  return [...d, ...saved].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function render(fit) {
  const photos = allPhotos(), g = {};
  photos.forEach(p => (g[p.place] ||= { place: p.place, lat: p.lat, lng: p.lng, items: [] }).items.push(p));
  const gs = Object.values(g);
  markers.forEach(m => m.remove()); markers = [];
  gs.forEach(x => {
    const m = L.marker([x.lat, x.lng]).addTo(map).bindTooltip(x.place + ' (' + x.items.length + ')');
    m.on('click', () => { filter = x.place; render(false); $('gallery').scrollIntoView({ behavior: 'smooth' }); });
    markers.push(m);
  });
  if (fit && gs.length) map.fitBounds(L.latLngBounds(gs.map(x => [x.lat, x.lng])).pad(.3), { maxZoom: 12 });
  $('places').replaceChildren(...gs.map(x => el('option', { value: x.place })));
  $('allBtn').style.display = filter ? '' : 'none';
  $('info').textContent = photos.length + ' foto di ' + gs.length + ' tempat' + (filter ? ' · menampilkan ' + filter : '');
  const box = $('gallery'); box.replaceChildren();
  const shown = filter ? gs.filter(x => x.place === filter) : gs;
  if (!shown.length) { box.append(el('div', { className: 'empty' }, 'Belum ada foto. Masuk sebagai admin untuk menambahkan kenangan pertama.')); return; }
  shown.forEach(x => {
    const s = el('section', { className: 'group' });
    s.append(el('h2', {}, x.place), el('div', { className: 'meta' }, x.items.length + ' foto'));
    const grid = el('div', { className: 'grid' });
    x.items.forEach(p => {
      const f = el('figure');
      const img = el('img', { src: p.src, alt: p.caption || x.place, loading: 'lazy' });
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
    s.append(grid); box.append(s);
  });
}

// Kecilkan foto (maks 1600px) agar ringan
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = el('canvas', { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', .85));
}

$('addBtn').onclick = async () => {
  const place = $('place').value.trim(), files = [...$('files').files];
  if (!place || !files.length) return toast('Isi nama tempat dan pilih foto.');
  const ex = allPhotos().find(p => p.place === place);
  const pos = pick ? { lat: +pick.lat.toFixed(5), lng: +pick.lng.toFixed(5) } : ex && { lat: ex.lat, lng: ex.lng };
  if (!pos) return toast('Klik peta untuk menandai lokasi tempat baru ini.');
  for (const f of files) {
    const blob = await shrink(f);
    drafts.push({ blob, name: 'foto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.jpg', place, ...pos,
      caption: $('cap').value.trim(), date: $('date').value, preview: URL.createObjectURL(blob) });
  }
  $('files').value = ''; $('cap').value = '';
  if (pickMarker) { pickMarker.remove(); pickMarker = null; pick = null; }
  $('hint').textContent = 'Klik peta untuk menandai lokasi foto.';
  render(false);
};

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
      entries.push({ src: 'photos/' + d.name, place: d.place, lat: d.lat, lng: d.lng, caption: d.caption, date: d.date });
    }
    const r = await readRemote();
    await writeData([...entries, ...r.list], r.sha, 'Perbarui daftar foto');
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
    const f = await gh('/contents/' + path + '?ref=' + GH_BRANCH);
    await gh('/contents/' + path, { method: 'DELETE', body: JSON.stringify({ message: 'Hapus foto', sha: f.sha, branch: GH_BRANCH }) });
    const r = await readRemote();
    await writeData(r.list.filter(x => x.src !== path), r.sha, 'Perbarui daftar foto');
    PHOTOS.splice(PHOTOS.findIndex(x => (x.path || x.src) === path), 1);
    toast('Foto dihapus.');
  } catch (e) { toast('Gagal menghapus: ' + e.message); }
  busy = false; render(false);
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

$('allBtn').onclick = () => { filter = null; render(true); };
$('lb').onclick = () => $('lb').close();
render(true);
try { const t = localStorage.getItem('gh_token'); if (t) tryLogin(t, true); } catch (_) {}
