const $ = (selector) => document.querySelector(selector);
const form = $('#refineForm');
let config = { baseUrl: 'http://localhost:3000', token: '' };

function showMessage(text, kind = 'error') {
  const message = $('#message');
  message.textContent = text;
  message.classList.toggle('success', kind === 'success');
  message.hidden = false;
}
function normalizeBase(value) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Enter a server origin such as http://localhost:3000 or https://promptly.example.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for a remote Promptly server.');
  return url.origin;
}
async function requestHostPermission(baseUrl) {
  const origin = `${new URL(baseUrl).origin}/*`;
  return chrome.permissions.request({ origins: [origin] });
}
async function authorizedFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${config.token}` }
    });
  } catch {
    throw new Error('Could not reach Promptly. Check the server address, allow its connection, and confirm the server was restarted after setup.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
  return data;
}
async function activeChatGPTTab() {
  const permitted = await chrome.permissions.request({ origins: ['https://chatgpt.com/*'] });
  if (!permitted) throw new Error('Allow Promptly to access chatgpt.com when Chrome asks, then try again.');
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url?.startsWith('https://chatgpt.com/')) throw new Error('Open the ChatGPT conversation you want to use, then try again. Promptly keeps the prompt in that same chat.');
  return tab;
}
async function putPromptInChatGPT(tabId, prompt, send = false) {
  const [injection] = await chrome.scripting.executeScript({ target: { tabId }, args: [prompt, send], func: async (text, shouldSend) => {
    const editor = document.querySelector('#prompt-textarea') || document.querySelector('[contenteditable="true"][role="textbox"]') || document.querySelector('textarea');
    if (!editor) return { inserted: false, sent: false };
    editor.focus();
    if (editor.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      const actual = String(editor.innerText || editor.textContent || '').trim();
      if (actual !== text.trim()) {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
    } else {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')?.set;
      if (setter) setter.call(editor, text); else editor.value = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      editor.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (!shouldSend) return { inserted: true, sent: false };
    const sendButton = document.querySelector('button[data-testid="send-button"]') ||
      [...document.querySelectorAll('button')].find(button => /send prompt|send message/i.test(`${button.getAttribute('aria-label') || ''} ${button.title || ''}`));
    let sent = false;
    if (sendButton && !sendButton.disabled) { sendButton.click(); sent = true; }
    else {
      const form = editor.closest('form');
      if (form?.requestSubmit) { form.requestSubmit(); sent = true; }
    }
    if (!sent) return { inserted: true, sent: false };
    return { inserted: true, sent: true };
  } });
  return injection?.result || { inserted: false, sent: false };
}
function setConnected(connected) {
  $('#connectionDot').classList.toggle('offline', !connected);
  $('#settingsToggle').setAttribute('aria-label', connected ? 'Connection settings; connected' : 'Connection settings; not connected');
}
async function loadConnection() {
  const saved = await chrome.storage.local.get(['promptlyBaseUrl', 'promptlyToken']);
  config.baseUrl = saved.promptlyBaseUrl || 'http://localhost:3000';
  config.token = saved.promptlyToken || '';
  $('#serverUrl').value = config.baseUrl;
  if (!config.token) { setConnected(false); $('#settingsPanel').hidden = false; $('#settingsToggle').setAttribute('aria-expanded', 'true'); return; }
  try {
    const origin = `${new URL(config.baseUrl).origin}/*`;
    if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('Allow Promptly to connect using the settings button.');
    await authorizedFetch('/api/extension/status');
    setConnected(true);
  } catch {
    setConnected(false);
    $('#settingsPanel').hidden = false;
    $('#settingsToggle').setAttribute('aria-expanded', 'true');
  }
}
$('#settingsToggle').addEventListener('click', () => {
  const panel = $('#settingsPanel'); panel.hidden = !panel.hidden;
  $('#settingsToggle').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('#serverUrl').focus();
});
$('#connectButton').addEventListener('click', async () => {
  const button = $('#connectButton'); button.disabled = true; button.textContent = 'Checking connection…';
  try {
    const baseUrl = normalizeBase($('#serverUrl').value);
    const token = $('#connectionToken').value.trim();
    if (!token) throw new Error('Paste the connection token from Promptly first.');
    if (!await requestHostPermission(baseUrl)) throw new Error('Allow Promptly to connect to this server to continue.');
    config = { baseUrl, token };
    await authorizedFetch('/api/extension/status');
    await chrome.storage.local.set({ promptlyBaseUrl: baseUrl, promptlyToken: token });
    $('#connectionToken').value = '';
    $('#settingsPanel').hidden = true;
    $('#settingsToggle').setAttribute('aria-expanded', 'false');
    setConnected(true);
    showMessage('Connected. Your prompts will now be refined by your Promptly server.', 'success');
  } catch (error) { showMessage(error.message); setConnected(false); }
  finally { button.disabled = false; button.textContent = 'Connect securely'; }
});
$('#enableInlineButton').addEventListener('click', async () => {
  const button = $('#enableInlineButton'); button.disabled = true; button.textContent = 'Adding to ChatGPT…'; $('#message').hidden = true;
  try {
    if (!config.token) throw new Error('Connect your Promptly account first using the gear button above.');
    const tab = await activeChatGPTTab();
    const contentScriptId = 'promptly-chatgpt-inline';
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [contentScriptId] });
    if (!existing.length) await chrome.scripting.registerContentScripts([{
      id: contentScriptId,
      matches: ['https://chatgpt.com/*'],
      js: ['chatgpt.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true
    }]);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['chatgpt.js'] });
    showMessage('Promptly is now beside ChatGPT’s send button. Type a rough prompt there and click Refine & send.', 'success');
  } catch (error) { showMessage(error.message || 'Could not add Promptly to ChatGPT.'); }
  finally { button.disabled = false; button.textContent = 'Add Promptly to ChatGPT'; }
});
$('#roughPrompt').addEventListener('input', () => { $('#charCount').textContent = `${$('#roughPrompt').value.length.toLocaleString()} / 10,000`; });
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const request = $('#roughPrompt').value.trim();
  if (!request) return;
  if (!config.token) { showMessage('Connect your Promptly account first, using the gear button above.'); $('#settingsPanel').hidden = false; $('#settingsToggle').setAttribute('aria-expanded', 'true'); return; }
  const button = $('#refineButton'); button.disabled = true; button.innerHTML = '<span class="spinner" aria-hidden="true">◌</span> Preparing ChatGPT…';
  $('#message').hidden = true;
  try {
    const tab = await activeChatGPTTab();
    button.innerHTML = '<span class="spinner" aria-hidden="true">◌</span> Refining…';
    const result = await authorizedFetch('/api/extension/refine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) });
    const sent = await putPromptInChatGPT(tab.id, result.prompt, true);
    if (sent.sent) {
      showMessage('Refined and sent in your current ChatGPT conversation.', 'success');
      $('#roughPrompt').value = ''; $('#roughPrompt').dispatchEvent(new Event('input'));
    } else if (sent.inserted) showMessage('Refined and entered into the current chat. Press Send in ChatGPT to continue.', 'success');
    else showMessage('Promptly refined the request, but could not find ChatGPT’s message box. Reload the ChatGPT tab and try again.');
  } catch (error) {
    if (error.status === 401) { setConnected(false); showMessage('This connection expired or was revoked. Reconnect it from Promptly.'); }
    else showMessage(error.message || 'Promptly could not refine this request. Try again in a moment.');
  } finally { button.disabled = false; button.innerHTML = '<span class="spark" aria-hidden="true">✳</span> Refine &amp; send in ChatGPT'; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.selectedDraft?.newValue) {
    $('#roughPrompt').value = changes.selectedDraft.newValue.slice(0, 10000);
    $('#roughPrompt').dispatchEvent(new Event('input'));
    chrome.storage.session.remove('selectedDraft');
  }
});
chrome.storage.session.get('selectedDraft').then(({ selectedDraft }) => {
  if (selectedDraft) { $('#roughPrompt').value = selectedDraft.slice(0, 10000); $('#roughPrompt').dispatchEvent(new Event('input')); chrome.storage.session.remove('selectedDraft'); }
});
loadConnection();
