const API_BASE = 'http://localhost:3001/api';

const statusEl = document.getElementById('status');
const queueCountEl = document.getElementById('queueCount');
const unbookmarkBtn = document.getElementById('unbookmarkBtn');
const refreshBtn = document.getElementById('refreshBtn');
const logEl = document.getElementById('log');

let queue = [];

// Logging
function log(msg) {
  console.log(msg);
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.textContent = `${new Date().toLocaleTimeString()}: ${msg}`;
  logEl.prepend(entry);
  logEl.classList.add('visible');
}

// Check connection to backend
async function checkConnection() {
  try {
    const res = await fetch(`${API_BASE}/unbookmark-queue`);
    if (!res.ok) throw new Error('Backend not responding');

    const data = await res.json();
    queue = data.queue || [];

    statusEl.textContent = 'Connected to Bookmark Sort';
    statusEl.className = 'status connected';
    queueCountEl.textContent = queue.length;
    unbookmarkBtn.disabled = queue.length === 0;

    return true;
  } catch (err) {
    statusEl.textContent = 'Cannot connect to Bookmark Sort backend';
    statusEl.className = 'status disconnected';
    queueCountEl.textContent = '-';
    unbookmarkBtn.disabled = true;
    return false;
  }
}

// Start unbookmarking process
async function startUnbookmarking() {
  if (queue.length === 0) {
    log('No tweets to unbookmark');
    return;
  }

  log(`Starting unbookmark for ${queue.length} tweets`);
  unbookmarkBtn.disabled = true;
  unbookmarkBtn.textContent = 'Opening Twitter...';

  // Store queue in extension storage for content script
  await chrome.storage.local.set({ unbookmarkQueue: queue });

  // Open Twitter bookmarks page
  chrome.tabs.create({ url: 'https://twitter.com/i/bookmarks' }, (tab) => {
    log('Opened Twitter bookmarks page');
    unbookmarkBtn.textContent = 'Unbookmarking...';

    // Listen for completion message from content script
    chrome.runtime.onMessage.addListener(function listener(msg) {
      if (msg.type === 'UNBOOKMARK_PROGRESS') {
        log(`Progress: ${msg.completed}/${msg.total}`);
        queueCountEl.textContent = msg.total - msg.completed;
      }
      if (msg.type === 'UNBOOKMARK_COMPLETE') {
        log(`Done! Removed ${msg.success} bookmarks`);
        chrome.runtime.onMessage.removeListener(listener);
        unbookmarkBtn.textContent = 'Start Unbookmarking';
        checkConnection(); // Refresh queue
      }
      if (msg.type === 'UNBOOKMARK_ERROR') {
        log(`Error: ${msg.error}`);
        statusEl.textContent = msg.error;
        statusEl.className = 'status error';
        unbookmarkBtn.textContent = 'Start Unbookmarking';
        unbookmarkBtn.disabled = false;
      }
    });
  });
}

// Event listeners
unbookmarkBtn.addEventListener('click', startUnbookmarking);
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing...';
  log('Refreshing queue from backend...');

  const success = await checkConnection();

  refreshBtn.disabled = false;
  refreshBtn.textContent = 'Refresh Queue';

  if (success) {
    log(`Queue updated: ${queue.length} tweets`);
  } else {
    log('Failed to refresh - is backend running?');
  }
});

// Initial load
checkConnection();
