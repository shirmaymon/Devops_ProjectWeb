/**
 * saveload.js
 * Handles all Save / Load interactions with the Flask backend and local file upload.
 * Saving and loading from the server needs a logged-in user (the server knows the user from the
 * session cookie). Depends on: data.js (getState, saveHosts, saveUsers, saveMachines),
 * app.js (showToast), auth.js (apiFetch, requireLogin)
 */

const API = '/api';

// ── Utility ──────────────────────────────────────────────────────────────

/** Handles a 401 from the server (session ended): go back to the login page. */
function handleSessionEnded() {
  showToast('Your session ended. Please log in again.', 3000);
  setTimeout(() => { location.href = 'login.html'; }, 1500);
}

function isValidVmCalcData(data) {
  return (
    data &&
    typeof data === 'object' &&
    Array.isArray(data.hosts) &&
    Array.isArray(data.users) &&
    typeof data.machines === 'object' && !Array.isArray(data.machines)
  );
}

// ── Save to Backend ───────────────────────────────────────────────────────

async function saveToBackend() {
  const state = getState();
  const res = await apiFetch(`${API}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: state }),
  });

  if (res.status === 201) {
    const { filename } = await res.json();
    // Also trigger browser download
    downloadStateAsJson(filename, state);
    showToast(`✓ Saved as ${filename}`);
    return true;
  }

  if (res.status === 401) {
    handleSessionEnded();
    return false;
  }

  if (res.status === 409) {
    // Limit reached — handle deletion flow
    const { oldest } = await res.json();
    return await handleLimitReached(oldest, state);
  }

  const { error } = await res.json().catch(() => ({ error: 'Unknown error' }));
  showToast(`✗ Save failed: ${error}`, 4000);
  return false;
}

async function handleLimitReached(oldest, state) {
  // Open the limit-reached modal
  openLimitModal(oldest, state);
  return false; // modal handles the rest
}

async function forceSave(deleteFilename, state) {
  const res = await apiFetch(`${API}/save/force`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: state, delete_filename: deleteFilename }),
  });

  if (res.status === 201) {
    const { filename } = await res.json();
    downloadStateAsJson(filename, state);
    showToast(`✓ Saved as ${filename}`);
    return true;
  }

  if (res.status === 401) {
    handleSessionEnded();
    return false;
  }

  showToast('✗ Save failed', 4000);
  return false;
}

// ── Browser Download ──────────────────────────────────────────────────────

function downloadStateAsJson(filename, state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Load from Backend ─────────────────────────────────────────────────────

async function fetchUserFiles() {
  const res = await apiFetch(`${API}/files`);
  if (res.status === 401) { handleSessionEnded(); return []; }
  if (!res.ok) return [];
  const { files } = await res.json();
  return files;
}

async function loadFromBackend(filename) {
  const res = await apiFetch(`${API}/files/load?filename=${encodeURIComponent(filename)}`);
  if (!res.ok) {
    showToast('✗ Could not load file', 4000);
    return;
  }
  const data = await res.json();
  if (!isValidVmCalcData(data)) {
    showToast('✗ File is not a valid VM Calc export', 4000);
    return;
  }
  saveHosts(data.hosts);
  saveUsers(data.users);
  saveMachines(data.machines);
  showToast('✓ Data loaded from backend');
  if (typeof updateStatus === 'function') updateStatus();
}

async function downloadFromBackend(filename) {
  const url = `${API}/files/download?filename=${encodeURIComponent(filename)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

async function deleteFromBackend(filename) {
  const res = await apiFetch(`${API}/files/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename }),
  });
  return res.ok;
}

// ── Load from Local File ──────────────────────────────────────────────────

function loadFromLocalFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!isValidVmCalcData(data)) {
          reject(new Error('The selected file is not a valid VM Calc export.'));
          return;
        }
        saveHosts(data.hosts);
        saveUsers(data.users);
        saveMachines(data.machines);
        if (typeof updateStatus === 'function') updateStatus();
        resolve();
      } catch {
        reject(new Error('File could not be parsed as JSON.'));
      }
    };
    reader.readAsText(file);
  });
}

// ── Modal Builders ────────────────────────────────────────────────────────

function buildModal(id, html) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'modal-overlay hidden';
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  return el;
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// ── Save Modal ────────────────────────────────────────────────────────────

async function openSaveModal() {
  const state = getState();
  if (!state.hosts.length && !state.users.length && !Object.keys(state.machines).length) {
    showToast('Nothing to save — add some data first.', 3500);
    return;
  }
  if (!(await requireLogin())) return;

  const modal = buildModal('saveModal', `
    <div class="modal-box">
      <div class="modal-title">💾 Save Data</div>
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem">
        Saving as <strong id="saveUserName"></strong>.
        File will be downloaded to your browser <strong>and</strong> saved to the server.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal('saveModal')">Cancel</button>
        <button class="btn btn-primary" id="saveConfirmBtn">Save</button>
      </div>
    </div>
  `);

  document.getElementById('saveUserName').textContent = currentUser.name;
  modal.classList.remove('hidden');

  document.getElementById('saveConfirmBtn').addEventListener('click', async () => {
    closeModal('saveModal');
    await saveToBackend();
  });
}

// ── Limit Reached Modal ───────────────────────────────────────────────────

function openLimitModal(oldest, state) {
  const modal = buildModal('limitModal', `
    <div class="modal-box">
      <div class="modal-title" style="color:var(--amber-soft)">⚠️ Save Limit Reached</div>
      <p style="font-size:0.85rem;color:var(--text-dim);margin-bottom:1rem">
        You already have 5 saved files. To save a new one, the oldest file must be deleted:
      </p>
      <div class="warn-box" style="margin-bottom:1rem">
        <strong>${oldest.filename}</strong><br/>
        Saved: ${oldest.saved_at} · ${oldest.size_kb} KB
      </div>
      <p style="font-size:0.8rem;color:var(--text-dim);margin-bottom:1.25rem">
        You can download it first before deleting.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal('limitModal')">Cancel</button>
        <button class="btn btn-ghost" id="downloadOldestBtn">⬇ Download oldest first</button>
        <button class="btn btn-danger" id="deleteAndSaveBtn">Delete & Save new</button>
      </div>
    </div>
  `);

  modal.classList.remove('hidden');

  document.getElementById('downloadOldestBtn').addEventListener('click', () => {
    downloadFromBackend(oldest.filename);
  });

  document.getElementById('deleteAndSaveBtn').addEventListener('click', async () => {
    closeModal('limitModal');
    await forceSave(oldest.filename, state);
  });
}

// ── Load Modal ────────────────────────────────────────────────────────────

async function openLoadModal() {
  // The "Upload from my computer" option works without a login; "Load from server" asks for it.
  const modal = buildModal('loadModal', `
    <div class="modal-box">
      <div class="modal-title">📂 Load Data</div>
      <div class="sub-menu" style="margin-bottom:1.5rem">
        <button class="btn btn-primary" id="loadLocalBtn">Upload from my computer</button>
        <button class="btn btn-ghost"   id="loadBackendBtn">Load from server</button>
      </div>

      <!-- Local file upload -->
      <div id="localUploadPanel" style="display:none">
        <div class="section-label">Select a JSON file</div>
        <input type="file" id="localFileInput" accept=".json"
               style="color:var(--text);font-size:0.85rem;margin-bottom:1rem"/>
        <span class="error-msg" id="localFileErr" style="display:block;margin-bottom:0.5rem"></span>
        <div class="modal-actions">
          <button class="btn btn-ghost" onclick="closeModal('loadModal')">Cancel</button>
          <button class="btn btn-primary" id="localLoadConfirmBtn">Load</button>
        </div>
      </div>

      <!-- Backend load -->
      <div id="backendLoadPanel" style="display:none">
        <div id="fileListWrap">
          <div class="section-label">Your saved files</div>
          <div id="fileList"></div>
        </div>
        <div class="modal-actions" style="margin-top:1rem">
          <button class="btn btn-ghost" onclick="closeModal('loadModal')">Cancel</button>
        </div>
      </div>
    </div>
  `);

  modal.classList.remove('hidden');

  // Toggle panels
  document.getElementById('loadLocalBtn').addEventListener('click', () => {
    document.getElementById('localUploadPanel').style.display  = 'block';
    document.getElementById('backendLoadPanel').style.display  = 'none';
  });
  document.getElementById('loadBackendBtn').addEventListener('click', async () => {
    if (!(await requireLogin())) return;
    document.getElementById('backendLoadPanel').style.display  = 'block';
    document.getElementById('localUploadPanel').style.display  = 'none';
    await refreshFileList();
  });

  // Local file load
  document.getElementById('localLoadConfirmBtn').addEventListener('click', async () => {
    const input = document.getElementById('localFileInput');
    const errEl = document.getElementById('localFileErr');
    if (!input.files.length) {
      errEl.textContent = 'Please select a file.';
      return;
    }
    try {
      await loadFromLocalFile(input.files[0]);
      closeModal('loadModal');
      showToast('✓ Data loaded from file');
    } catch (e) {
      errEl.textContent = e.message;
    }
  });
}

// Show the logged-in user's saved files inside the load modal.
async function refreshFileList() {
  const files = await fetchUserFiles();
  const list  = document.getElementById('fileList');
  if (!list) return;

  if (!files.length) {
    list.innerHTML = '<div class="empty-state"><span>📭</span>You have no saved files yet.</div>';
    return;
  }

  list.innerHTML = files.map(f => `
    <div class="status-row" style="gap:0.5rem;flex-wrap:wrap;align-items:center">
      <span style="flex:1;font-size:0.82rem;color:var(--text)">${f.filename}</span>
      <span style="font-size:0.75rem;color:var(--text-dim)">${f.saved_at}</span>
      <button class="btn-sm btn-sm-edit" onclick="(async()=>{await loadFromBackend('${f.filename}');closeModal('loadModal');})()">Load</button>
      <button class="btn-sm btn-sm-edit" onclick="downloadFromBackend('${f.filename}')">⬇</button>
      <button class="btn-sm btn-sm-del"  onclick="confirmDeleteFile('${f.filename}')">🗑</button>
    </div>
  `).join('');
}

// ── Delete confirm (from file list) ──────────────────────────────────────

async function confirmDeleteFile(filename) {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  const ok = await deleteFromBackend(filename);
  if (ok) {
    showToast('✓ File deleted');
    // Refresh list
    await refreshFileList();
  } else {
    showToast('✗ Delete failed', 4000);
  }
}
