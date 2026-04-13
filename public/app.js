'use strict';

const CATEGORY_ICONS = {};
let categories = []; // each: { id, name, icon, subcategories: [{id, name}] }

// ── Utility ──────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function fmtAmount(n) {
  return 'NT$ ' + Number(n).toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// ── Categories ────────────────────────────────────────────────────────────────

async function loadCategories() {
  categories = await api('GET', '/api/categories');
  categories.forEach(c => { CATEGORY_ICONS[c.name] = c.icon || '📦'; });

  // Form: category dropdown
  const catSel = document.getElementById('category');
  catSel.innerHTML = '';
  categories.forEach(c => {
    catSel.insertAdjacentHTML('beforeend',
      `<option value="${c.name}">${c.icon || ''} ${c.name}</option>`);
  });

  // Filter: category dropdown
  const filterCatSel = document.getElementById('filter-category');
  filterCatSel.innerHTML = '<option value="">全部</option>';
  categories.forEach(c => {
    filterCatSel.insertAdjacentHTML('beforeend',
      `<option value="${c.name}">${c.icon || ''} ${c.name}</option>`);
  });

  // Populate subcategory for the initially selected category
  updateSubcategoryDropdown();
  updateFilterSubcategoryDropdown();
}

function updateSubcategoryDropdown() {
  const catName = document.getElementById('category').value;
  const subSel = document.getElementById('subcategory');
  subSel.innerHTML = '<option value="">（無）</option>';

  const cat = categories.find(c => c.name === catName);
  if (cat && cat.subcategories.length > 0) {
    cat.subcategories.forEach(s => {
      subSel.insertAdjacentHTML('beforeend',
        `<option value="${s.name}">${s.name}</option>`);
    });
  }
}

function updateFilterSubcategoryDropdown() {
  const catName = document.getElementById('filter-category').value;
  const subSel = document.getElementById('filter-subcategory');
  subSel.innerHTML = '<option value="">全部</option>';

  if (!catName) return;
  const cat = categories.find(c => c.name === catName);
  if (cat && cat.subcategories.length > 0) {
    cat.subcategories.forEach(s => {
      subSel.insertAdjacentHTML('beforeend',
        `<option value="${s.name}">${s.name}</option>`);
    });
  }
}

document.getElementById('category').addEventListener('change', updateSubcategoryDropdown);
document.getElementById('filter-category').addEventListener('change', () => {
  updateFilterSubcategoryDropdown();
  document.getElementById('filter-subcategory').value = '';
});

// ── Expense List ──────────────────────────────────────────────────────────────

async function loadExpenses() {
  const from = document.getElementById('filter-from').value;
  const to   = document.getElementById('filter-to').value;
  const cat  = document.getElementById('filter-category').value;
  const sub  = document.getElementById('filter-subcategory').value;

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to)   params.set('to', to);
  if (cat)  params.set('category', cat);
  if (sub)  params.set('subcategory', sub);

  const expenses = await api('GET', '/api/expenses?' + params);
  renderExpenses(expenses);
}

function renderExpenses(expenses) {
  const list = document.getElementById('expense-list');
  const summary = document.getElementById('summary');

  if (expenses.length === 0) {
    list.innerHTML = '<p class="empty">沒有支出紀錄</p>';
    summary.textContent = '共 0 筆，合計 NT$ 0';
    return;
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  summary.textContent = `共 ${expenses.length} 筆，合計 ${fmtAmount(total)}`;

  list.innerHTML = expenses.map(e => {
    const icon = CATEGORY_ICONS[e.category] || '📦';
    const tags = e.tags ? `<span class="expense-tags">${e.tags.split(',').map(t => '#' + t.trim()).join(' ')}</span>` : '';
    const note = e.note ? `${e.note}　` : '';
    const subLabel = e.subcategory ? ` / ${e.subcategory}` : '';
    return `
      <div class="expense-item" data-id="${e.id}">
        <div class="expense-icon">${icon}</div>
        <div class="expense-info">
          <div class="expense-main">
            <span class="expense-category">${e.category}${subLabel}</span>
            <span class="expense-amount">${fmtAmount(e.amount)}</span>
          </div>
          <div class="expense-sub">${e.date}　${note}${tags}</div>
        </div>
        <div class="expense-actions">
          <button class="secondary" onclick="startEdit(${e.id})">編輯</button>
          <button class="danger" onclick="deleteExpense(${e.id})">刪除</button>
        </div>
      </div>`;
  }).join('');
}

// ── Form: Add ─────────────────────────────────────────────────────────────────

document.getElementById('date').value = today();

document.getElementById('expense-form').addEventListener('submit', async e => {
  e.preventDefault();
  const editId = document.getElementById('edit-id').value;
  const body = {
    amount:      parseFloat(document.getElementById('amount').value),
    category:    document.getElementById('category').value,
    subcategory: document.getElementById('subcategory').value || null,
    note:        document.getElementById('note').value.trim(),
    tags:        document.getElementById('tags').value.trim(),
    date:        document.getElementById('date').value,
  };

  try {
    if (editId) {
      await api('PUT', `/api/expenses/${editId}`, body);
    } else {
      await api('POST', '/api/expenses', body);
    }
    resetForm();
    loadExpenses();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  }
});

document.getElementById('cancel-btn').addEventListener('click', resetForm);

function resetForm() {
  document.getElementById('expense-form').reset();
  document.getElementById('edit-id').value = '';
  document.getElementById('date').value = today();
  document.getElementById('form-title').textContent = '新增支出';
  document.getElementById('submit-btn').textContent = '新增';
  document.getElementById('cancel-btn').style.display = 'none';
  updateSubcategoryDropdown();
}

// ── Form: Edit ────────────────────────────────────────────────────────────────

async function startEdit(id) {
  const expense = await api('GET', `/api/expenses?from=2000-01-01`);
  const e = expense.find(x => x.id === id);
  if (!e) return;

  document.getElementById('edit-id').value  = e.id;
  document.getElementById('amount').value   = e.amount;
  document.getElementById('category').value = e.category;

  // Update subcategory dropdown based on the selected category, then set value
  updateSubcategoryDropdown();
  document.getElementById('subcategory').value = e.subcategory || '';

  document.getElementById('note').value     = e.note || '';
  document.getElementById('tags').value     = e.tags || '';
  document.getElementById('date').value     = e.date;

  document.getElementById('form-title').textContent = '編輯支出';
  document.getElementById('submit-btn').textContent = '儲存';
  document.getElementById('cancel-btn').style.display = '';
  document.getElementById('form-section').scrollIntoView({ behavior: 'smooth' });
}

// ── Delete ────────────────────────────────────────────────────────────────────

async function deleteExpense(id) {
  if (!confirm('確定刪除這筆支出？')) return;
  try {
    await api('DELETE', `/api/expenses/${id}`);
    loadExpenses();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

// ── Filters ───────────────────────────────────────────────────────────────────

document.getElementById('filter-btn').addEventListener('click', loadExpenses);
document.getElementById('reset-btn').addEventListener('click', () => {
  document.getElementById('filter-from').value         = '';
  document.getElementById('filter-to').value           = '';
  document.getElementById('filter-category').value     = '';
  document.getElementById('filter-subcategory').value  = '';
  updateFilterSubcategoryDropdown();
  loadExpenses();
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  await loadCategories();
  await loadExpenses();
})();
