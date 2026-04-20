'use strict';

let accounts = [];
let categories = [];
let currentTxType = 'expense';
let editingAccountId = null;
let editingRecurringId = null;
let editingCategoryId = null;

// ── Utility ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function today() { return new Date().toISOString().slice(0, 10); }

function fmtAmount(n) {
  return 'NT$ ' + Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

const ACCOUNT_TYPE_LABELS = { asset: '資產', liabilities: '負債', revenue: '收入來源', expense: '支出類別' };
const FREQ_LABELS = { daily: '每日', weekly: '每週', monthly: '每月', yearly: '每年' };
const PIE_COLORS = ['#818cf8','#34d399','#f59e0b','#f87171','#38bdf8','#a78bfa','#fb923c','#4ade80','#e879f9','#94a3b8'];

// ── Tab Navigation ───────────────────────────────────────────────────────────

function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const navigate = () => {
    const hash = location.hash.slice(1) || 'transactions';

    // Share-link route: #trip/:share_token
    const shareMatch = hash.match(/^trip\/([a-zA-Z0-9]+)$/);
    if (shareMatch) {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      loadTripSharePage(shareMatch[1]);
      return;
    }

    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === hash));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + hash));

    if (hash === 'accounts') loadAccountsPage();
    if (hash === 'recurring') loadRecurringPage();
    if (hash === 'budgets') loadBudgetsPage();
    if (hash === 'reports') loadReportsPage();
    if (hash === 'trips') loadTripsPage();
    if (hash === 'categories') loadCategoriesPage();
  };
  window.addEventListener('hashchange', navigate);
  navigate();
}

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadAccounts() {
  accounts = await api('GET', '/api/accounts');
}

async function loadCategories() {
  categories = await api('GET', '/api/categories');

  // Populate filter category dropdown
  const filterCatSel = document.getElementById('filter-category');
  filterCatSel.innerHTML = '<option value="">全部</option>';
  categories.forEach(c => {
    filterCatSel.insertAdjacentHTML('beforeend',
      `<option value="${c.id}">${escHtml(c.icon || '')} ${escHtml(c.name)}</option>`);
  });
}

// ── Transaction Type Toggle ──────────────────────────────────────────────────

function initTxType() {
  document.querySelectorAll('.tx-type').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tx-type').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTxType = btn.dataset.type;
      populateAccountDropdowns();
    });
  });
}

function populateAccountDropdowns() {
  const srcSel = document.getElementById('source-account');
  const dstSel = document.getElementById('dest-account');
  const catRow = document.getElementById('category-row');

  srcSel.innerHTML = '';
  dstSel.innerHTML = '';

  if (currentTxType === 'expense') {
    // Source: asset accounts; Dest: expense accounts
    accounts.filter(a => a.type === 'asset').forEach(a => {
      srcSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
    });
    accounts.filter(a => a.type === 'expense').forEach(a => {
      dstSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
    });
    catRow.style.display = '';
  } else if (currentTxType === 'income') {
    // Source: revenue accounts; Dest: asset accounts
    accounts.filter(a => a.type === 'revenue').forEach(a => {
      srcSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
    });
    accounts.filter(a => a.type === 'asset').forEach(a => {
      dstSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
    });
    catRow.style.display = 'none';
  } else {
    // Transfer: asset to asset
    accounts.filter(a => a.type === 'asset' || a.type === 'liabilities').forEach(a => {
      srcSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
      dstSel.insertAdjacentHTML('beforeend', `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`);
    });
    catRow.style.display = 'none';
  }

  populateCategoryDropdown();
}

function populateCategoryDropdown() {
  const catSel = document.getElementById('category');
  catSel.innerHTML = '<option value="">（無）</option>';
  categories.forEach(c => {
    catSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escHtml(c.icon || '')} ${escHtml(c.name)}</option>`);
  });
  updateSubcategoryDropdown();
}

function updateSubcategoryDropdown() {
  const catId = parseInt(document.getElementById('category').value);
  const subSel = document.getElementById('subcategory');
  subSel.innerHTML = '<option value="">（無）</option>';
  const cat = categories.find(c => c.id === catId);
  if (cat && cat.subcategories.length > 0) {
    cat.subcategories.forEach(s => {
      subSel.insertAdjacentHTML('beforeend', `<option value="${s.id}">${escHtml(s.name)}</option>`);
    });
  }
}

document.getElementById('category').addEventListener('change', updateSubcategoryDropdown);

// ── Transaction List ─────────────────────────────────────────────────────────

async function loadTransactions() {
  const q = document.getElementById('filter-q').value.trim();
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  const type = document.getElementById('filter-type').value;
  const catId = document.getElementById('filter-category').value;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (type) params.set('type', type);
  if (catId) params.set('category_id', catId);

  const txs = await api('GET', '/api/transactions?' + params);
  renderTransactions(txs);

  // Show trend chart when searching
  const trendSection = document.getElementById('search-trend');
  if (q) {
    trendSection.style.display = '';
    loadTrendChart(q);
  } else {
    trendSection.style.display = 'none';
  }
}

async function loadTrendChart(q) {
  const data = await api('GET', '/api/transactions/trend?q=' + encodeURIComponent(q));
  const container = document.getElementById('trend-chart');
  if (data.length === 0) { container.innerHTML = '<p class="empty">無趨勢資料</p>'; return; }

  const max = Math.max(...data.map(d => d.total), 1);
  container.innerHTML = '<div class="bar-chart">' + data.map(d => {
    const w = (d.total / max * 100).toFixed(1);
    return `
      <div class="bar-row">
        <div class="bar-label">${d.month}</div>
        <div class="bar-group">
          <div class="bar expense-bar" style="width:${w}%">${fmtAmount(d.total)} (${d.count}筆)</div>
        </div>
      </div>`;
  }).join('') + '</div>';
}

function getTxType(tx) {
  if (tx.source_type === 'asset' && tx.dest_type === 'expense') return 'expense';
  if (tx.source_type === 'revenue' && tx.dest_type === 'asset') return 'income';
  if (tx.source_type === 'asset' && tx.dest_type === 'asset') return 'transfer';
  return 'other';
}

function renderTransactions(txs) {
  const list = document.getElementById('tx-list');
  const summary = document.getElementById('summary');

  if (txs.length === 0) {
    list.innerHTML = '<p class="empty">沒有交易紀錄</p>';
    summary.textContent = '共 0 筆';
    return;
  }

  const totalExpense = txs.filter(t => getTxType(t) === 'expense').reduce((s, t) => s + t.amount, 0);
  const totalIncome = txs.filter(t => getTxType(t) === 'income').reduce((s, t) => s + t.amount, 0);
  summary.textContent = `共 ${txs.length} 筆 | 支出 ${fmtAmount(totalExpense)} | 收入 ${fmtAmount(totalIncome)}`;

  list.innerHTML = txs.map(tx => {
    const type = getTxType(tx);
    const icon = tx.category_icon || tx.dest_icon || '💰';
    const amtClass = type === 'income' ? 'income' : type === 'transfer' ? 'transfer' : '';
    const prefix = type === 'income' ? '+' : type === 'transfer' ? '' : '-';
    const tags = tx.tags ? `<span class="expense-tags">${tx.tags.split(',').map(t => '#' + t.trim()).join(' ')}</span>` : '';
    const desc = tx.description ? escHtml(tx.description) : (tx.category_name || tx.dest_name);
    const subLabel = tx.subcategory_name ? ` / ${escHtml(tx.subcategory_name)}` : '';
    const flow = `${tx.source_name} → ${tx.dest_name}`;
    const note = tx.note ? `${escHtml(tx.note)}　` : '';

    return `
      <div class="expense-item" data-id="${tx.id}">
        <div class="expense-icon">${icon}</div>
        <div class="expense-info">
          <div class="expense-main">
            <span class="expense-category">${desc}${subLabel}</span>
            <span class="expense-amount ${amtClass}">${prefix}${fmtAmount(tx.amount)}</span>
          </div>
          <div class="expense-sub">
            ${tx.date}　<span class="expense-flow">${flow}</span>　${note}${tags}
          </div>
        </div>
        <div class="expense-actions">
          <button class="secondary" onclick="startEditTx(${tx.id})">編輯</button>
          <button class="danger" onclick="deleteTx(${tx.id})">刪除</button>
        </div>
      </div>`;
  }).join('');
}

// ── Inline Calendar Picker ───────────────────────────────────────────────────

function makeCal(pickerId, inputId) {
  const calEl = document.getElementById(pickerId);
  const calInput = document.getElementById(inputId);
  const DOW = ['日','一','二','三','四','五','六'];
  const MONTHS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  let _year, _month;

  function _render() {
    const sel = calInput.value;
    const tod = today();
    const first = new Date(_year, _month, 1);
    const last  = new Date(_year, _month + 1, 0);
    const startDow = first.getDay();

    let html = `<div class="cal-header">
      <button type="button" class="cal-nav" data-dir="prev">‹</button>
      <span class="cal-title">${_year} 年 ${MONTHS[_month]}</span>
      <button type="button" class="cal-nav" data-dir="next">›</button>
    </div><div class="cal-grid">`;

    DOW.forEach(d => { html += `<div class="cal-dow">${d}</div>`; });
    for (let i = 0; i < startDow; i++) html += '<div class="cal-day cal-empty"></div>';
    for (let d = 1; d <= last.getDate(); d++) {
      const ds = `${_year}-${String(_month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cls = ['cal-day', ds === sel ? 'selected' : '', ds === tod && ds !== sel ? 'is-today' : ''].filter(Boolean).join(' ');
      html += `<div class="${cls}" data-date="${ds}">${d}</div>`;
    }
    html += '</div>';
    calEl.innerHTML = html;

    calEl.querySelector('[data-dir="prev"]').addEventListener('click', () => {
      _month--; if (_month < 0) { _month = 11; _year--; } _render();
    });
    calEl.querySelector('[data-dir="next"]').addEventListener('click', () => {
      _month++; if (_month > 11) { _month = 0; _year++; } _render();
    });
    calEl.querySelectorAll('.cal-day[data-date]').forEach(el => {
      el.addEventListener('click', () => { calInput.value = el.dataset.date; _render(); });
    });
  }

  return function init(dateStr) {
    const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
    _year  = d.getFullYear();
    _month = d.getMonth();
    calInput.value = dateStr || today();
    _render();
  };
}

window.calInit = makeCal('cal-picker', 'date');
window.texpCalInit = makeCal('texp-cal-picker', 'texp-date');

// ── Transaction Form ─────────────────────────────────────────────────────────

calInit(today());

document.getElementById('tx-form').addEventListener('submit', async e => {
  e.preventDefault();
  const editId = document.getElementById('edit-id').value;
  const body = {
    amount: parseFloat(document.getElementById('amount').value),
    date: document.getElementById('date').value,
    source_account_id: parseInt(document.getElementById('source-account').value),
    dest_account_id: parseInt(document.getElementById('dest-account').value),
    category_id: parseInt(document.getElementById('category').value) || null,
    subcategory_id: parseInt(document.getElementById('subcategory').value) || null,
    description: document.getElementById('description').value.trim() || null,
    note: document.getElementById('note').value.trim() || null,
    tags: document.getElementById('tags').value.trim() || null,
  };

  try {
    if (editId) {
      await api('PUT', `/api/transactions/${editId}`, body);
    } else {
      await api('POST', '/api/transactions', body);
    }
    resetTxForm();
    await loadAccounts();
    loadTransactions();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

document.getElementById('cancel-btn').addEventListener('click', resetTxForm);

function resetTxForm() {
  document.getElementById('tx-form').reset();
  document.getElementById('edit-id').value = '';
  calInit(today());
  document.getElementById('form-title').textContent = '新增交易';
  document.getElementById('submit-btn').textContent = '新增';
  document.getElementById('cancel-btn').style.display = 'none';
  currentTxType = 'expense';
  document.querySelectorAll('.tx-type').forEach(b => b.classList.remove('active'));
  document.querySelector('.tx-type[data-type="expense"]').classList.add('active');
  populateAccountDropdowns();
}

async function startEditTx(id) {
  const txs = await api('GET', '/api/transactions?from=2000-01-01');
  const tx = txs.find(t => t.id === id);
  if (!tx) return;

  const type = getTxType(tx);
  currentTxType = type;
  document.querySelectorAll('.tx-type').forEach(b => b.classList.remove('active'));
  const typeBtn = document.querySelector(`.tx-type[data-type="${type}"]`);
  if (typeBtn) typeBtn.classList.add('active');

  populateAccountDropdowns();

  document.getElementById('edit-id').value = tx.id;
  document.getElementById('amount').value = tx.amount;
  calInit(tx.date);
  document.getElementById('source-account').value = tx.source_account_id;
  document.getElementById('dest-account').value = tx.dest_account_id;
  document.getElementById('category').value = tx.category_id || '';
  updateSubcategoryDropdown();
  document.getElementById('subcategory').value = tx.subcategory_id || '';
  document.getElementById('description').value = tx.description || '';
  document.getElementById('note').value = tx.note || '';
  document.getElementById('tags').value = tx.tags || '';

  document.getElementById('form-title').textContent = '編輯交易';
  document.getElementById('submit-btn').textContent = '儲存';
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('form-section').scrollIntoView({ behavior: 'smooth' });
}

async function deleteTx(id) {
  if (!confirm('確定刪除這筆交易？')) return;
  try {
    await api('DELETE', `/api/transactions/${id}`);
    await loadAccounts();
    loadTransactions();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// Filters
document.getElementById('filter-btn').addEventListener('click', loadTransactions);
document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('filter-q').value = '';
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-type').value = '';
  document.getElementById('filter-category').value = '';
  loadTransactions();
});

// ── Accounts Page ────────────────────────────────────────────────────────────

async function loadAccountsPage() {
  await loadAccounts();
  const container = document.getElementById('account-groups');
  const groups = {};

  for (const a of accounts) {
    if (!groups[a.type]) groups[a.type] = [];
    groups[a.type].push(a);
  }

  let html = '';
  const order = ['asset', 'liabilities', 'revenue', 'expense'];
  for (const type of order) {
    const accs = groups[type];
    if (!accs || accs.length === 0) continue;
    const rawTotal = accs.reduce((s, a) => s + a.balance, 0);
    const total = (type === 'revenue' || type === 'expense') ? Math.abs(rawTotal) : rawTotal;
    html += `<div class="account-group"><h3>${ACCOUNT_TYPE_LABELS[type]}</h3>`;
    for (const a of accs) {
      const displayBalance = (type === 'revenue' || type === 'expense') ? Math.abs(a.balance) : a.balance;
      const negClass = a.balance < 0 && type !== 'revenue' && type !== 'expense' ? 'negative' : '';
      if (editingAccountId === a.id) {
        html += `
          <div class="account-card account-card--editing">
            <input id="acc-edit-icon-${a.id}" value="${escHtml(a.icon || '')}" maxlength="4" style="width:3rem;text-align:center;font-size:1.25rem;padding:0.3rem;" />
            <input id="acc-edit-name-${a.id}" value="${escHtml(a.name)}" style="flex:1;padding:0.3rem 0.5rem;" />
            <div class="expense-actions" style="display:flex;gap:0.3rem;">
              <button onclick="saveAccountEdit(${a.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">儲存</button>
              <button class="secondary" onclick="cancelAccountEdit()" style="padding:0.3rem 0.6rem;font-size:0.75rem">取消</button>
            </div>
          </div>`;
      } else {
        html += `
          <div class="account-card">
            <div class="acc-icon">${a.icon}</div>
            <div class="acc-info"><div class="acc-name">${escHtml(a.name)}</div></div>
            <div class="acc-balance ${negClass}">${fmtAmount(displayBalance)}</div>
            <div class="expense-actions" style="display:flex;gap:0.3rem;">
              <button onclick="startAccountEdit(${a.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">編輯</button>
              <button class="danger" onclick="deleteAccount(${a.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">刪除</button>
            </div>
          </div>`;
      }
    }
    html += `<div class="account-total">小計 ${fmtAmount(total)}</div></div>`;
  }

  // Net worth
  const assetTotal = (groups.asset || []).reduce((s, a) => s + a.balance, 0);
  const liabTotal = (groups.liabilities || []).reduce((s, a) => s + a.balance, 0);
  html += `<div class="account-total" style="background:#d1fae5;color:#065f46;margin-top:1rem">淨資產 ${fmtAmount(assetTotal - liabTotal)}</div>`;

  container.innerHTML = html;
}

document.getElementById('account-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById('acc-name').value.trim(),
    type: document.getElementById('acc-type').value,
    icon: document.getElementById('acc-icon').value.trim() || '💰',
    initial_balance: parseFloat(document.getElementById('acc-balance').value) || 0,
  };
  try {
    await api('POST', '/api/accounts', body);
    document.getElementById('account-form').reset();
    await loadAccounts();
    loadAccountsPage();
    populateAccountDropdowns();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

async function deleteAccount(id) {
  if (!confirm('確定刪除此帳戶？有交易關聯的帳戶無法刪除。')) return;
  try {
    await api('DELETE', `/api/accounts/${id}`);
    await loadAccounts();
    loadAccountsPage();
    populateAccountDropdowns();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

function startAccountEdit(id) {
  editingAccountId = id;
  loadAccountsPage();
}

function cancelAccountEdit() {
  editingAccountId = null;
  loadAccountsPage();
}

async function saveAccountEdit(id) {
  const nameInput = document.getElementById(`acc-edit-name-${id}`);
  const iconInput = document.getElementById(`acc-edit-icon-${id}`);
  const name = nameInput.value.trim();
  const icon = iconInput.value.trim();
  if (!name) {
    alert('名稱不可為空');
    return;
  }
  try {
    await api('PUT', `/api/accounts/${id}`, { name, icon: icon || '💰' });
    editingAccountId = null;
    await loadAccounts();
    loadAccountsPage();
    populateAccountDropdowns();
  } catch (err) {
    alert('更新失敗：' + err.message);
  }
}

// ── Recurring Page ───────────────────────────────────────────────────────────

function populateRecurringDropdowns() {
  const srcSel = document.getElementById('rec-source');
  const dstSel = document.getElementById('rec-dest');
  const catSel = document.getElementById('rec-category');

  srcSel.innerHTML = '';
  dstSel.innerHTML = '';
  catSel.innerHTML = '<option value="">（無）</option>';

  // Group accounts by type for clarity
  const typeOrder = ['asset', 'liabilities', 'revenue', 'expense'];
  typeOrder.forEach(type => {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) return;
    const label = ACCOUNT_TYPE_LABELS[type];
    const srcGrp = document.createElement('optgroup');
    srcGrp.label = label;
    const dstGrp = document.createElement('optgroup');
    dstGrp.label = label;
    group.forEach(a => {
      const html = `<option value="${a.id}">${escHtml(a.icon)} ${escHtml(a.name)}</option>`;
      srcGrp.insertAdjacentHTML('beforeend', html);
      dstGrp.insertAdjacentHTML('beforeend', html);
    });
    srcSel.appendChild(srcGrp);
    dstSel.appendChild(dstGrp);
  });
  categories.forEach(c => {
    catSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escHtml(c.icon || '')} ${escHtml(c.name)}</option>`);
  });

  // Default destination to first expense account (more useful for recurring expenses)
  const firstExpense = accounts.find(a => a.type === 'expense');
  if (firstExpense) dstSel.value = firstExpense.id;

  document.getElementById('rec-next').value = today();
}

async function loadRecurringPage() {
  populateRecurringDropdowns();
  const items = await api('GET', '/api/recurring');
  const container = document.getElementById('recurring-list');
  if (items.length === 0) {
    container.innerHTML = '<p class="empty">尚無固定交易</p>';
    return;
  }

  const todayStr = today();
  container.innerHTML = items.map(r => {
    if (editingRecurringId === r.id) return renderRecurringEditRow(r);
    const isDue = r.next_date <= todayStr;
    return `
      <div class="recurring-item">
        <div class="rec-info">
          <div class="rec-title">${escHtml(r.title)}
            <span class="badge">${FREQ_LABELS[r.repeat_freq]}</span>
            ${isDue ? '<span class="badge due">到期</span>' : ''}
            ${!r.active ? '<span class="badge" style="background:#fee2e2;color:#991b1b">已停用</span>' : ''}
          </div>
          <div class="rec-detail">${r.source_name} → ${r.dest_name} | 下次：${r.next_date}${r.category_name ? ' | ' + r.category_name : ''}</div>
        </div>
        <div class="rec-amount">${fmtAmount(r.amount)}</div>
        <div class="expense-actions" style="display:flex;gap:0.3rem;">
          <button onclick="startRecurringEdit(${r.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">編輯</button>
          <button class="danger" onclick="deleteRecurring(${r.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">刪除</button>
        </div>
      </div>`;
  }).join('');
}

function accountOptionGroups(selectedId) {
  const typeOrder = ['asset', 'liabilities', 'revenue', 'expense'];
  let html = '';
  for (const type of typeOrder) {
    const group = accounts.filter(a => a.type === type);
    if (!group.length) continue;
    html += `<optgroup label="${ACCOUNT_TYPE_LABELS[type]}">`;
    for (const a of group) {
      const sel = a.id === selectedId ? ' selected' : '';
      html += `<option value="${a.id}"${sel}>${escHtml(a.icon || '')} ${escHtml(a.name)}</option>`;
    }
    html += '</optgroup>';
  }
  return html;
}

function renderRecurringEditRow(r) {
  const freqOptions = Object.entries(FREQ_LABELS).map(([k, v]) =>
    `<option value="${k}"${k === r.repeat_freq ? ' selected' : ''}>${v}</option>`
  ).join('');
  return `
    <div class="recurring-item recurring-item--editing" style="flex-wrap:wrap;gap:0.5rem;">
      <div class="rec-info" style="flex:1 1 100%;font-weight:600;">${escHtml(r.title)}</div>
      <div class="form-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.5rem;flex:1 1 100%;">
        <label style="font-size:0.75rem;">金額
          <input id="rec-edit-amount-${r.id}" type="number" step="1" value="${r.amount}" style="width:100%;padding:0.3rem;" />
        </label>
        <label style="font-size:0.75rem;">頻率
          <select id="rec-edit-freq-${r.id}" style="width:100%;padding:0.3rem;">${freqOptions}</select>
        </label>
        <label style="font-size:0.75rem;">來源帳戶
          <select id="rec-edit-source-${r.id}" style="width:100%;padding:0.3rem;">${accountOptionGroups(r.source_account_id)}</select>
        </label>
        <label style="font-size:0.75rem;">目的帳戶
          <select id="rec-edit-dest-${r.id}" style="width:100%;padding:0.3rem;">${accountOptionGroups(r.dest_account_id)}</select>
        </label>
        <label style="font-size:0.75rem;">下次日期
          <input id="rec-edit-next-${r.id}" type="date" value="${r.next_date}" style="width:100%;padding:0.3rem;" />
        </label>
      </div>
      <div class="expense-actions" style="flex:1 1 100%;display:flex;justify-content:flex-end;gap:0.3rem;">
        <button onclick="saveRecurringEdit(${r.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">儲存</button>
        <button class="secondary" onclick="cancelRecurringEdit()" style="padding:0.3rem 0.6rem;font-size:0.75rem">取消</button>
      </div>
    </div>`;
}

function startRecurringEdit(id) {
  editingRecurringId = id;
  loadRecurringPage();
}

function cancelRecurringEdit() {
  editingRecurringId = null;
  loadRecurringPage();
}

async function saveRecurringEdit(id) {
  const amount = parseFloat(document.getElementById(`rec-edit-amount-${id}`).value);
  const repeat_freq = document.getElementById(`rec-edit-freq-${id}`).value;
  const source_account_id = parseInt(document.getElementById(`rec-edit-source-${id}`).value, 10);
  const dest_account_id = parseInt(document.getElementById(`rec-edit-dest-${id}`).value, 10);
  const next_date = document.getElementById(`rec-edit-next-${id}`).value;
  if (!amount || amount <= 0) { alert('金額需為正數'); return; }
  if (!next_date) { alert('請選擇下次日期'); return; }
  if (source_account_id === dest_account_id) { alert('來源與目的帳戶不可相同'); return; }
  try {
    await api('PUT', `/api/recurring/${id}`, {
      amount, repeat_freq, source_account_id, dest_account_id, next_date,
    });
    editingRecurringId = null;
    loadRecurringPage();
  } catch (err) {
    alert('更新失敗：' + err.message);
  }
}

document.getElementById('recurring-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    title: document.getElementById('rec-title').value.trim(),
    amount: parseFloat(document.getElementById('rec-amount').value),
    source_account_id: parseInt(document.getElementById('rec-source').value),
    dest_account_id: parseInt(document.getElementById('rec-dest').value),
    category_id: parseInt(document.getElementById('rec-category').value) || null,
    repeat_freq: document.getElementById('rec-freq').value,
    next_date: document.getElementById('rec-next').value,
  };
  try {
    await api('POST', '/api/recurring', body);
    document.getElementById('recurring-form').reset();
    document.getElementById('rec-next').value = today();
    loadRecurringPage();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

document.getElementById('process-recurring-btn').addEventListener('click', async () => {
  try {
    const result = await api('POST', '/api/recurring/process');
    alert(`已處理 ${result.processed} 筆到期交易`);
    await loadAccounts();
    loadRecurringPage();
  } catch (err) {
    alert('處理失敗：' + err.message);
  }
});

async function deleteRecurring(id) {
  if (!confirm('確定刪除此固定交易？')) return;
  try {
    await api('DELETE', `/api/recurring/${id}`);
    loadRecurringPage();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ── Reports Page ─────────────────────────────────────────────────────────────

async function loadReportsPage() {
  await Promise.all([loadMonthlyChart(), loadCategoryChart(), loadNetworthChart()]);
}

async function loadMonthlyChart() {
  const data = await api('GET', '/api/reports/monthly?months=6');
  const container = document.getElementById('monthly-chart');
  if (data.length === 0) { container.innerHTML = '<p class="empty">尚無資料</p>'; return; }

  const max = Math.max(...data.map(d => Math.max(d.income, d.expense)), 1);
  container.innerHTML = '<div class="bar-chart">' + data.map(d => {
    const ew = (d.expense / max * 100).toFixed(1);
    const iw = (d.income / max * 100).toFixed(1);
    return `
      <div class="bar-row">
        <div class="bar-label">${d.month.slice(5)}</div>
        <div class="bar-group">
          <div class="bar-item"><div class="bar expense-bar" style="width:${ew}%"></div><span class="bar-value">${fmtAmount(d.expense)}</span></div>
          <div class="bar-item"><div class="bar income-bar" style="width:${iw}%"></div><span class="bar-value">${fmtAmount(d.income)}</span></div>
        </div>
      </div>`;
  }).join('') + '</div>';
}

async function loadCategoryChart() {
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const data = await api('GET', '/api/reports/category?' + params);
  const container = document.getElementById('category-chart');
  if (data.length === 0) { container.innerHTML = '<p class="empty">尚無支出資料</p>'; return; }

  const total = data.reduce((s, d) => s + d.total, 0);

  // SVG pie chart
  let cumAngle = 0;
  const slices = data.map((d, i) => {
    const pct = d.total / total;
    const startAngle = cumAngle;
    cumAngle += pct * 360;
    return { ...d, pct, startAngle, endAngle: cumAngle, color: PIE_COLORS[i % PIE_COLORS.length] };
  });

  const r = 70;
  const cx = 80, cy = 80;
  let svgPaths = '';
  for (const s of slices) {
    if (s.pct >= 0.999) {
      svgPaths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${s.color}"/>`;
      continue;
    }
    const a1 = (s.startAngle - 90) * Math.PI / 180;
    const a2 = (s.endAngle - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    const large = s.pct > 0.5 ? 1 : 0;
    svgPaths += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z" fill="${s.color}"/>`;
  }

  const legend = slices.map(s =>
    `<div class="legend-item">
      <div class="legend-dot" style="background:${s.color}"></div>
      <div class="legend-label">${s.icon || ''} ${s.name || '未分類'}</div>
      <div class="legend-value">${fmtAmount(s.total)} (${(s.pct * 100).toFixed(1)}%)</div>
    </div>`
  ).join('');

  container.innerHTML = `
    <div class="pie-wrapper">
      <svg class="pie-svg" viewBox="0 0 160 160">${svgPaths}</svg>
      <div class="pie-legend">${legend}</div>
    </div>`;
}

document.getElementById('report-filter-btn').addEventListener('click', loadCategoryChart);

async function loadNetworthChart() {
  const data = await api('GET', '/api/reports/networth?months=12');
  const container = document.getElementById('networth-chart');
  if (data.length === 0) { container.innerHTML = '<p class="empty">尚無資料</p>'; return; }

  const values = data.map(d => d.net_worth);
  const minV = Math.min(...values, 0);
  const maxV = Math.max(...values, 1);
  const range = maxV - minV || 1;
  const w = 600, h = 160, pad = 30;

  const points = data.map((d, i) => {
    const x = pad + (i / Math.max(data.length - 1, 1)) * (w - 2 * pad);
    const y = h - pad - ((d.net_worth - minV) / range) * (h - 2 * pad);
    return { x, y, ...d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaD = pathD + ` L${points[points.length - 1].x},${h - pad} L${points[0].x},${h - pad} Z`;

  const labels = points.filter((_, i) => i === 0 || i === points.length - 1 || i % 2 === 0)
    .map(p => `<text class="line-label" x="${p.x}" y="${h - 5}" text-anchor="middle">${p.month.slice(5)}</text>`)
    .join('');

  // Grid lines
  const gridCount = 3;
  let gridLines = '';
  for (let i = 0; i <= gridCount; i++) {
    const y = pad + (i / gridCount) * (h - 2 * pad);
    const val = maxV - (i / gridCount) * range;
    gridLines += `<line class="line-grid" x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}"/>`;
    gridLines += `<text class="line-label" x="${pad - 5}" y="${y + 4}" text-anchor="end">${(val / 1000).toFixed(0)}k</text>`;
  }

  container.innerHTML = `
    <div class="line-chart-wrap">
      <svg viewBox="0 0 ${w} ${h}">
        ${gridLines}
        <path class="line-area" d="${areaD}" fill="#818cf8"/>
        <path class="line-path" d="${pathD}" stroke="#4f46e5"/>
        ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#4f46e5"/>`).join('')}
        ${labels}
      </svg>
    </div>`;
}

// ── Budgets Page ────────────────────────────────────────────────────────────

let currentBudgetMonth = new Date().toISOString().slice(0, 7);

function populateBudgetDropdowns() {
  const catSel = document.getElementById('budget-category');
  catSel.innerHTML = '<option value="">整體預算</option>';
  categories.forEach(c => {
    catSel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${escHtml(c.icon || '')} ${escHtml(c.name)}</option>`);
  });
  document.getElementById('budget-month').value = currentBudgetMonth;
}

async function loadBudgetsPage() {
  populateBudgetDropdowns();
  await renderBudgetStatus();
}

async function renderBudgetStatus() {
  document.getElementById('budget-month-label').textContent = currentBudgetMonth;
  const data = await api('GET', '/api/budgets/status?month=' + currentBudgetMonth);
  const container = document.getElementById('budget-status');

  if (data.budgets.length === 0) {
    container.innerHTML = '<p class="empty">尚未設定預算</p>';
    return;
  }

  container.innerHTML = data.budgets.map(b => {
    const label = b.category_id ? `${b.category_icon || ''} ${b.category_name}` : '💰 整體預算';
    const pct = Math.min(b.pct, 100);
    const overBudget = b.pct > 100;
    const warning = b.pct >= 100 ? 'over' : b.pct >= 80 ? 'warn' : '';
    return `
      <div class="budget-card ${warning}">
        <div class="budget-header">
          <span class="budget-label">${label}</span>
          <span class="budget-pct ${warning}">${b.pct.toFixed(0)}%</span>
        </div>
        <div class="budget-bar-track">
          <div class="budget-bar-fill ${warning}" style="width:${pct}%"></div>
        </div>
        <div class="budget-detail">
          <span>已用 ${fmtAmount(b.spent)} / ${fmtAmount(b.amount)}</span>
          <span>${overBudget ? '超支 ' + fmtAmount(Math.abs(b.remaining)) : '剩餘 ' + fmtAmount(b.remaining)}</span>
        </div>
        <div class="expense-actions" style="margin-top:0.4rem">
          <button class="danger" onclick="deleteBudget(${b.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">刪除</button>
        </div>
      </div>`;
  }).join('');
}

document.getElementById('budget-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    category_id: parseInt(document.getElementById('budget-category').value) || null,
    amount: parseFloat(document.getElementById('budget-amount').value),
    month: document.getElementById('budget-month').value,
  };
  try {
    await api('POST', '/api/budgets', body);
    document.getElementById('budget-amount').value = '';
    currentBudgetMonth = body.month;
    await renderBudgetStatus();
  } catch (err) {
    alert('設定失敗：' + err.message);
  }
});

async function deleteBudget(id) {
  if (!confirm('確定刪除此預算設定？')) return;
  try {
    await api('DELETE', `/api/budgets/${id}`);
    await renderBudgetStatus();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

document.getElementById('budget-prev').addEventListener('click', () => {
  const d = new Date(currentBudgetMonth + '-01');
  d.setMonth(d.getMonth() - 1);
  currentBudgetMonth = d.toISOString().slice(0, 7);
  renderBudgetStatus();
});

document.getElementById('budget-next').addEventListener('click', () => {
  const d = new Date(currentBudgetMonth + '-01');
  d.setMonth(d.getMonth() + 1);
  currentBudgetMonth = d.toISOString().slice(0, 7);
  renderBudgetStatus();
});

// ── Trips ────────────────────────────────────────────────────────────────────

let currentTripId = null;
let currentTripMembers = [];
let currentShareToken = null; // set when visitor arrived via share link

// ── Share / Join page ────────────────────────────────────────────────────────

async function loadTripSharePage(token) {
  currentShareToken = token;
  let trip;
  try {
    trip = await api('GET', `/api/trips/by-share/${encodeURIComponent(token)}`);
  } catch (e) {
    document.body.innerHTML = `<main><div class="form-card"><h2>分享連結無效</h2><p>${escHtml(e.message || '')}</p></div></main>`;
    return;
  }
  currentTripId = trip.id;

  // Already a member via Google session?
  if (trip.current_member) {
    _currentIdentity = { id: trip.current_member.id, name: trip.current_member.name };
    await showTripDetailFromShare();
    return;
  }
  // Already claimed via device_token?
  try {
    const ident = await api('GET',
      `/api/trips/identity?trip_id=${trip.id}&device_token=${getDeviceToken()}`);
    if (ident && ident.id) {
      _currentIdentity = { id: ident.id, name: ident.name };
      await showTripDetailFromShare();
      return;
    }
  } catch { /* not yet claimed */ }

  // Show join page
  document.getElementById('page-trip-share').classList.add('active');
  document.getElementById('share-trip-name').textContent = `🧳 ${trip.name || ''}`;
  const meta = [
    trip.destination, trip.start_date,
    trip.end_date ? '～ ' + trip.end_date : null,
  ].filter(Boolean).join('　');
  document.getElementById('share-trip-meta').textContent = meta;

  document.getElementById('share-google-btn').onclick = () => {
    location.href = `/auth/google?share_token=${encodeURIComponent(token)}`;
  };
  document.getElementById('share-name-form').onsubmit = async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('share-name-input');
    const name = nameInput.value.trim();
    if (!name) return;
    try {
      const { member } = await api('POST', `/api/trips/by-share/${encodeURIComponent(token)}/join`, {
        name,
        device_token: getDeviceToken(),
      });
      _currentIdentity = { id: member.id, name: member.name };
      await showTripDetailFromShare();
    } catch (err) {
      alert('加入失敗：' + err.message);
    }
  };
}

function renderShareLink(shareToken) {
  const box = document.getElementById('trip-share-link');
  if (!box) return;
  if (!shareToken) { box.innerHTML = ''; return; }
  const url = `${location.origin}/#trip/${shareToken}`;
  box.innerHTML = `
    <div class="share-link-row">
      <span class="share-label">🔗 分享連結：</span>
      <input type="text" class="share-url" readonly value="${url}">
      <button class="secondary sm" type="button" onclick="copyShareLink(this, '${url}')">複製</button>
    </div>`;
}

window.copyShareLink = async function (btn, url) {
  try {
    await navigator.clipboard.writeText(url);
    const orig = btn.textContent;
    btn.textContent = '已複製 ✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    alert('複製失敗，請手動選取連結');
  }
};

async function showTripDetailFromShare() {
  // Switch to trips tab detail view, no list
  document.getElementById('page-trip-share').classList.remove('active');
  document.getElementById('page-trips').classList.add('active');
  document.getElementById('trips-list-view').style.display = 'none';
  document.getElementById('trips-detail-view').style.display = '';
  await refreshTripDetail();
}

// ── Trip Identity (device token → MySQL) ─────────────────────────────────────

function getDeviceToken() {
  let token = localStorage.getItem('trip_device_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('trip_device_token', token);
  }
  return token;
}

let _currentIdentity = null; // { id, name } or null

function getTripIdentity() { return _currentIdentity; }

async function loadTripIdentityFromServer() {
  try {
    const data = await api('GET', `/api/trips/identity?trip_id=${currentTripId}&device_token=${getDeviceToken()}`);
    _currentIdentity = data;
  } catch {
    _currentIdentity = null;
  }
}

async function claimTripIdentity(id) {
  const m = currentTripMembers.find(m => m.id === id);
  if (!m) return;
  try {
    await api('POST', '/api/trips/identity', {
      trip_id: currentTripId,
      member_id: id,
      device_token: getDeviceToken(),
    });
    _currentIdentity = { id: m.id, name: m.name };
    renderIdentityBar(currentTripMembers);
    const sel = document.getElementById('texp-paid-by');
    if (sel) sel.value = id;
  } catch (err) {
    alert('身份認領失敗：' + err.message);
  }
}

async function clearTripIdentity() {
  try {
    await api('DELETE', '/api/trips/identity', { trip_id: currentTripId, device_token: getDeviceToken() });
  } catch { /* best effort */ }
  _currentIdentity = null;
  renderIdentityBar(currentTripMembers);
}

function renderIdentityBar(members) {
  const bar = document.getElementById('trip-identity-bar');
  const identity = getTripIdentity();
  if (identity) {
    bar.innerHTML = `<div class="identity-banner identity-set">
      <span>你是 👤 <strong>${escHtml(identity.name)}</strong></span>
      <button class="secondary sm" onclick="clearTripIdentity()">更換身份</button>
    </div>`;
  } else if (members.length === 0) {
    bar.innerHTML = '';
  } else {
    bar.innerHTML = `<div class="identity-banner">
      <span class="identity-label">你是哪位成員？</span>
      ${members.map(m => `<button class="secondary sm" onclick="claimTripIdentity(${m.id})">${escHtml(m.name)}</button>`).join('')}
    </div>`;
  }
}

async function loadTripsPage() {
  const trips = await api('GET', '/api/trips');
  const container = document.getElementById('trips-list');
  if (trips.length === 0) {
    container.innerHTML = '<p class="empty">尚無旅遊專案</p>';
    return;
  }
  container.innerHTML = trips.map(t => `
    <div class="expense-item" data-id="${t.id}">
      <div class="expense-icon">✈️</div>
      <div class="expense-info">
        <div class="expense-main">
          <span class="expense-category">${escHtml(t.name)}${t.destination ? ' — ' + escHtml(t.destination) : ''}</span>
          <span class="expense-amount">${t.budget > 0 ? fmtAmount(t.budget) + ' ' + escHtml(t.currency) : ''}</span>
        </div>
        <div class="expense-sub">
          ${t.start_date || ''}${t.end_date ? ' ～ ' + t.end_date : ''}
          ${t.created_by ? '　由 ' + escHtml(t.created_by) + ' 建立' : ''}
        </div>
      </div>
      <div class="expense-actions">
        <button class="secondary" onclick="openTrip(${t.id})">開啟</button>
        <button class="danger" onclick="deleteTrip(${t.id})">刪除</button>
      </div>
    </div>`).join('');
}

async function openTrip(id) {
  currentTripId = id;
  document.getElementById('trips-list-view').style.display = 'none';
  document.getElementById('trips-detail-view').style.display = '';
  await refreshTripDetail();
}

async function refreshTripDetail() {
  const trip = await api('GET', `/api/trips/${currentTripId}`);
  currentTripMembers = trip.members;

  document.getElementById('trip-detail-title').textContent = trip.name;
  const meta = [
    trip.destination, trip.start_date,
    trip.end_date ? '～ ' + trip.end_date : null,
    trip.budget > 0 ? '預算 ' + fmtAmount(trip.budget) + ' ' + trip.currency : null,
  ].filter(Boolean).join('　');
  document.getElementById('trip-detail-meta').textContent = meta;

  // Share link
  renderShareLink(trip.share_token);

  // Identity bar — load from server first
  await loadTripIdentityFromServer();
  renderIdentityBar(trip.members);

  // Members
  const mList = document.getElementById('trip-members-list');
  mList.innerHTML = trip.members.length === 0
    ? '<p class="empty">尚無成員</p>'
    : trip.members.map(m => `
      <div class="expense-item">
        <div class="expense-icon">👤</div>
        <div class="expense-info">
          <div class="expense-main">
            <span class="expense-category">${escHtml(m.name)}</span>
          </div>
          <div class="expense-sub">邀請碼：<strong>${m.join_code}</strong>${m.email ? '　' + escHtml(m.email) : ''}</div>
        </div>
        <div class="expense-actions">
          <button class="secondary sm" onclick="copyJoinCode('${m.join_code}', this)" title="複製邀請碼">複製碼</button>
          <button class="danger" onclick="deleteTripMember(${m.id})">移除</button>
        </div>
      </div>`).join('');

  // Populate paid_by dropdown, pre-select identity if set
  const paidBySel = document.getElementById('texp-paid-by');
  const identity = getTripIdentity();
  paidBySel.innerHTML = trip.members.length === 0
    ? '<option value="">（先新增成員）</option>'
    : trip.members.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('');
  if (identity && paidBySel.querySelector(`option[value="${identity.id}"]`)) {
    paidBySel.value = identity.id;
  }

  // Expenses
  renderTripExpenses(trip.expenses, trip.members);

  // Settlement
  await renderSettlement();
}

function renderTripExpenses(expenses, members) {
  const container = document.getElementById('trip-expenses-list');
  if (expenses.length === 0) {
    container.innerHTML = '<p class="empty">尚無費用</p>';
    return;
  }
  container.innerHTML = expenses.map(e => {
    const rateNote = e.exchange_rate !== 1 ? ` (匯率 ${e.exchange_rate}, TWD ${fmtAmount(e.amount * e.exchange_rate)})` : '';
    const splitLabel = { equal: '平均', paid_by_one: '自付', custom: '自訂' }[e.split_type] || e.split_type;
    return `
      <div class="expense-item" data-id="${e.id}">
        <div class="expense-icon">💸</div>
        <div class="expense-info">
          <div class="expense-main">
            <span class="expense-category">${escHtml(e.description || '費用')}</span>
            <span class="expense-amount">${e.currency !== 'TWD' ? e.currency + ' ' : ''}${Number(e.amount).toLocaleString()}${rateNote}</span>
          </div>
          <div class="expense-sub">${e.date}　付：${escHtml(e.paid_by_name || '?')}　${splitLabel}</div>
        </div>
        <div class="expense-actions">
          <button class="secondary" onclick="startEditTripExpense(${e.id})">編輯</button>
          <button class="danger" onclick="deleteTripExpense(${e.id})">刪除</button>
        </div>
      </div>`;
  }).join('');
}

async function renderSettlement() {
  const container = document.getElementById('trip-settlement');
  try {
    const data = await api('GET', `/api/trips/${currentTripId}/settlement`);
    if (data.summary.length === 0) {
      container.innerHTML = '<p class="empty">尚無成員或費用</p>';
      return;
    }
    const summaryHtml = data.summary.map(s => {
      const bal = s.net_balance;
      const cls = bal > 0 ? 'income' : bal < 0 ? 'expense-amount' : '';
      const sign = bal > 0 ? '+' : '';
      return `<div class="expense-item">
        <div class="expense-icon">👤</div>
        <div class="expense-info">
          <div class="expense-main">
            <span class="expense-category">${escHtml(s.name)}</span>
            <span class="${cls}">${sign}${Math.round(bal).toLocaleString()} TWD</span>
          </div>
          <div class="expense-sub">已付 ${fmtAmount(s.total_paid)}</div>
        </div>
      </div>`;
    }).join('');

    const transferHtml = data.transfers.length === 0
      ? '<p class="empty">無需轉帳 🎉</p>'
      : '<h4>轉帳清單</h4>' + data.transfers.map(t =>
          `<div class="settlement-row">
            <span class="settlement-from">${escHtml(t.from_name)}</span>
            <span class="settlement-arrow">→</span>
            <span class="settlement-to">${escHtml(t.to_name)}</span>
            <span class="settlement-amount">${fmtAmount(t.amount)}</span>
          </div>`
        ).join('');

    container.innerHTML = summaryHtml + transferHtml;
  } catch (e) {
    container.innerHTML = '<p class="empty">計算失敗</p>';
  }
}

document.getElementById('trip-back-btn').addEventListener('click', () => {
  currentTripId = null;
  document.getElementById('trips-list-view').style.display = '';
  document.getElementById('trips-detail-view').style.display = 'none';
  loadTripsPage();
});

document.getElementById('trip-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById('trip-name').value.trim(),
    destination: document.getElementById('trip-dest').value.trim() || null,
    start_date: document.getElementById('trip-start').value || null,
    end_date: document.getElementById('trip-end').value || null,
    budget: parseFloat(document.getElementById('trip-budget').value) || 0,
    currency: document.getElementById('trip-currency').value,
    created_by: document.getElementById('trip-creator').value.trim() || null,
  };
  try {
    await api('POST', '/api/trips', body);
    document.getElementById('trip-form').reset();
    await loadTripsPage();
  } catch (err) {
    alert('建立失敗：' + err.message);
  }
});

async function deleteTrip(id) {
  if (!confirm('確定刪除此旅遊專案及所有費用？')) return;
  try {
    await api('DELETE', `/api/trips/${id}`);
    await loadTripsPage();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

document.getElementById('trip-member-form').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    name: document.getElementById('member-name').value.trim(),
    email: document.getElementById('member-email').value.trim() || null,
  };
  try {
    await api('POST', `/api/trips/${currentTripId}/members`, body);
    document.getElementById('trip-member-form').reset();
    await refreshTripDetail();
  } catch (err) {
    alert('新增成員失敗：' + err.message);
  }
});

async function deleteTripMember(mid) {
  if (!confirm('確定移除此成員？')) return;
  try {
    await api('DELETE', `/api/trips/${currentTripId}/members/${mid}`);
    await refreshTripDetail();
  } catch (err) {
    alert('移除失敗：' + err.message);
  }
}

document.getElementById('texp-split-type').addEventListener('change', () => {
  const type = document.getElementById('texp-split-type').value;
  const customDiv = document.getElementById('texp-custom-splits');
  if (type === 'custom') {
    customDiv.style.display = '';
    renderCustomSplitFields();
  } else {
    customDiv.style.display = 'none';
  }
});

function renderCustomSplitFields() {
  const div = document.getElementById('texp-custom-splits');
  div.innerHTML = '<p style="font-size:0.85rem;color:#64748b;margin:4px 0">各人應分擔金額（TWD）：</p>' +
    currentTripMembers.map(m => `
      <label style="display:flex;gap:8px;align-items:center;margin:4px 0">
        <span style="min-width:80px">${escHtml(m.name)}</span>
        <input type="number" step="0.01" min="0" class="custom-split-input"
          data-member-id="${m.id}" placeholder="0" style="flex:1">
      </label>`).join('');
}

document.getElementById('texp-currency').addEventListener('change', () => {
  const cur = document.getElementById('texp-currency').value;
  const rateInput = document.getElementById('texp-rate');
  if (cur === 'TWD') rateInput.value = '1';
});

document.getElementById('trip-expense-form').addEventListener('submit', async e => {
  e.preventDefault();
  const editId = document.getElementById('trip-expense-edit-id').value;
  const splitType = document.getElementById('texp-split-type').value;
  let splits = null;
  if (splitType === 'custom') {
    splits = {};
    document.querySelectorAll('.custom-split-input').forEach(inp => {
      const v = parseFloat(inp.value);
      if (v > 0) splits[inp.dataset.memberId] = v;
    });
  }
  const body = {
    paid_by: parseInt(document.getElementById('texp-paid-by').value),
    amount: parseFloat(document.getElementById('texp-amount').value),
    currency: document.getElementById('texp-currency').value,
    exchange_rate: parseFloat(document.getElementById('texp-rate').value) || 1,
    description: document.getElementById('texp-desc').value.trim() || null,
    date: document.getElementById('texp-date').value,
    split_type: splitType,
    splits: splits,
  };
  try {
    if (editId) {
      await api('PUT', `/api/trips/${currentTripId}/expenses/${editId}`, body);
    } else {
      await api('POST', `/api/trips/${currentTripId}/expenses`, body);
    }
    resetTripExpenseForm();
    await refreshTripDetail();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

document.getElementById('texp-cancel-btn').addEventListener('click', resetTripExpenseForm);

function resetTripExpenseForm() {
  document.getElementById('trip-expense-form').reset();
  document.getElementById('trip-expense-edit-id').value = '';
  texpCalInit(today());
  document.getElementById('texp-rate').value = '1';
  document.getElementById('texp-custom-splits').style.display = 'none';
  document.getElementById('trip-expense-form-title').textContent = '新增費用';
  document.getElementById('texp-submit-btn').textContent = '新增費用';
  document.getElementById('texp-cancel-btn').style.display = 'none';
  const identity = getTripIdentity();
  const sel = document.getElementById('texp-paid-by');
  if (identity && sel && sel.querySelector(`option[value="${identity.id}"]`)) {
    sel.value = identity.id;
  }
}

function startEditTripExpense(id) {
  const container = document.getElementById('trip-expenses-list');
  const item = container.querySelector(`[data-id="${id}"]`);
  if (!item) return;
  // Find expense data by re-fetching
  api('GET', `/api/trips/${currentTripId}`).then(trip => {
    const exp = trip.expenses.find(e => e.id === id);
    if (!exp) return;
    document.getElementById('trip-expense-edit-id').value = exp.id;
    document.getElementById('texp-desc').value = exp.description || '';
    document.getElementById('texp-amount').value = exp.amount;
    document.getElementById('texp-currency').value = exp.currency || 'TWD';
    document.getElementById('texp-rate').value = exp.exchange_rate || 1;
    document.getElementById('texp-paid-by').value = exp.paid_by;
    texpCalInit(exp.date);
    document.getElementById('texp-split-type').value = exp.split_type;
    if (exp.split_type === 'custom') {
      document.getElementById('texp-custom-splits').style.display = '';
      renderCustomSplitFields();
      if (exp.splits) {
        const splits = JSON.parse(exp.splits);
        document.querySelectorAll('.custom-split-input').forEach(inp => {
          if (splits[inp.dataset.memberId]) inp.value = splits[inp.dataset.memberId];
        });
      }
    }
    document.getElementById('trip-expense-form-title').textContent = '編輯費用';
    document.getElementById('texp-submit-btn').textContent = '儲存';
    document.getElementById('texp-cancel-btn').style.display = '';
    document.getElementById('trip-expense-form-card').scrollIntoView({ behavior: 'smooth' });
  });
}

function copyJoinCode(code, btn) {
  navigator.clipboard.writeText(code).then(() => {
    const orig = btn.textContent;
    btn.textContent = '已複製！';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

async function deleteTripExpense(id) {
  if (!confirm('確定刪除此費用？')) return;
  try {
    await api('DELETE', `/api/trips/${currentTripId}/expenses/${id}`);
    await refreshTripDetail();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

document.getElementById('calc-settlement-btn').addEventListener('click', renderSettlement);

// ── Categories Page ──────────────────────────────────────────────────────────

async function loadCategoriesPage() {
  await loadCategories();
  const container = document.getElementById('categories-list');
  if (categories.length === 0) {
    container.innerHTML = '<p class="empty">尚無分類，請使用上方表單新增。</p>';
    return;
  }

  let html = '';
  for (const c of categories) {
    const subItems = (c.subcategories || []).map(s => `
      <li class="sub-item">
        <span>${escHtml(s.name)}</span>
        <button class="danger" onclick="deleteSubcategory(${s.id})" style="padding:0.2rem 0.5rem;font-size:0.7rem">刪除</button>
      </li>`).join('');

    if (editingCategoryId === c.id) {
      html += `
        <div class="account-card account-card--editing">
          <input id="cat-edit-icon-${c.id}" value="${escHtml(c.icon || '')}" maxlength="4" style="width:3rem;text-align:center;font-size:1.25rem;padding:0.3rem;" />
          <input id="cat-edit-name-${c.id}" value="${escHtml(c.name)}" style="flex:1;padding:0.3rem 0.5rem;" />
          <div class="expense-actions" style="display:flex;gap:0.3rem;">
            <button onclick="saveCategoryEdit(${c.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">儲存</button>
            <button class="secondary" onclick="cancelCategoryEdit()" style="padding:0.3rem 0.6rem;font-size:0.75rem">取消</button>
          </div>
        </div>`;
    } else {
      html += `
        <div class="account-card">
          <div class="acc-icon">${escHtml(c.icon || '📦')}</div>
          <div class="acc-info"><div class="acc-name">${escHtml(c.name)}</div></div>
          <div class="expense-actions" style="display:flex;gap:0.3rem;">
            <button onclick="startCategoryEdit(${c.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">編輯</button>
            <button class="danger" onclick="deleteCategory(${c.id})" style="padding:0.3rem 0.6rem;font-size:0.75rem">刪除</button>
          </div>
        </div>`;
    }

    html += `
      <div class="sub-block">
        <ul class="sub-list">${subItems || '<li class="empty">（無子分類）</li>'}</ul>
        <form class="sub-add-form" onsubmit="addSubcategory(event, ${c.id})">
          <input type="text" id="sub-new-${c.id}" placeholder="新增子分類" maxlength="32" required>
          <button type="submit">新增</button>
        </form>
      </div>`;
  }

  container.innerHTML = html;
}

document.getElementById('category-form').addEventListener('submit', async e => {
  e.preventDefault();
  const name = document.getElementById('cat-name').value.trim();
  const icon = document.getElementById('cat-icon').value.trim() || '📦';
  if (!name) { alert('名稱不可為空'); return; }
  try {
    await api('POST', '/api/categories', { name, icon });
    document.getElementById('category-form').reset();
    await loadCategoriesPage();
  } catch (err) {
    alert('新增失敗：' + err.message);
  }
});

function startCategoryEdit(id) {
  editingCategoryId = id;
  loadCategoriesPage();
}

function cancelCategoryEdit() {
  editingCategoryId = null;
  loadCategoriesPage();
}

async function saveCategoryEdit(id) {
  const name = document.getElementById(`cat-edit-name-${id}`).value.trim();
  const icon = document.getElementById(`cat-edit-icon-${id}`).value.trim();
  if (!name) { alert('名稱不可為空'); return; }
  try {
    await api('PUT', `/api/categories/${id}`, { name, icon: icon || '📦' });
    editingCategoryId = null;
    await loadCategoriesPage();
  } catch (err) {
    alert('更新失敗：' + err.message);
  }
}

async function deleteCategory(id) {
  if (!confirm('確定刪除此大分類？所有子分類也會被刪除（已使用此分類的交易仍會保留但失去分類關聯）。')) return;
  try {
    await api('DELETE', `/api/categories/${id}`);
    if (editingCategoryId === id) editingCategoryId = null;
    await loadCategoriesPage();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function addSubcategory(e, catId) {
  e.preventDefault();
  const input = document.getElementById(`sub-new-${catId}`);
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('POST', `/api/categories/${catId}/subcategories`, { name });
    input.value = '';
    await loadCategoriesPage();
  } catch (err) {
    alert('新增子分類失敗：' + err.message);
  }
}

async function deleteSubcategory(id) {
  if (!confirm('確定刪除此子分類？')) return;
  try {
    await api('DELETE', `/api/subcategories/${id}`);
    await loadCategoriesPage();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all([loadAccounts(), loadCategories()]);
  initTxType();
  populateAccountDropdowns();
  texpCalInit(today());
  initTabs();
  await loadTransactions();

  // Chinese validation messages for required number inputs
  const MSG = { amount: '請填寫金額', 'rec-amount': '請填寫金額', 'budget-amount': '請填寫預算金額', 'texp-amount': '請填寫金額' };
  Object.entries(MSG).forEach(([id, msg]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('invalid', () => el.setCustomValidity(msg));
    el.addEventListener('input', () => el.setCustomValidity(''));
  });
})();
