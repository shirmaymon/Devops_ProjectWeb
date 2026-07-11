/**
 * saveload.js
 * Handles all Save / Load interactions with the Flask backend and local file upload.
 * Depends on: data.js (getState, saveHosts, saveUsers, saveMachines), app.js (showToast)
 */

const API = '/api';

// ── Utility ──────────────────────────────────────────────────────────────

function formatName(first, last) {
  return `${first.trim().toLowerCase()}_${last.trim().toLowerCase()}`;
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

async function saveToBackend(first, last) {
  const state = getState();
  const res = await fetch(`${API}/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first, last, data: state }),
  });

  if (res.status === 201) {
    const { filename } = await res.json();
    // Also trigger browser download
    downloadStateAsJson(first, last, state);
    showToast(`✓ Saved as ${filename}`);
    return true;
  }

  if (res.status === 409) {
    // Limit reached — handle deletion flow
    const { oldest } = await res.json();
    return await handleLimitReached(first, last, oldest, state);
  }

  const { error } = await res.json().catch(() => ({ error: 'Unknown error' }));
  showToast(`✗ Save failed: ${error}`, 4000);
  return false;
}

async function handleLimitReached(first, last, oldest, state) {
  // Open the limit-reached modal
  openLimitModal(first, last, oldest, state);
  return false; // modal handles the rest
}

async function forceSave(first, last, deleteFilename, state) {
  const res = await fetch(`${API}/save/force`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first, last, data: state, delete_filename: deleteFilename }),
  });

  if (res.status === 201) {
    const { filename } = await res.json();
    downloadStateAsJson(first, last, state);
    showToast(`✓ Saved as ${filename}`);
    return true;
  }

  showToast('✗ Save failed', 4000);
  return false;
}

// ── Browser Download ──────────────────────────────────────────────────────

function downloadStateAsJson(first, last, state) {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts  = `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const filename = `${formatName(first, last)}_${ts}.json`;

  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Load from Backend ─────────────────────────────────────────────────────

async function fetchUserFiles(first, last) {
  const res = await fetch(`${API}/files?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}`);
  if (!res.ok) return [];
  const { files } = await res.json();
  return files;
}

async function loadFromBackend(first, last, filename) {
  const res = await fetch(
    `${API}/files/load?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}&filename=${encodeURIComponent(filename)}`
  );
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

async function downloadFromBackend(first, last, filename) {
  const url = `${API}/files/download?first=${encodeURIComponent(first)}&last=${encodeURIComponent(last)}&filename=${encodeURIComponent(filename)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

async function deleteFromBackend(first, last, filename) {
  const res = await fetch(`${API}/files/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ first, last, filename }),
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

function openSaveModal() {
  const state = getState();
  if (!state.hosts.length && !state.users.length && !Object.keys(state.machines).length) {
    showToast('Nothing to save — add some data first.', 3500);
    return;
  }

  const modal = buildModal('saveModal', `
    <div class="modal-box">
      <div class="modal-title">💾 Save Data</div>
      <div class="form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:1rem">
        <div class="form-group">
          <label>First Name</label>
          <input type="text" id="saveFirst" placeholder="e.g. Shir" autocomplete="off"/>
          <span class="error-msg" id="saveFirstErr"></span>
        </div>
        <div class="form-group">
          <label>Last Name</label>
          <input type="text" id="saveLast" placeholder="e.g. Cohen" autocomplete="off"/>
          <span class="error-msg" id="saveLastErr"></span>
        </div>
      </div>
      <p style="font-size:0.8rem;color:var(--text-dim);margin-bottom:1rem">
        File will be downloaded to your browser <strong>and</strong> saved to the server.
      </p>
      <div class="modal-actions">
        <button class="btn btn-ghost" onclick="closeModal('saveModal')">Cancel</button>
        <button class="btn btn-primary" id="saveConfirmBtn">Save</button>
      </div>
    </div>
  `);

  modal.classList.remove('hidden');

  document.getElementById('saveConfirmBtn').addEventListener('click', async () => {
    const first = document.getElementById('saveFirst').value.trim();
    const last  = document.getElementById('saveLast').value.trim();
    let valid = true;

    if (!first) {
      document.getElementById('saveFirstErr').textContent = 'First name is required';
      document.getElementById('saveFirst').classList.add('error');
      valid = false;
    } else {
      document.getElementById('saveFirstErr').textContent = '';
      document.getElementById('saveFirst').classList.remove('error');
    }
    if (!last) {
      document.getElementById('saveLastErr').textContent = 'Last name is required';
      document.getElementById('saveLast').classList.add('error');
      valid = false;
    } else {
      document.getElementById('saveLastErr').textContent = '';
      document.getElementById('saveLast').classList.remove('error');
    }
    if (!valid) return;

    closeModal('saveModal');
    await saveToBackend(first, last);
  });
}

// ── Limit Reached Modal ───────────────────────────────────────────────────

function openLimitModal(first, last, oldest, state) {
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
    downloadFromBackend(first, last, oldest.filename);
  });

  document.getElementById('deleteAndSaveBtn').addEventListener('click', async () => {
    closeModal('limitModal');
    await forceSave(first, last, oldest.filename, state);
  });
}

// ── Load Modal ────────────────────────────────────────────────────────────

function openLoadModal() {
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
        <div class="form-grid" style="grid-template-columns:1fr 1fr;margin-bottom:1rem">
          <div class="form-group">
            <label>First Name</label>
            <input type="text" id="loadFirst" placeholder="e.g. Shir" autocomplete="off"/>
            <span class="error-msg" id="loadFirstErr"></span>
          </div>
          <div class="form-group">
            <label>Last Name</label>
            <input type="text" id="loadLast" placeholder="e.g. Cohen" autocomplete="off"/>
            <span class="error-msg" id="loadLastErr"></span>
          </div>
        </div>
        <button class="btn btn-ghost" id="fetchFilesBtn" style="margin-bottom:1.25rem">Search files</button>
        <div id="fileListWrap" style="display:none">
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
  document.getElementById('loadBackendBtn').addEventListener('click', () => {
    document.getElementById('backendLoadPanel').style.display  = 'block';
    document.getElementById('localUploadPanel').style.display  = 'none';
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

  // Backend — fetch file list
  document.getElementById('fetchFilesBtn').addEventListener('click', async () => {
    const first = document.getElementById('loadFirst').value.trim();
    const last  = document.getElementById('loadLast').value.trim();
    let valid = true;

    if (!first) { document.getElementById('loadFirstErr').textContent = 'Required'; valid = false; }
    else           document.getElementById('loadFirstErr').textContent = '';
    if (!last)  { document.getElementById('loadLastErr').textContent  = 'Required'; valid = false; }
    else           document.getElementById('loadLastErr').textContent  = '';
    if (!valid) return;

    const files = await fetchUserFiles(first, last);
    const wrap  = document.getElementById('fileListWrap');
    const list  = document.getElementById('fileList');
    wrap.style.display = 'block';

    if (!files.length) {
      list.innerHTML = '<div class="empty-state"><span>📭</span>No saved files found for this name.</div>';
      return;
    }

    list.innerHTML = files.map(f => `
      <div class="status-row" style="gap:0.5rem;flex-wrap:wrap;align-items:center">
        <span style="flex:1;font-size:0.82rem;color:var(--text)">${f.filename}</span>
        <span style="font-size:0.75rem;color:var(--text-dim)">${f.saved_at}</span>
        <button class="btn-sm btn-sm-edit" onclick="(async()=>{await loadFromBackend('${first}','${last}','${f.filename}');closeModal('loadModal');})()">Load</button>
        <button class="btn-sm btn-sm-edit" onclick="downloadFromBackend('${first}','${last}','${f.filename}')">⬇</button>
        <button class="btn-sm btn-sm-del"  onclick="confirmDeleteFile('${first}','${last}','${f.filename}')">🗑</button>
      </div>
    `).join('');
  });
}

// ── Delete confirm (from file list) ──────────────────────────────────────

async function confirmDeleteFile(first, last, filename) {
  if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
  const ok = await deleteFromBackend(first, last, filename);
  if (ok) {
    showToast('✓ File deleted');
    // Refresh list
    document.getElementById('fetchFilesBtn').click();
  } else {
    showToast('✗ Delete failed', 4000);
  }
}
