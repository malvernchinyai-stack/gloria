/* Gloria Bae – offline tuck-shop stock & sales manager.
   All data lives on the phone in IndexedDB. No internet needed after first load. */
'use strict';

/* ---------------- Database ---------------- */
const DB_NAME = 'gloriabae', DB_VER = 1;
let db;
function openDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
      const s = d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
      s.createIndex('date', 'date');
      d.createObjectStore('movements', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('library', { keyPath: 'key' });
      d.createObjectStore('settings', { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(stores, mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out, fnErr;
    Promise.resolve().then(() => fn(t)).then(v => (out = v), err => { fnErr = err; try { t.abort(); } catch (_) {} });
    t.oncomplete = () => (fnErr ? rej(fnErr) : res(out));
    t.onerror = () => rej(fnErr || t.error);
    t.onabort = () => rej(fnErr || t.error || new Error('Transaction aborted'));
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const all = store => tx([store], 'readonly', t => req(t.objectStore(store).getAll()));
const get = (store, key) => tx([store], 'readonly', t => req(t.objectStore(store).get(key)));
const put = (store, val) => tx([store], 'readwrite', t => req(t.objectStore(store).put(val)));
const del = (store, key) => tx([store], 'readwrite', t => req(t.objectStore(store).delete(key)));

/* ---------------- Settings ---------------- */
const DEFAULTS = { shopName: 'Gloria Bae', currency: '$', lowStock: 5 };
let S = { ...DEFAULTS };
async function loadSettings() {
  for (const row of await all('settings')) S[row.key] = row.value;
}
const saveSetting = (key, value) => { S[key] = value; return put('settings', { key, value }); };

/* ---------------- Helpers ---------------- */
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => S.currency + (Number(n) || 0).toFixed(2);
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const monthKey = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0'); };
const monthLabel = k => { const [y, m] = k.split('-'); return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' }); };
const isLow = p => p.qty < S.lowStock;
const stockBadge = p => p.qty <= 0 ? '<span class="badge out">Out</span>' : isLow(p) ? `<span class="badge low">${p.qty} left</span>` : `<span class="badge">${p.qty}</span>`;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

/* ---------------- Library (product-name suggestions) ---------------- */
let LIB = []; // array of names
async function seedLibrary() {
  const done = await get('settings', 'librarySeeded');
  if (done) return;
  await tx(['library'], 'readwrite', t => {
    const st = t.objectStore('library');
    SEED_LIBRARY.forEach(n => st.put({ key: n.toLowerCase(), name: n }));
  });
  await put('settings', { key: 'librarySeeded', value: true });
}
async function loadLibrary() { LIB = (await all('library')).map(r => r.name).sort((a, b) => a.localeCompare(b)); }
async function addToLibrary(name) {
  name = name.trim(); if (!name) return;
  const key = name.toLowerCase();
  if (await get('library', key)) return;
  await put('library', { key, name });
  LIB.push(name); LIB.sort((a, b) => a.localeCompare(b));
}

/* Autocomplete: attach to an <input> inside a .ac wrapper */
function attachAutocomplete(input, sourceFn, onPick) {
  const box = document.createElement('div'); box.className = 'ac-list'; box.hidden = true;
  input.parentNode.appendChild(box);
  let items = [], hl = -1;
  const render = () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { box.hidden = true; return; }
    const words = q.split(/\s+/);
    const src = sourceFn();
    const starts = [], contains = [];
    for (const n of src) {
      const l = n.toLowerCase();
      if (!words.every(w => l.includes(w))) continue;
      (l.startsWith(q) ? starts : contains).push(n);
      if (starts.length >= 8) break;
    }
    items = starts.concat(contains).slice(0, 8);
    if (!items.length || (items.length === 1 && items[0].toLowerCase() === q)) { box.hidden = true; return; }
    hl = -1;
    box.innerHTML = items.map((n, i) => `<div data-i="${i}">${highlight(n, words)}</div>`).join('');
    box.hidden = false;
  };
  const pick = i => { input.value = items[i]; box.hidden = true; onPick && onPick(items[i]); };
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', render);
  input.addEventListener('focus', render);
  input.addEventListener('blur', () => setTimeout(() => (box.hidden = true), 150));
  input.addEventListener('keydown', e => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { hl = Math.min(hl + 1, items.length - 1); mark(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(hl - 1, 0); mark(); e.preventDefault(); }
    else if (e.key === 'Enter' && hl >= 0) { pick(hl); e.preventDefault(); }
  });
  const mark = () => [...box.children].forEach((d, i) => d.classList.toggle('hl', i === hl));
  box.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); pick(+d.dataset.i); } });
}
function highlight(name, words) {
  let out = esc(name);
  words.filter(Boolean).forEach(w => {
    const re = new RegExp('(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    out = out.replace(re, '<b>$1</b>');
  });
  return out;
}

/* ---------------- Navigation ---------------- */
const TITLES = { dashboard: 'Dashboard', sell: 'Record a sale', stock: 'Stock', sales: 'Sales history', more: 'More' };
let current = 'dashboard';
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  current = tab;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#pageTitle').textContent = TITLES[tab];
  document.querySelectorAll('.fab').forEach(f => f.remove());
  ({ dashboard: renderDashboard, sell: renderSell, stock: renderStock, sales: renderSales, more: renderMore })[tab]();
  window.scrollTo(0, 0);
}

/* ---------------- Dashboard ---------------- */
async function renderDashboard() {
  const [products, sales] = await Promise.all([all('products'), all('sales')]);
  const now = new Date(), thisMonth = monthKey(now), today = now.toDateString();
  let todayTotal = 0, monthTotal = 0, monthProfit = 0, monthCount = 0;
  const byMonth = {}, topMap = {};
  for (const s of sales) {
    const k = monthKey(s.date);
    byMonth[k] = (byMonth[k] || 0) + s.total;
    if (k === thisMonth) {
      monthTotal += s.total; monthCount++;
      for (const it of s.items) {
        monthProfit += (it.price - (it.cost || 0)) * it.qty;
        topMap[it.name] = (topMap[it.name] || 0) + it.qty;
      }
    }
    if (new Date(s.date).toDateString() === today) todayTotal += s.total;
  }
  const low = products.filter(isLow).sort((a, b) => a.qty - b.qty);
  const stockValue = products.reduce((a, p) => a + Math.max(p.qty, 0) * (p.cost || 0), 0);
  // last 6 months
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(monthKey(d)); }
  const top = Object.entries(topMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="l">Today's sales</div><div class="v">${money(todayTotal)}</div></div>
      <div class="kpi"><div class="l">${esc(monthLabel(thisMonth))} sales</div><div class="v">${money(monthTotal)}</div></div>
      <div class="kpi"><div class="l">Gross profit this month</div><div class="v">${money(monthProfit)}</div></div>
      <div class="kpi ${low.length ? 'alert' : ''}"><div class="l">Items to restock (&lt; ${S.lowStock})</div><div class="v">${low.length}</div></div>
    </div>
    <div class="card">
      <h2>Monthly sales</h2>
      ${barChart(months.map(k => ({ label: monthLabel(k).split(' ')[0], value: byMonth[k] || 0 })))}
      <div class="hint">${monthCount} sale${monthCount === 1 ? '' : 's'} this month · ${products.length} products · stock value at cost ${money(stockValue)}</div>
    </div>
    <div class="card">
      <div class="sectiontitle"><h2>Low stock – restock soon</h2>${low.length ? `<button class="btn ghost small" id="seeLow">See all</button>` : ''}</div>
      ${low.length ? low.slice(0, 15).map(p => `
        <div class="row">
          <div class="grow"><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.category || 'Uncategorised')}</div></div>
          ${stockBadge(p)}
          <button class="btn sec small" data-restock="${p.id}">Restock</button>
        </div>`).join('') : '<div class="empty">All items have healthy stock. 👍</div>'}
    </div>
    <div class="card">
      <h2>Top sellers this month</h2>
      ${top.length ? top.map(([n, q]) => `<div class="row"><div class="grow name">${esc(n)}</div><div class="num">${q} sold</div></div>`).join('') : '<div class="empty">No sales recorded this month yet.</div>'}
    </div>`;
  $('#view').querySelectorAll('[data-restock]').forEach(b => b.onclick = () => restockDialog(+b.dataset.restock));
  const sl = $('#seeLow'); if (sl) sl.onclick = () => { stockFilter = 'low'; go('stock'); };
}
function barChart(data) {
  const W = 320, H = 150, pad = 22, bw = (W - pad) / data.length;
  const max = Math.max(1, ...data.map(d => d.value));
  const bars = data.map((d, i) => {
    const h = (d.value / max) * (H - 45), x = pad / 2 + i * bw + bw * 0.18, y = H - 20 - h, w = bw * 0.64;
    const last = i === data.length - 1;
    return `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, 1)}" rx="4" fill="${last ? '#6e142d' : '#d9b3bd'}"/>
      <text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>
      ${d.value ? `<text class="val" x="${x + w / 2}" y="${y - 4}" text-anchor="middle">${Math.round(d.value)}</text>` : ''}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales for the last six months">${bars}</svg>`;
}

/* ---------------- Sell ---------------- */
let cart = []; // {id, name, qty, price, cost, max}
async function renderSell() {
  const products = (await all('products')).sort((a, b) => a.name.localeCompare(b.name));
  $('#view').innerHTML = `
    <div class="card">
      <div class="ac search"><input id="sellSearch" placeholder="Search a product to sell…"></div>
      <div class="pick" id="pickGrid"></div>
    </div>
    <div class="card" id="cartCard"></div>`;
  const grid = $('#pickGrid');
  const drawPick = () => {
    const q = $('#sellSearch').value.trim().toLowerCase();
    const list = products.filter(p => !q || p.name.toLowerCase().includes(q)).slice(0, 40);
    grid.innerHTML = list.length ? list.map(p => `
      <button data-id="${p.id}" ${p.qty <= 0 ? 'disabled' : ''}>
        <span class="n">${esc(p.name)}</span>${money(p.price)} · ${p.qty <= 0 ? 'out of stock' : p.qty + ' in stock'}
      </button>`).join('') : `<div class="empty">${products.length ? 'No match.' : 'No products yet. Add them in the Stock tab.'}</div>`;
    grid.querySelectorAll('button[data-id]').forEach(b => b.onclick = () => {
      const p = products.find(x => x.id === +b.dataset.id);
      const line = cart.find(c => c.id === p.id);
      if (line) { if (line.qty < p.qty) line.qty++; else toast('Only ' + p.qty + ' in stock'); }
      else cart.push({ id: p.id, name: p.name, qty: 1, price: p.price, cost: p.cost || 0, max: p.qty });
      drawCart();
    });
  };
  $('#sellSearch').addEventListener('input', drawPick);
  drawPick(); drawCart();
}
function drawCart() {
  const total = cart.reduce((a, c) => a + c.qty * c.price, 0);
  $('#cartCard').innerHTML = `
    <h2>Current sale</h2>
    ${cart.length ? cart.map((c, i) => `
      <div class="row">
        <div class="grow"><div class="name">${esc(c.name)}</div><div class="meta">${money(c.price)} each · ${c.max} in stock</div></div>
        <div class="qty">
          <button data-dec="${i}">−</button>
          <input type="number" inputmode="numeric" min="1" max="${c.max}" value="${c.qty}" data-q="${i}">
          <button data-inc="${i}">+</button>
        </div>
        <div class="num" style="min-width:64px">${money(c.qty * c.price)}</div>
      </div>`).join('') : '<div class="empty">Tap products above to add them to this sale.</div>'}
    <div class="cart-total"><span>Total</span><span>${money(total)}</span></div>
    <div class="btnrow">
      <button class="btn sec" id="clearCart" ${cart.length ? '' : 'disabled'}>Clear</button>
      <button class="btn" id="saveSale" ${cart.length ? '' : 'disabled'}>Record sale</button>
    </div>`;
  const card = $('#cartCard');
  card.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const c = cart[+b.dataset.dec]; c.qty--; if (c.qty <= 0) cart.splice(+b.dataset.dec, 1); drawCart(); });
  card.querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { const c = cart[+b.dataset.inc]; if (c.qty < c.max) c.qty++; else toast('Only ' + c.max + ' in stock'); drawCart(); });
  card.querySelectorAll('[data-q]').forEach(inp => inp.onchange = () => {
    const c = cart[+inp.dataset.q]; let v = Math.floor(num(inp.value));
    if (v > c.max) { v = c.max; toast('Only ' + c.max + ' in stock'); }
    if (v <= 0) cart.splice(+inp.dataset.q, 1); else c.qty = v;
    drawCart();
  });
  $('#clearCart').onclick = () => { cart = []; drawCart(); };
  $('#saveSale').onclick = recordSale;
}
async function recordSale() {
  if (!cart.length) return;
  const date = new Date().toISOString();
  try {
    await tx(['products', 'sales', 'movements'], 'readwrite', async t => {
      const ps = t.objectStore('products');
      const items = [];
      for (const c of cart) {
        const p = await req(ps.get(c.id));
        if (!p) throw new Error(c.name + ' no longer exists');
        if (p.qty < c.qty) { throw new Error('Not enough ' + p.name + ' (only ' + p.qty + ')'); }
        p.qty -= c.qty; p.updatedAt = date;
        ps.put(p);
        items.push({ productId: p.id, name: p.name, qty: c.qty, price: c.price, cost: c.cost, total: c.qty * c.price });
        t.objectStore('movements').put({ productId: p.id, name: p.name, type: 'sale', qty: -c.qty, date });
      }
      t.objectStore('sales').put({ date, items, total: items.reduce((a, i) => a + i.total, 0) });
    });
    const lows = cart.filter(c => c.max - c.qty < S.lowStock).map(c => c.name);
    cart = [];
    toast('Sale recorded ✓' + (lows.length ? ' · Low stock: ' + lows.slice(0, 2).join(', ') : ''));
    renderSell();
  } catch (e) { toast(e.message || 'Could not record sale'); renderSell(); }
}

/* ---------------- Stock ---------------- */
let stockFilter = 'all';
async function renderStock() {
  const products = (await all('products')).sort((a, b) => a.name.localeCompare(b.name));
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
  $('#view').innerHTML = `
    <input class="search" id="stockSearch" placeholder="Search stock…">
    <div class="chips">
      <button class="chip ${stockFilter === 'all' ? 'on' : ''}" data-f="all">All (${products.length})</button>
      <button class="chip ${stockFilter === 'low' ? 'on' : ''}" data-f="low">Low stock (${products.filter(isLow).length})</button>
      ${cats.map(c => `<button class="chip ${stockFilter === 'cat:' + c ? 'on' : ''}" data-f="cat:${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div class="card" id="stockList"></div>`;
  const draw = () => {
    const q = $('#stockSearch').value.trim().toLowerCase();
    let list = products;
    if (stockFilter === 'low') list = list.filter(isLow);
    else if (stockFilter.startsWith('cat:')) list = list.filter(p => p.category === stockFilter.slice(4));
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q));
    $('#stockList').innerHTML = list.length ? list.map(p => `
      <div class="row" data-id="${p.id}">
        <div class="grow"><div class="name">${esc(p.name)}</div><div class="meta">${esc(p.category || 'Uncategorised')} · sells ${money(p.price)}${p.cost ? ' · cost ' + money(p.cost) : ''}</div></div>
        ${stockBadge(p)}
      </div>`).join('') : `<div class="empty">${products.length ? 'Nothing matches.' : 'No products yet. Tap + to add your first product.'}</div>`;
    $('#stockList').querySelectorAll('[data-id]').forEach(r => r.onclick = () => productActions(+r.dataset.id));
  };
  $('#stockSearch').addEventListener('input', draw);
  $('#view').querySelectorAll('[data-f]').forEach(c => c.onclick = () => { stockFilter = c.dataset.f; renderStock(); });
  draw();
  const fab = document.createElement('button'); fab.className = 'fab'; fab.textContent = '+'; fab.setAttribute('aria-label', 'Add product');
  fab.onclick = () => productForm(); document.body.appendChild(fab);
}

async function productForm(id) {
  const p = id ? await get('products', id) : { name: '', category: '', cost: '', price: '', qty: '' };
  const cats = [...new Set((await all('products')).map(x => x.category).filter(Boolean))].sort();
  openModal(`
    <h3>${id ? 'Edit product' : 'Add product'}</h3>
    <label>Product name</label>
    <div class="ac"><input id="fName" value="${esc(p.name)}" placeholder="Start typing, e.g. Fanta 2L"></div>
    <div class="hint">Suggestions come from your product library (${LIB.length} names).</div>
    <label>Category</label>
    <div class="ac"><input id="fCat" value="${esc(p.category)}" placeholder="e.g. Soft Drinks"></div>
    <div class="grid2">
      <div><label>Buying price (cost)</label><input id="fCost" type="number" inputmode="decimal" step="0.01" min="0" value="${p.cost}"></div>
      <div><label>Selling price</label><input id="fPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${p.price}"></div>
    </div>
    ${id ? `<label>Quantity in stock</label><input id="fQty" type="number" inputmode="numeric" step="1" value="${p.qty}">
      <div class="hint">To add new deliveries use <b>Restock</b> so it is logged.</div>`
         : `<label>Opening stock quantity</label><input id="fQty" type="number" inputmode="numeric" step="1" min="0" value="">`}
    <div class="btnrow" style="margin-top:16px">
      <button class="btn sec" id="fCancel">Cancel</button>
      <button class="btn" id="fSave">${id ? 'Save changes' : 'Add product'}</button>
    </div>`);
  attachAutocomplete($('#fName'), () => LIB);
  attachAutocomplete($('#fCat'), () => cats);
  $('#fCancel').onclick = closeModal;
  setTimeout(() => $('#fName').focus(), 50);
  $('#fSave').onclick = async () => {
    const name = $('#fName').value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Enter a product name');
    const price = num($('#fPrice').value);
    if (price <= 0) return toast('Enter a selling price');
    const existing = (await all('products')).find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== id);
    if (existing) return toast('“' + existing.name + '” is already in stock – use Restock');
    const now = new Date().toISOString();
    const rec = { ...p, name, category: $('#fCat').value.trim(), cost: num($('#fCost').value), price, qty: Math.floor(num($('#fQty').value)), updatedAt: now };
    if (!id) { delete rec.id; rec.createdAt = now; }
    const oldQty = id ? p.qty : 0;
    const newId = await put('products', rec);
    if (rec.qty !== oldQty) await put('movements', { productId: newId, name, type: id ? 'adjust' : 'opening', qty: rec.qty - oldQty, date: now });
    await addToLibrary(name);
    closeModal(); toast(id ? 'Product updated' : 'Product added'); go(current);
  };
}

async function productActions(id) {
  const p = await get('products', id);
  const moves = (await all('movements')).filter(m => m.productId === id).slice(-6).reverse();
  openModal(`
    <h3>${esc(p.name)}</h3>
    <div class="meta" style="color:var(--muted);font-size:13px">${esc(p.category || 'Uncategorised')} · cost ${money(p.cost)} · sells ${money(p.price)}</div>
    <div style="margin:12px 0">In stock: ${stockBadge(p)}</div>
    <div class="btnrow">
      <button class="btn" id="aRestock">Restock</button>
      <button class="btn sec" id="aEdit">Edit</button>
    </div>
    <h2 style="font-size:14px;margin:16px 0 4px">Recent stock movements</h2>
    ${moves.length ? moves.map(m => `<div class="row"><div class="grow meta">${new Date(m.date).toLocaleString()} · ${esc(m.type)}</div><div class="num">${m.qty > 0 ? '+' : ''}${m.qty}</div></div>`).join('') : '<div class="empty">None yet</div>'}
    <div class="btnrow" style="margin-top:14px">
      <button class="btn danger" id="aDelete">Delete product</button>
      <button class="btn sec" id="aClose">Close</button>
    </div>`);
  $('#aRestock').onclick = () => restockDialog(id);
  $('#aEdit').onclick = () => productForm(id);
  $('#aClose').onclick = closeModal;
  $('#aDelete').onclick = async () => {
    if (!confirm('Delete “' + p.name + '” from stock? Past sales stay in history. The name stays in the library.')) return;
    await del('products', id); closeModal(); toast('Product deleted'); go(current);
  };
}

async function restockDialog(id) {
  const p = await get('products', id);
  openModal(`
    <h3>Restock ${esc(p.name)}</h3>
    <div class="hint">Currently ${p.qty} in stock.</div>
    <label>Quantity received</label>
    <input id="rQty" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 24">
    <div class="grid2">
      <div><label>New buying price (optional)</label><input id="rCost" type="number" inputmode="decimal" step="0.01" min="0" value="${p.cost || ''}"></div>
      <div><label>New selling price (optional)</label><input id="rPrice" type="number" inputmode="decimal" step="0.01" min="0" value="${p.price || ''}"></div>
    </div>
    <div class="btnrow" style="margin-top:16px">
      <button class="btn sec" id="rCancel">Cancel</button>
      <button class="btn" id="rSave">Add to stock</button>
    </div>`);
  setTimeout(() => $('#rQty').focus(), 50);
  $('#rCancel').onclick = closeModal;
  $('#rSave').onclick = async () => {
    const q = Math.floor(num($('#rQty').value));
    if (q <= 0) return toast('Enter the quantity received');
    const now = new Date().toISOString();
    p.qty += q; p.updatedAt = now;
    if (num($('#rCost').value) > 0) p.cost = num($('#rCost').value);
    if (num($('#rPrice').value) > 0) p.price = num($('#rPrice').value);
    await put('products', p);
    await put('movements', { productId: id, name: p.name, type: 'restock', qty: q, date: now });
    closeModal(); toast(`+${q} ${p.name} · now ${p.qty}`); go(current);
  };
}

/* ---------------- Sales history ---------------- */
let salesMonth = monthKey(new Date());
async function renderSales() {
  const sales = (await all('sales')).sort((a, b) => b.date.localeCompare(a.date));
  const months = [...new Set([monthKey(new Date()), ...sales.map(s => monthKey(s.date))])].sort().reverse();
  const list = sales.filter(s => monthKey(s.date) === salesMonth);
  const total = list.reduce((a, s) => a + s.total, 0);
  const profit = list.reduce((a, s) => a + s.items.reduce((b, i) => b + (i.price - (i.cost || 0)) * i.qty, 0), 0);
  // group by day
  const days = {};
  list.forEach(s => { const d = new Date(s.date).toDateString(); (days[d] = days[d] || []).push(s); });
  $('#view').innerHTML = `
    <select id="monthSel" class="search">${months.map(m => `<option value="${m}" ${m === salesMonth ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select>
    <div class="kpis">
      <div class="kpi"><div class="l">Total sales</div><div class="v">${money(total)}</div></div>
      <div class="kpi"><div class="l">Gross profit</div><div class="v">${money(profit)}</div></div>
    </div>
    ${Object.keys(days).length ? Object.entries(days).map(([d, ss]) => `
      <div class="card">
        <div class="sectiontitle"><h2>${esc(new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</h2><b class="num">${money(ss.reduce((a, s) => a + s.total, 0))}</b></div>
        ${ss.map(s => `
          <div class="row" data-sale="${s.id}">
            <div class="grow"><div class="name">${esc(s.items.map(i => i.qty + '× ' + i.name).join(', '))}</div>
            <div class="meta">${new Date(s.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div></div>
            <div class="num">${money(s.total)}</div>
          </div>`).join('')}
      </div>`).join('') : '<div class="card empty">No sales in this month.</div>'}`;
  $('#monthSel').onchange = e => { salesMonth = e.target.value; renderSales(); };
  $('#view').querySelectorAll('[data-sale]').forEach(r => r.onclick = () => saleDetail(+r.dataset.sale));
}
async function saleDetail(id) {
  const s = await get('sales', id);
  openModal(`
    <h3>Sale · ${esc(new Date(s.date).toLocaleString())}</h3>
    ${s.items.map(i => `<div class="row"><div class="grow">${i.qty}× ${esc(i.name)}<div class="meta">${money(i.price)} each</div></div><div class="num">${money(i.total)}</div></div>`).join('')}
    <div class="cart-total"><span>Total</span><span>${money(s.total)}</span></div>
    <div class="btnrow">
      <button class="btn danger" id="voidSale">Void sale &amp; return stock</button>
      <button class="btn sec" id="sClose">Close</button>
    </div>`);
  $('#sClose').onclick = closeModal;
  $('#voidSale').onclick = async () => {
    if (!confirm('Void this sale? The items will be added back to stock.')) return;
    const now = new Date().toISOString();
    await tx(['products', 'sales', 'movements'], 'readwrite', async t => {
      const ps = t.objectStore('products');
      for (const i of s.items) {
        const p = await req(ps.get(i.productId));
        if (p) { p.qty += i.qty; ps.put(p); }
        t.objectStore('movements').put({ productId: i.productId, name: i.name, type: 'void', qty: i.qty, date: now });
      }
      t.objectStore('sales').delete(id);
    });
    closeModal(); toast('Sale voided, stock returned'); renderSales();
  };
}

/* ---------------- More: library, settings, backup ---------------- */
async function renderMore() {
  $('#view').innerHTML = `
    <div class="card">
      <h2>Product name library</h2>
      <div class="hint" style="margin-top:-6px">Names that pop up when adding products. Every new product is added here automatically. This is <b>not</b> stock.</div>
      <div class="ac" style="margin-top:10px"><input id="libSearch" placeholder="Search or type a new name…"></div>
      <div class="btnrow" style="margin-top:8px"><button class="btn sec small" id="libAdd">Add name to library</button></div>
      <div id="libList" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2>Settings</h2>
      <label>Shop name</label><input id="sName" value="${esc(S.shopName)}">
      <div class="grid2">
        <div><label>Currency symbol</label><input id="sCur" value="${esc(S.currency)}" maxlength="4"></div>
        <div><label>Flag low stock when below</label><input id="sLow" type="number" min="1" value="${S.lowStock}"></div>
      </div>
      <button class="btn block" style="margin-top:12px" id="sSave">Save settings</button>
    </div>
    <div class="card">
      <h2>Backup &amp; export</h2>
      <div class="hint" style="margin-top:-6px">Your data lives only on this phone. Make a backup regularly and keep it somewhere safe (e.g. WhatsApp to yourself or Google Drive).</div>
      <div class="btnrow" style="margin-top:10px">
        <button class="btn" id="bExport">Backup data</button>
        <button class="btn sec" id="bImport">Restore backup</button>
      </div>
      <div class="btnrow" style="margin-top:8px">
        <button class="btn sec" id="bSalesCsv">Sales CSV</button>
        <button class="btn sec" id="bStockCsv">Stock CSV</button>
      </div>
      <input type="file" id="bFile" accept=".json,application/json" hidden>
    </div>
    <div class="hint" style="text-align:center">Gloria Bae v1.0 · works offline</div>`;

  const drawLib = () => {
    const q = $('#libSearch').value.trim().toLowerCase();
    const list = (q ? LIB.filter(n => n.toLowerCase().includes(q)) : LIB).slice(0, 60);
    $('#libList').innerHTML = `<div class="meta" style="color:var(--muted);font-size:12px">${LIB.length} names${q ? ' · showing matches' : ' · showing first 60'}</div>` +
      list.map(n => `<div class="row"><div class="grow">${esc(n)}</div><button class="btn ghost small" data-del="${esc(n)}">Remove</button></div>`).join('');
    $('#libList').querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await del('library', b.dataset.del.toLowerCase());
      LIB = LIB.filter(n => n !== b.dataset.del); drawLib();
    });
  };
  $('#libSearch').addEventListener('input', drawLib);
  $('#libAdd').onclick = async () => {
    const n = $('#libSearch').value.trim().replace(/\s+/g, ' ');
    if (!n) return toast('Type a name first');
    if (LIB.some(x => x.toLowerCase() === n.toLowerCase())) return toast('Already in library');
    await addToLibrary(n); toast('Added to library'); drawLib();
  };
  drawLib();

  $('#sSave').onclick = async () => {
    await saveSetting('shopName', $('#sName').value.trim() || 'Gloria Bae');
    await saveSetting('currency', $('#sCur').value.trim() || '$');
    await saveSetting('lowStock', Math.max(1, Math.floor(num($('#sLow').value)) || 5));
    $('#shopTitle').textContent = S.shopName; toast('Settings saved');
  };
  $('#bExport').onclick = exportBackup;
  $('#bImport').onclick = () => $('#bFile').click();
  $('#bFile').onchange = importBackup;
  $('#bSalesCsv').onclick = async () => {
    const rows = [['Date', 'Time', 'Product', 'Qty', 'Unit price', 'Line total', 'Cost each']];
    (await all('sales')).sort((a, b) => a.date.localeCompare(b.date)).forEach(s => s.items.forEach(i => {
      const d = new Date(s.date);
      rows.push([d.toLocaleDateString(), d.toLocaleTimeString(), i.name, i.qty, i.price.toFixed(2), i.total.toFixed(2), (i.cost || 0).toFixed(2)]);
    }));
    download('gloria-bae-sales.csv', toCSV(rows), 'text/csv');
  };
  $('#bStockCsv').onclick = async () => {
    const rows = [['Product', 'Category', 'Qty', 'Cost', 'Price', 'Low stock']];
    (await all('products')).sort((a, b) => a.name.localeCompare(b.name)).forEach(p => rows.push([p.name, p.category, p.qty, (p.cost || 0).toFixed(2), p.price.toFixed(2), isLow(p) ? 'YES' : '']));
    download('gloria-bae-stock.csv', toCSV(rows), 'text/csv');
  };
}
const toCSV = rows => rows.map(r => r.map(v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
async function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportBackup() {
  const data = { app: 'Gloria Bae', version: 1, exportedAt: new Date().toISOString() };
  for (const s of ['products', 'sales', 'movements', 'library', 'settings']) data[s] = await all(s);
  const stamp = new Date().toISOString().slice(0, 10);
  download(`gloria-bae-backup-${stamp}.json`, JSON.stringify(data), 'application/json');
}
async function importBackup(e) {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch { return toast('That file is not a valid backup'); }
  if (data.app !== 'Gloria Bae') return toast('That file is not a Gloria Bae backup');
  if (!confirm('Restore this backup? Everything currently on this phone will be replaced.')) return;
  const stores = ['products', 'sales', 'movements', 'library', 'settings'];
  await tx(stores, 'readwrite', t => stores.forEach(s => {
    const st = t.objectStore(s); st.clear(); (data[s] || []).forEach(r => st.put(r));
  }));
  await loadSettings(); await loadLibrary();
  $('#shopTitle').textContent = S.shopName; toast('Backup restored'); go('dashboard');
}

/* ---------------- Start ---------------- */
(async function init() {
  db = await openDB();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  await loadSettings();
  await seedLibrary();
  await loadLibrary();
  $('#shopTitle').textContent = S.shopName;
  go('dashboard');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
