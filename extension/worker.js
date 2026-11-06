chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'promptly-refine-selection',
      title: 'Refine with Promptly',
      contexts: ['selection']
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'promptly-refine-selection' || !tab?.id || !tab.windowId) return;
  const openingPanel = chrome.sidePanel.open({ tabId: tab.id });
  await chrome.storage.session.set({ selectedDraft: info.selectionText || '' });
  await openingPanel;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'PROMPTLY_REFINE_CHATGPT') return;
  let senderOrigin = '';
  try { senderOrigin = new URL(sender.url || '').origin; } catch { /* Reject messages without a page origin. */ }
  if (senderOrigin !== 'https://chatgpt.com') {
    sendResponse({ ok: false, error: 'Promptly accepts in-page requests only from chatgpt.com.' });
    return;
  }

  (async () => {
    const request = typeof message.request === 'string' ? message.request.trim() : '';
    if (!request) throw new Error('Type a rough prompt first.');
    if (request.length > 10000) throw new Error('Keep your request under 10,000 characters.');
    const { promptlyBaseUrl = 'http://localhost:3000', promptlyToken = '' } = await chrome.storage.local.get(['promptlyBaseUrl', 'promptlyToken']);
    if (!promptlyToken) throw new Error('Connect the Promptly side panel to your account first.');
    let response;
    try {
      response = await fetch(`${promptlyBaseUrl}/api/extension/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${promptlyToken}` },
        body: JSON.stringify({ request })
      });
    } catch {
      throw new Error('Could not reach Promptly. Check the server address and extension connection.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Promptly request failed (${response.status}).`);
    return data.prompt;
  })().then(prompt => sendResponse({ ok: true, prompt }))
    .catch(error => sendResponse({ ok: false, error: error.message || 'Promptly could not refine this request.' }));
  return true;
});
