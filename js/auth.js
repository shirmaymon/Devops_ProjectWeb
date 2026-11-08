/**
 * auth.js
 * Login state for the pages. The session itself is an HttpOnly cookie that JavaScript cannot read;
 * this file asks the server who is logged in (/api/auth/me) and keeps the CSRF token in memory only
 * (not in localStorage / sessionStorage), then sends it with every request that changes data.
 * Depends on: app.js (showToast)
 */

const AUTH_API = '/api/auth';

let currentUser = null;
let csrfToken = null;

async function loadSession() {
  try {
    const res = await fetch(`${AUTH_API}/me`);
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      csrfToken = data.csrf_token;
    } else {
      currentUser = null;
      csrfToken = null;
    }
  } catch {
    currentUser = null;
    csrfToken = null;
  }
  renderAuthBox();
  return currentUser;
}

// Resolved once the first /me answer is in, so buttons clicked early still know the state.
const sessionReady = loadSession();

/** fetch() that adds the CSRF token to requests that change data. */
function apiFetch(url, options = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  return fetch(url, { ...options, headers });
}

/** Returns true when a user is logged in; otherwise sends the visitor to the login page. */
async function requireLogin() {
  await sessionReady;
  if (currentUser) return true;
  showToast('Please log in first. Your data stays in this tab.', 2500);
  setTimeout(() => { location.href = 'login.html'; }, 1200);
  return false;
}

async function logout() {
  await apiFetch(`${AUTH_API}/logout`, { method: 'POST' });
  currentUser = null;
  csrfToken = null;
  renderAuthBox();
  showToast('Logged out');
}

/** Fills <div id="authBox"> in the page header, if the page has one. */
function renderAuthBox() {
  const box = document.getElementById('authBox');
  if (!box) return;
  box.textContent = '';
  if (currentUser) {
    const hello = document.createElement('span');
    hello.className = 'dim';
    hello.style.fontSize = '0.82rem';
    hello.textContent = `Hi, ${currentUser.name}`;
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost';
    btn.textContent = 'Log out';
    btn.addEventListener('click', logout);
    box.append(hello, btn);
  } else {
    const link = document.createElement('a');
    link.className = 'btn btn-ghost';
    link.href = 'login.html';
    link.textContent = 'Log in';
    box.append(link);
  }
}
