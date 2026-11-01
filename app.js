'use strict';

const CATEGORIES = [
  { name: 'Food & drink', color: '#df7657', background: '#f5e4dc', icon: 'F' },
  { name: 'Transport', color: '#517a9b', background: '#e1ebf1', icon: 'T' },
  { name: 'Shopping', color: '#9770a1', background: '#eee5f0', icon: 'S' },
  { name: 'Bills', color: '#b28a37', background: '#f3edda', icon: 'B' },
  { name: 'Health', color: '#4c8863', background: '#e1eee4', icon: 'H' },
  { name: 'Entertainment', color: '#cd6d76', background: '#f5e4e5', icon: 'E' },
  { name: 'Other', color: '#727b70', background: '#e7e9e4', icon: 'O' }
];
const STORAGE_KEY = 'pocket-ledger-v1';
const DATA_FILE_NAME = 'pocket-ledger-data.json';
const today = new Date();
const currentMonth = monthKey(today);
let state = loadState();
let selectedMonth = currentMonth;
let toastTimer;
let jsonFileHandle = null;
let jsonWriteQueue = Promise.resolve();
let stateRevision = 0;

function monthKey(date) {
  const parsed = date instanceof Date ? date : new Date(`${date}T12:00:00`);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return normalizeState(saved);
  } catch {
    return { expenses: [], budget: 0, currency: 'INR' };
  }
}

function normalizeState(saved) {
  const storedCurrency = saved.currency === 'USD' ? 'INR' : saved.currency;
  return {
    expenses: Array.isArray(saved.expenses) ? saved.expenses.filter(isValidExpense) : [],
    budget: Number.isFinite(Number(saved.budget)) && Number(saved.budget) >= 0 ? Number(saved.budget) : 0,
    currency: ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD'].includes(storedCurrency) ? storedCurrency : 'INR'
  };
}

function isValidExpense(item) {
  return item && typeof item.id === 'string' && typeof item.title === 'string' && Number.isFinite(Number(item.amount)) && Number(item.amount) > 0 && CATEGORIES.some(category => category.name === item.category) && /^\d{4}-\d{2}-\d{2}$/.test(item.date);
}

function saveState() {
  const serialized = JSON.stringify(state);
  let localStorageError = null;
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    localStorageError = error;
  }
  stateRevision++;
  if (jsonFileHandle) persistJsonFile(serialized);
  else if (localStorageError) throw localStorageError;
}

function setStorageStatus(message) {
  const status = document.querySelector('#storage-status');
  if (status) status.textContent = message;
}

function persistJsonFile(serialized) {
  if (!jsonFileHandle) return;
  jsonWriteQueue = jsonWriteQueue.then(async () => {
    const writable = await jsonFileHandle.createWritable();
    await writable.write(serialized);
    await writable.close();
    setStorageStatus('Saved in the on-device JSON file.');
  }).catch(() => {
    setStorageStatus('JSON file could not be updated; browser storage is being used.');
  });
}

async function initializeJsonStorage() {
  const startingRevision = stateRevision;
  if (!navigator.storage?.getDirectory) {
    setStorageStatus('This browser does not support private JSON files; browser storage is being used.');
    return;
  }
  try {
    const directory = await navigator.storage.getDirectory();
    jsonFileHandle = await directory.getFileHandle(DATA_FILE_NAME, { create: true });
    const file = await jsonFileHandle.getFile();
    const contents = file.size ? await file.text() : '';
    if (startingRevision !== stateRevision) {
      persistJsonFile(JSON.stringify(state));
      return;
    }
    if (contents.trim()) {
      try {
        state = normalizeState(JSON.parse(contents));
      } catch {
        state = loadState();
      }
    } else {
      state = loadState();
    }
    const serialized = JSON.stringify(state);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch {}
    renderAll();
    persistJsonFile(serialized);
  } catch {
    jsonFileHandle = null;
    setStorageStatus('On-device JSON file unavailable; browser storage is being used.');
  }
}

function money(amount) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).format(amount);
}

function formatMonth(key) {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${value}T12:00:00`));
}

function expensesForMonth(key) {
  return state.expenses.filter(expense => monthKey(expense.date) === key);
}

function total(expenses) {
  return expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
}

function categoryInfo(name) {
  return CATEGORIES.find(category => category.name === name) || CATEGORIES[CATEGORIES.length - 1];
}

function sortedByDate(expenses) {
  return [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

function renderDashboard() {
  const expenses = expensesForMonth(selectedMonth);
  const sum = total(expenses);
  document.querySelector('#dashboard-month').textContent = formatMonth(selectedMonth);
  document.querySelector('#monthly-total').textContent = money(sum);
  document.querySelector('#spending-caption').textContent = expenses.length ? `${expenses.length} ${expenses.length === 1 ? 'expense' : 'expenses'} recorded` : 'No expenses recorded yet';
  document.querySelector('#budget-amount').innerHTML = `${escapeHtml(money(state.budget))} <span>budget</span>`;
  const progress = state.budget > 0 ? Math.min((sum / state.budget) * 100, 100) : 0;
  document.querySelector('#budget-bar').style.width = `${progress}%`;
  document.querySelector('#budget-progress').setAttribute('aria-valuenow', String(Math.round(progress)));
  document.querySelector('#budget-status').textContent = state.budget ? `${Math.round((sum / state.budget) * 100)}% used` : 'Set a budget';
  document.querySelector('#budget-caption').textContent = state.budget ? `${money(Math.max(state.budget - sum, 0))} ${sum > state.budget ? 'over budget' : 'remaining'}` : 'Add a budget in Settings';
  renderComparison();

  const totals = CATEGORIES.map(category => ({ ...category, amount: total(expenses.filter(expense => expense.category === category.name)) })).filter(category => category.amount > 0).sort((a, b) => b.amount - a.amount);
  document.querySelector('#category-meta').textContent = totals.length ? `${totals.length} categories` : '';
  document.querySelector('#category-list').innerHTML = totals.length ? totals.map(category => `<div class="category-row"><div class="category-main"><span class="category-name"><span class="category-dot" style="background:${category.color}"></span>${escapeHtml(category.name)}</span><span class="category-value">${escapeHtml(money(category.amount))}</span></div><div class="category-track"><span style="width:${sum ? category.amount / sum * 100 : 0}%;background:${category.color}"></span></div></div>`).join('') : emptyState('Your categories will appear here', 'Add an expense to see how your spending is split.');
  const recent = sortedByDate(expenses).slice(0, 5);
  document.querySelector('#recent-list').innerHTML = recent.length ? recent.map(renderCompactExpense).join('') : emptyState('A fresh start', 'Your latest expenses will show up here.');
}

function renderComparison() {
  const [year, month] = selectedMonth.split('-').map(Number);
  const months = [-2, -1, 0].map(offset => {
    const key = monthKey(new Date(year, month - 1 + offset, 1));
    return { key, amount: total(expensesForMonth(key)), selected: offset === 0 };
  });
  const maxAmount = Math.max(...months.map(item => item.amount), 1);
  document.querySelector('#comparison-chart').innerHTML = months.map(item => `<div class="comparison-row${item.selected ? ' is-selected' : ''}"><span class="comparison-month">${escapeHtml(formatMonth(item.key))}${item.selected ? '<small>Selected</small>' : ''}</span><div class="comparison-track"><span style="width:${item.amount / maxAmount * 100}%"></span></div><span class="comparison-amount">${escapeHtml(money(item.amount))}</span></div>`).join('');
}

function renderCompactExpense(expense) {
  const category = categoryInfo(expense.category);
  return `<div class="transaction-row"><span class="transaction-icon" style="--icon-bg:${category.background};--icon-color:${category.color}">${category.icon}</span><div class="transaction-details"><div class="transaction-title">${escapeHtml(expense.title)}</div><div class="transaction-subtitle">${escapeHtml(expense.category)} · ${formatDate(expense.date)}</div></div><span class="transaction-amount">${escapeHtml(money(expense.amount))}</span></div>`;
}

function renderHistory() {
  const monthSelect = document.querySelector('#history-month');
  const currentSelection = monthSelect.value;
  const keys = [...new Set([currentMonth, ...state.expenses.map(expense => monthKey(expense.date))])].sort().reverse();
  monthSelect.innerHTML = `<option value="all">All months</option>${keys.map(key => `<option value="${key}">${escapeHtml(formatMonth(key))}</option>`).join('')}`;
  if ([...monthSelect.options].some(option => option.value === currentSelection)) monthSelect.value = currentSelection;

  const categorySelect = document.querySelector('#history-category');
  const selectedCategory = categorySelect.value || 'all';
  categorySelect.innerHTML = `<option value="all">All categories</option>${CATEGORIES.map(category => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join('')}`;
  categorySelect.value = selectedCategory;
  const filtered = sortedByDate(state.expenses).filter(expense => (monthSelect.value === 'all' || monthKey(expense.date) === monthSelect.value) && (categorySelect.value === 'all' || expense.category === categorySelect.value));
  document.querySelector('#result-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'expense' : 'expenses'}`;
  document.querySelector('#history-list').innerHTML = filtered.length ? filtered.map(expense => `<div class="history-row"><div class="transaction-row"><span class="transaction-icon" style="--icon-bg:${categoryInfo(expense.category).background};--icon-color:${categoryInfo(expense.category).color}">${categoryInfo(expense.category).icon}</span><div class="transaction-details"><div class="transaction-title">${escapeHtml(expense.title)}</div><div class="transaction-subtitle">${expense.note ? escapeHtml(expense.note) : escapeHtml(expense.category)}</div></div></div><span class="history-category">${escapeHtml(expense.category)}</span><span class="history-date">${formatDate(expense.date, { year: 'numeric', month: 'short', day: 'numeric' })}</span><span class="history-amount">${escapeHtml(money(expense.amount))}</span><button class="delete-expense" data-delete="${escapeHtml(expense.id)}" aria-label="Delete ${escapeHtml(expense.title)}">×</button></div>`).join('') : emptyState('No expenses found', 'Try another filter or add an expense to get started.');
}

function renderSettings() {
  document.querySelector('#budget-input').value = state.budget || '';
  document.querySelector('#currency-select').value = state.currency;
  document.querySelector('#currency-prefix').textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.currency }).formatToParts(0).find(part => part.type === 'currency').value;
  document.querySelector('#amount-prefix').textContent = document.querySelector('#currency-prefix').textContent;
}

function emptyState(title, message) {
  return `<div class="empty-state"><strong>${escapeHtml(title)}</strong>${escapeHtml(message)}</div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderAll() {
  renderDashboard();
  renderHistory();
  renderSettings();
}

function showView(name) {
  document.querySelectorAll('.view').forEach(view => {
    const active = view.id === `view-${name}`;
    view.hidden = !active;
    view.classList.toggle('is-visible', active);
  });
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', button.dataset.view === name));
  if (name === 'transactions') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
}

function openExpenseDialog() {
  document.querySelector('#expense-form').reset();
  const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.querySelector('#expense-date').value = localToday;
  document.querySelector('#form-error').textContent = '';
  document.querySelector('#amount-prefix').textContent = document.querySelector('#currency-prefix').textContent;
  document.querySelector('#expense-dialog').showModal();
  document.querySelector('#expense-amount').focus();
}

function shiftMonth(offset) {
  const [year, month] = selectedMonth.split('-').map(Number);
  selectedMonth = monthKey(new Date(year, month - 1 + offset, 1));
  renderDashboard();
}

function exportCsv() {
  if (!state.expenses.length) {
    showToast('There are no expenses to export yet.');
    return;
  }
  const rows = [['Date', 'Title', 'Category', 'Amount', 'Currency', 'Note'], ...sortedByDate(state.expenses).map(expense => [expense.date, expense.title, expense.category, Number(expense.amount).toFixed(2), state.currency, expense.note || ''])];
  const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `pocket-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('CSV export downloaded.');
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
['#top-add', '#sidebar-add', '#mobile-add'].forEach(selector => document.querySelector(selector).addEventListener('click', openExpenseDialog));
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => document.querySelector('#expense-dialog').close()));
document.querySelector('#previous-month').addEventListener('click', () => shiftMonth(-1));
document.querySelector('#next-month').addEventListener('click', () => shiftMonth(1));
document.querySelector('#history-month').addEventListener('change', renderHistory);
document.querySelector('#history-category').addEventListener('change', renderHistory);
document.querySelector('#export-csv').addEventListener('click', exportCsv);
document.querySelector('#expense-category').innerHTML = CATEGORIES.map(category => `<option>${escapeHtml(category.name)}</option>`).join('');

document.querySelector('#expense-form').addEventListener('submit', event => {
  event.preventDefault();
  const amount = Number(document.querySelector('#expense-amount').value);
  const title = document.querySelector('#expense-title').value.trim();
  const date = document.querySelector('#expense-date').value;
  if (!Number.isFinite(amount) || amount <= 0 || !title || !date || Number.isNaN(new Date(`${date}T12:00:00`).getTime())) {
    document.querySelector('#form-error').textContent = 'Enter a valid amount, title, and date.';
    return;
  }
  state.expenses.push({ id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`, amount: Math.round(amount * 100) / 100, title, category: document.querySelector('#expense-category').value, date, note: document.querySelector('#expense-note').value.trim(), createdAt: Date.now() });
  saveState();
  if (monthKey(date) !== selectedMonth && monthKey(date) === currentMonth) selectedMonth = currentMonth;
  renderAll();
  document.querySelector('#expense-dialog').close();
  showToast('Expense saved.');
});

document.querySelector('#history-list').addEventListener('click', event => {
  const button = event.target.closest('[data-delete]');
  if (!button) return;
  const expense = state.expenses.find(item => item.id === button.dataset.delete);
  if (!expense || !window.confirm(`Delete "${expense.title}"?`)) return;
  state.expenses = state.expenses.filter(item => item.id !== expense.id);
  saveState();
  renderAll();
  showToast('Expense deleted.');
});

document.querySelector('#budget-input').addEventListener('change', event => {
  state.budget = Math.max(0, Number(event.target.value) || 0);
  saveState();
  renderAll();
  document.querySelector('#settings-message').textContent = 'Budget saved.';
});

document.querySelector('#currency-select').addEventListener('change', event => {
  state.currency = event.target.value;
  saveState();
  renderAll();
  document.querySelector('#settings-message').textContent = 'Currency saved.';
});

document.querySelector('#clear-data').addEventListener('click', () => {
  if (!window.confirm('This permanently deletes all expenses and resets your budget. Continue?')) return;
  state = { expenses: [], budget: 0, currency: 'INR' };
  saveState();
  renderAll();
  showToast('All local data cleared.');
});

function normalizeImportHeader(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z]/g, '');
}

function importedDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const parts = window.XLSX.SSF.parse_date_code(value);
    if (parts) return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  }
  const text = String(value ?? '').trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const dayFirst = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dayFirst) return `${dayFirst[3]}-${String(dayFirst[2]).padStart(2, '0')}-${String(dayFirst[1]).padStart(2, '0')}`;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function importedCategory(value) {
  const key = normalizeImportHeader(value);
  const aliases = {
    fooddrink: 'Food & drink', food: 'Food & drink', groceries: 'Food & drink', grocery: 'Food & drink', dining: 'Food & drink',
    transport: 'Transport', transportation: 'Transport', travel: 'Transport',
    shopping: 'Shopping', retail: 'Shopping',
    bills: 'Bills', utilities: 'Bills',
    health: 'Health', medical: 'Health',
    entertainment: 'Entertainment', leisure: 'Entertainment',
    other: 'Other'
  };
  return aliases[key] || CATEGORIES.find(category => normalizeImportHeader(category.name) === key)?.name || 'Other';
}

function expenseSignature(expense) {
  return [expense.date, expense.title.trim().toLowerCase(), Number(expense.amount).toFixed(2), expense.category, (expense.note || '').trim().toLowerCase()].join('|');
}

document.querySelector('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0];
  const status = document.querySelector('#import-status');
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a spreadsheet smaller than 10 MB.');
    if (!window.XLSX) throw new Error('The spreadsheet reader is unavailable. Reload the app and try again.');
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: '' });
    if (!rows.length) throw new Error('The selected file has no rows.');
    if (rows.length > 10001) throw new Error('Import up to 10,000 expense rows at a time.');
    const headers = rows[0].map(normalizeImportHeader);
    const column = aliases => headers.findIndex(header => aliases.includes(header));
    const dateColumn = column(['date', 'transactiondate', 'expensedate']);
    const amountColumn = column(['amount', 'value', 'total', 'spend']);
    const titleColumn = column(['description', 'title', 'merchant', 'payee', 'expense', 'name']);
    const categoryColumn = column(['category', 'type']);
    const noteColumn = column(['note', 'notes', 'memo']);
    if (dateColumn < 0 || amountColumn < 0 || titleColumn < 0) throw new Error('Required columns: Date, Amount, and Description or Title.');

    const known = new Set(state.expenses.map(expenseSignature));
    const additions = [];
    let skipped = 0;
    for (const row of rows.slice(1)) {
      if (!row.some(value => String(value).trim())) continue;
      const date = importedDate(row[dateColumn]);
      const dateValue = new Date(`${date}T12:00:00`);
      const [dateYear, dateMonth, dateDay] = date.split('-').map(Number);
      const validDate = date && !Number.isNaN(dateValue.getTime()) && dateValue.getFullYear() === dateYear && dateValue.getMonth() + 1 === dateMonth && dateValue.getDate() === dateDay;
      const amountText = typeof row[amountColumn] === 'number' ? row[amountColumn] : String(row[amountColumn]).replace(/[₹$£€,\s]/g, '');
      const amount = Number(amountText);
      const title = String(row[titleColumn] || '').trim();
      if (!validDate || !Number.isFinite(amount) || amount <= 0 || !title) {
        skipped++;
        continue;
      }
      const expense = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        amount: Math.round(amount * 100) / 100,
        title: title.slice(0, 60),
        category: categoryColumn < 0 ? 'Other' : importedCategory(row[categoryColumn]),
        date,
        note: noteColumn < 0 ? '' : String(row[noteColumn] || '').trim().slice(0, 120),
        createdAt: Date.now() + additions.length
      };
      const signature = expenseSignature(expense);
      if (known.has(signature)) {
        skipped++;
        continue;
      }
      known.add(signature);
      additions.push(expense);
    }
    if (!additions.length) throw new Error(skipped ? `No new valid rows found (${skipped} skipped).` : 'No expense rows found below the header.');
    state.expenses.push(...additions);
    try {
      saveState();
    } catch {
      state.expenses.splice(-additions.length);
      throw new Error('There is not enough browser storage for this import. Try a smaller file.');
    }
    renderAll();
    status.textContent = `${additions.length} imported${skipped ? `, ${skipped} skipped` : ''}.`;
    showToast(`${additions.length} expenses imported.`);
  } catch (error) {
    status.textContent = error.message || 'Could not read this spreadsheet.';
  } finally {
    event.target.value = '';
  }
});

document.querySelector('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
renderAll();
initializeJsonStorage();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}