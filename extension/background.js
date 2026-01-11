// Background service worker
// Handles message passing between popup and content scripts

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Forward messages from content script to popup
  if (message.type === 'UNBOOKMARK_PROGRESS' ||
      message.type === 'UNBOOKMARK_COMPLETE' ||
      message.type === 'UNBOOKMARK_ERROR') {
    // Broadcast to all extension pages (popup)
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, that's ok
    });
  }
  return true;
});

// Log when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Bookmark Sort] Extension installed');
});
