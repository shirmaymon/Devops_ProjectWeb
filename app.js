/**
 * app.js — shared utilities
 */

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// Highlight active nav link
document.addEventListener('DOMContentLoaded', () => {
  const page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.getAttribute('href') === page);
  });
});

function validatePositiveInt(val, fieldName) {
  const n = parseInt(val, 10);
  if (val === '' || val === null || val === undefined) return `${fieldName} is required.`;
  if (isNaN(n)) return `${fieldName} must be a whole number.`;
  if (n <= 0) return `${fieldName} must be greater than 0.`;
  return '';
}

function validateNonEmpty(val, fieldName) {
  if (!val || val.trim() === '') return `${fieldName} is required.`;
  return '';
}

function setError(inputEl, msgEl, msg) {
  if (msg) {
    inputEl.classList.add('error');
    msgEl.textContent = msg;
    return false;
  }
  inputEl.classList.remove('error');
  msgEl.textContent = '';
  return true;
}
