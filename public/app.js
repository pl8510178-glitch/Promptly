const state = { mode: null, task: 'explain', questions: [], answers: {}, user: null, currentPromptId: null, prompts: [], authMode: 'login', detail: null, saving: false, currentView: null };
const panels = { choose: document.querySelector('#choosePanel'), context: document.querySelector('#contextPanel'), result: document.querySelector('#resultPanel') };
const taskOptions = { study: [{id:'explain',label:'Understand a topic'},{id:'practice',label:'Practice & quiz'},{id:'feedback',label:'Get feedback'}], code: [{id:'debug',label:'Debug an issue'},{id:'build',label:'Build a feature'},{id:'review',label:'Review code'}], image: [{id:'edit',label:'Edit an existing image'},{id:'create',label:'Create a new image'}] };
const $ = (selector) => document.querySelector(selector);

async function api(path, body = null, method = body ? 'POST' : 'GET') {
  const options = { method, headers: {} };
  if (body !== null) { options.headers['content-type'] = 'application/json'; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status}).`), { status: response.status });
  return data;
}
function show(name, { fromHistory = false } = {}) {
  if (state.user && !fromHistory && state.currentView !== name && history.state?.promptlyView !== name) {
    if (name === 'choose' && !history.state?.promptlyView) history.replaceState({ promptlyView: name }, '', location.href);
    else history.pushState({ promptlyView: name }, '', location.href);
  }
  state.currentView = name;
  Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle('hidden', key !== name));
  $('.stepper').classList.toggle('hidden', name === 'choose' || state.mode === 'general');
  $('#appBackButton').disabled = name === 'choose' && history.length <= 1;
  const active = name === 'choose' ? 1 : name === 'context' ? 2 : 3;
  for (let i = 1; i <= 3; i++) { const step = $(`#step${i}`); step.classList.toggle('active', i === active); step.classList.toggle('done', i < active); }
  if (state.mode === 'image') $('#step3 i').textContent = 'Build prompt'; else $('#step3 i').textContent = 'Build & run';
  $('#breadcrumbCurrent').textContent = name === 'choose' ? 'Prompt studio' : name === 'context' ? state.mode === 'image' ? 'Image prompt' : 'New prompt' : state.currentPromptId ? 'Saved prompt' : 'Prompt draft';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function showAuthError(message = '') { $('#authError').textContent = message; }
function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === 'register';
  $('#authTitle').textContent = registering ? 'Create your account' : 'Welcome back';
  $('#authSubtitle').textContent = registering ? 'Save your prompts and pick up your work anytime.' : 'Sign in to continue to your prompt studio.';
  $('#nameField').classList.toggle('hidden', !registering);
  $('#authSubmit').innerHTML = registering ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>';
  $('#authSwitchText').textContent = registering ? 'Already have an account?' : 'New to Promptly?';
  $('#authSwitch').textContent = registering ? 'Sign in' : 'Create an account';
  $('#authForm [name=password]').autocomplete = registering ? 'new-password' : 'current-password';
  showAuthError();
}
function enterApp(user) {
  state.user = user;
  $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden');
  $('#userName').textContent = user.name; $('#userEmail').textContent = user.email; $('#userAvatar').textContent = user.name.trim().charAt(0).toUpperCase();
  history.replaceState({ promptlyView: 'choose' }, '', location.href);
  loadProfileAvatar();
  show('choose'); checkModel(); loadHome();
}
function leaveApp() {
  state.user = null; state.currentPromptId = null; state.detail = null;
  state.currentView = null;
  if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
  state.avatarUrl = null; $('#userAvatarImage').classList.add('hidden'); $('#userAvatar').classList.remove('hidden');
  $('#appShell').classList.add('hidden'); $('#authScreen').classList.remove('hidden');
  $('#authForm').reset(); setAuthMode('login');
}
async function checkModel() {
  try {
    const { aiConfigured } = await api('/api/health');
    $('#statusText').textContent = aiConfigured ? 'AI ready' : 'AI setup needed';
    $('#statusDot').classList.toggle('offline', !aiConfigured);
    $('#railStatusText').textContent = aiConfigured ? 'Ready' : 'Setup needed';
    $('#railStatusDot').classList.toggle('offline', !aiConfigured);
    $('#railFootnote').textContent = 'Your rough request is sent to Promptly’s configured AI to improve it. The polished prompt opens in ChatGPT. Avoid entering passwords or sensitive information.';
  } catch {
    $('#statusText').textContent = 'AI status unavailable'; $('#statusDot').classList.add('offline');
    $('#railStatusText').textContent = 'Unavailable'; $('#railStatusDot').classList.add('offline');
  }
}
async function loadProfileAvatar() {
  try {
    const response = await fetch('/api/profile/avatar');
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
    state.avatarUrl = url; $('#userAvatarImage').src = url;
    $('#userAvatarImage').classList.remove('hidden'); $('#userAvatar').classList.add('hidden');
  } catch { /* Keep the user's name initial as a reliable fallback. */ }
}
async function prepareAvatar(file) {
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { window.alert('Choose a JPEG, PNG, or WebP photo.'); return; }
  if (file.size > 8 * 1024 * 1024) { window.alert('Choose a profile photo under 8 MB.'); return; }
  try {
    const fileUrl = await awaitFileData(file);
    const source = await new Promise((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('This photo could not be opened.'));
      image.src = fileUrl;
    });
    if (source.naturalWidth * source.naturalHeight > 30_000_000) throw new Error('Choose a photo under 30 megapixels.');
    const scale = Math.min(1, 512 / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(source.naturalWidth * scale); canvas.height = Math.round(source.naturalHeight * scale);
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL('image/webp', 0.86);
    await api('/api/profile/avatar', { image }, 'PUT'); await loadProfileAvatar();
  } catch (error) { window.alert(error.message || 'Could not save the profile photo.'); }
}
function awaitFileData(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read this photo.')); reader.readAsDataURL(file); });
}
function goBack(fallback) {
  if (history.state?.promptlyView && state.currentView !== 'choose') history.back();
  else show(fallback);
}
function formatDate(value) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function workspaceLabel(mode) { return mode === 'general' ? 'Quick ask' : mode === 'study' ? 'Study' : mode === 'image' ? 'Image' : 'Software development'; }
function promptModeLabel(mode, task) { return `${mode === 'general' ? '✳ QUICK ASK' : mode === 'study' ? '✎ STUDY' : mode === 'image' ? '▧ IMAGE' : '</> SOFTWARE'} · ${task.toUpperCase()} PROMPT`; }
function setResultHeading(mode) {
  $('.result-heading .overline').textContent = mode === 'general' ? 'POLISHED PROMPT · CHATGPT' : mode === 'image' ? 'READY-TO-USE IMAGE PROMPT' : mode === 'study' ? 'REUSABLE STUDY PROMPT' : 'REUSABLE DEVELOPMENT PROMPT';
  $('.result-heading h2').textContent = mode === 'general' ? 'Your improved prompt is ready.' : mode === 'image' ? 'Your image prompt is ready.' : mode === 'study' ? 'Your study prompt is ready.' : 'Your development prompt is ready.';
  $('.result-heading p').textContent = mode === 'general' ? 'Promptly polished your request with its configured AI. It opens ChatGPT with the improved prompt so ChatGPT can answer it.' : mode === 'image' ? 'Copy it into your image editor, or save it for later.' : mode === 'study' ? 'This is the prompt only. Copy or save it, then paste it into the AI tool you choose.' : 'This is a reusable prompt. Copy or save it, or choose “Try prompt with AI” to run it.';
}
function renderPromptList(prompts) {
  const list = $('#promptList'); list.replaceChildren();
  if (!prompts.length) {
    const empty = document.createElement('div'); empty.className = 'empty-library';
    empty.innerHTML = '<span>✳</span><strong>Your prompt library is ready</strong><p>Generate and save a prompt to see it here.</p>';
    list.append(empty); return;
  }
  for (const prompt of prompts) {
    const card = document.createElement('article'); card.className = 'prompt-card';
    const info = document.createElement('button'); info.className = 'prompt-card-main'; info.type = 'button';
    const title = document.createElement('strong'); title.textContent = prompt.title;
    const desc = document.createElement('span'); desc.className = 'prompt-preview'; desc.textContent = prompt.preview;
    const meta = document.createElement('span'); meta.className = 'prompt-card-meta'; meta.textContent = `${workspaceLabel(prompt.mode)} · ${prompt.versionCount} ${prompt.versionCount === 1 ? 'version' : 'versions'} · Updated ${formatDate(prompt.updatedAt)}`;
    info.append(title, desc, meta); info.addEventListener('click', () => openPrompt(prompt.id));
    const actions = document.createElement('div'); actions.className = 'prompt-card-actions';
    const runCount = document.createElement('span'); runCount.className = 'prompt-run-count'; runCount.textContent = `${prompt.runCount} ${prompt.runCount === 1 ? 'run' : 'runs'}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete-prompt-button'; remove.title = 'Delete saved prompt'; remove.setAttribute('aria-label', `Delete ${prompt.title}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', () => deletePrompt(prompt)); actions.append(runCount, remove); card.append(info, actions); list.append(card);
  }
}
async function loadHome() {
  try {
    const data = await api(`/api/prompts?q=${encodeURIComponent($('#searchInput').value.trim())}`);
    state.prompts = data.prompts; renderPromptList(data.prompts);
    $('#promptStat').textContent = data.prompts.length;
    $('#runStat').textContent = data.prompts.reduce((total, prompt) => total + prompt.runCount, 0);
    $('#versionStat').textContent = data.prompts.reduce((total, prompt) => total + prompt.versionCount, 0);
  } catch (error) { renderPromptList([]); $('#promptList').textContent = error.message; }
}
async function refreshExtensionConnection() {
  const status = $('#extensionConnectionStatus');
  try {
    const data = await api('/api/extension-token');
    status.textContent = data.connected ? `Connected · expires ${formatDate(data.expiresAt)}` : 'No browser extension is connected.';
    $('#revokeExtensionButton').classList.toggle('hidden', !data.connected);
    $('#createExtensionTokenButton').textContent = data.connected ? 'Create a new token' : 'Create connection token';
  } catch (error) { status.textContent = error.message; }
}
function renderTasks() {
  const picker = $('#taskPicker'); picker.replaceChildren();
  for (const task of taskOptions[state.mode]) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `task-chip ${task.id === state.task ? 'selected' : ''}`;
    button.dataset.task = task.id; button.textContent = task.label;
    button.addEventListener('click', () => { state.task = task.id; renderTasks(); loadQuestions().catch(showWorkflowError); }); picker.append(button);
  }
}
function showWorkflowError(error) { $('#workflowError').textContent = error.message; $('#workflowError').classList.remove('hidden'); }
async function loadQuestions() {
  const data = await api('/api/questions', { mode: state.mode, task: state.task });
  state.questions = data.questions; $('#workflowError').classList.add('hidden');
  $('#questionGrid').innerHTML = state.questions.map((question, index) => `<div class="field"><label for="q-${question.key}">${question.label}<small>${String(index + 1).padStart(2, '0')}</small></label>${['context', 'code', 'error', 'requirements', 'change', 'imageContext', 'preserve', 'style', 'composition'].includes(question.key) ? `<textarea id="q-${question.key}" name="${question.key}" placeholder="${question.placeholder}"></textarea>` : `<input id="q-${question.key}" name="${question.key}" placeholder="${question.placeholder}" autocomplete="off">`}</div>`).join('');
}
function begin(mode) {
  state.mode = mode; state.task = mode === 'study' ? 'explain' : mode === 'image' ? 'edit' : 'debug'; state.currentPromptId = null; state.detail = null;
  $('#contextOverline').textContent = mode === 'study' ? 'YOUR STUDY SESSION' : mode === 'image' ? 'YOUR IMAGE PROMPT' : 'YOUR BUILD SESSION';
  $('#contextTitle').textContent = mode === 'study' ? 'Let’s make it specific.' : mode === 'image' ? 'Describe the change you want.' : 'Let’s get the details right.';
  $('#contextSub').textContent = mode === 'study' ? 'A few details help us make a prompt that helps the ideas stick.' : mode === 'image' ? 'Tell us what should change and what the editor must preserve. Promptly will shape the brief into a ready-to-use image prompt.' : 'A little technical context helps avoid made-up fixes.';
  $('#contextForm').reset(); renderTasks(); loadQuestions().catch(showWorkflowError); show('context');
}
function suggestedTitle(answers) { return (answers.subject || answers.change || answers.requirements || answers.error || answers.help || answers.focus || '').trim().slice(0, 120) || (state.mode === 'study' ? 'Study prompt' : state.mode === 'image' ? 'Image editing prompt' : 'Development prompt'); }
function setSavedState(saved) {
  $('#saveState').textContent = saved ? 'Saved to your library' : 'Unsaved changes';
  $('#whyText').textContent = saved ? 'Edits are recorded as a new prompt version.' : 'Save this prompt to keep it in your private library.';
  $('#saveButton').textContent = saved ? 'Save changes' : 'Save prompt';
}
function updateDirtyState() {
  if (!state.currentPromptId) { setSavedState(false); return; }
  const dirty = !state.detail || $('#promptTitle').value !== state.detail.prompt.title || $('#promptOutput').value !== state.detail.prompt.content;
  setSavedState(!dirty);
}
async function refreshDetail() {
  if (!state.currentPromptId) return;
  const data = await api(`/api/prompts/${state.currentPromptId}`); state.detail = data;
  const picker = $('#versionPicker'); picker.replaceChildren();
  for (const version of data.versions) {
    const option = document.createElement('option'); option.value = version.id;
    option.textContent = `Version ${version.version} · ${formatDate(version.createdAt)}`; picker.append(option);
  }
  $('#versionCount').textContent = `${data.versions.length} saved ${data.versions.length === 1 ? 'version' : 'versions'}`;
  $('#restoreVersionButton').disabled = true;
  const runList = $('#runHistory'); runList.replaceChildren();
  if (data.runs.length && state.mode !== 'study') {
    const heading = document.createElement('div'); heading.className = 'run-history-title'; heading.textContent = 'Recent AI runs'; runList.append(heading);
    for (const run of data.runs) {
      const item = document.createElement('details'); item.className = 'run-history-item';
      const summary = document.createElement('summary'); summary.textContent = `AI response · ${formatDate(run.createdAt)}`;
      const output = document.createElement('p'); output.textContent = run.response; item.append(summary, output); runList.append(item);
    }
  }
  updateDirtyState();
}
async function openPrompt(id) {
  try {
    const data = await api(`/api/prompts/${id}`); state.currentPromptId = id; state.detail = data;
    state.mode = data.prompt.mode; state.task = data.prompt.task;
    $('#promptTitle').value = data.prompt.title; $('#promptOutput').value = data.prompt.content;
    $('#backToContext').textContent = state.mode === 'general' ? '← Prompt studio' : '← Edit session details';
    $('#generationNotice').classList.add('hidden'); $('#generationNotice').textContent = '';
    $('#modePill').textContent = promptModeLabel(state.mode, state.task);
    $('#runButton').classList.toggle('hidden', state.mode === 'image' || state.mode === 'study' || state.mode === 'general');
    $('#openChatGPTButton').classList.toggle('hidden', state.mode !== 'general');
    if (state.mode === 'general') $('#openChatGPTButton').href = `https://chatgpt.com/?q=${encodeURIComponent(data.prompt.content)}`;
    setResultHeading(state.mode);
    $('#modelResult').classList.add('hidden'); $('#modelResponse').textContent = '';
    await refreshDetail(); show('result');
  } catch (error) { window.alert(error.message); }
}
async function savePrompt() {
  const content = $('#promptOutput').value.trim(); const title = $('#promptTitle').value.trim();
  if (!title || !content) throw new Error('Add a title and prompt text before saving.');
  const body = { title, content, mode: state.mode, task: state.task };
  const data = state.currentPromptId
    ? await api(`/api/prompts/${state.currentPromptId}`, body, 'PUT')
    : await api('/api/prompts', body, 'POST');
  state.currentPromptId = data.prompt.id; state.detail = { prompt: data.prompt, versions: [], runs: [] };
  await refreshDetail(); loadHome(); return data.prompt;
}
async function deletePrompt(prompt) {
  if (!window.confirm(`Delete “${prompt.title}” and its saved versions and runs?`)) return;
  try { await api(`/api/prompts/${prompt.id}`, null, 'DELETE'); if (state.currentPromptId === prompt.id) { state.currentPromptId = null; state.detail = null; show('choose'); } await loadHome(); }
  catch (error) { window.alert(error.message); }
}

$('#authSwitch').addEventListener('click', () => setAuthMode(state.authMode === 'login' ? 'register' : 'login'));
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault(); showAuthError();
  const submit = $('#authSubmit'); submit.disabled = true; submit.textContent = state.authMode === 'register' ? 'Creating account…' : 'Signing in…';
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  try { const data = await api(`/api/auth/${state.authMode}`, values); enterApp(data.user); }
  catch (error) { showAuthError(error.message); }
  finally { submit.disabled = false; submit.innerHTML = state.authMode === 'register' ? 'Create account <span>↗</span>' : 'Sign in <span>↗</span>'; }
});
$('#signOutButton').addEventListener('click', async () => { try { await api('/api/auth/logout', {}, 'POST'); } finally { leaveApp(); } });
$('#avatarEditButton').addEventListener('click', () => $('#avatarFileInput').click());
$('#avatarFileInput').addEventListener('change', event => { prepareAvatar(event.target.files?.[0]); event.target.value = ''; });
$('#studioNav').addEventListener('click', () => show('choose'));
$('#savedNav').addEventListener('click', () => { show('choose'); $('#savedHeading').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#searchInput').focus(); });
$('#extensionConnectButton').addEventListener('click', () => {
  $('#extensionDialogError').classList.add('hidden');
  $('#extensionTokenBlock').classList.add('hidden');
  $('#extensionDialog').showModal();
  refreshExtensionConnection();
});
$('#extensionDialog').addEventListener('close', () => {
  $('#extensionToken').value = '';
  $('#extensionTokenBlock').classList.add('hidden');
  $('#copyExtensionToken').textContent = 'Copy token';
});
$('#createExtensionTokenButton').addEventListener('click', async () => {
  const button = $('#createExtensionTokenButton'); button.disabled = true;
  $('#extensionDialogError').classList.add('hidden');
  try {
    const data = await api('/api/extension-token', {}, 'POST');
    $('#extensionToken').value = data.token;
    $('#extensionTokenBlock').classList.remove('hidden');
    $('#extensionConnectionStatus').textContent = `Connected · expires ${formatDate(data.expiresAt)}. Creating this token replaces any previous extension token.`;
    $('#revokeExtensionButton').classList.remove('hidden');
  } catch (error) { $('#extensionDialogError').textContent = error.message; $('#extensionDialogError').classList.remove('hidden'); }
  finally { button.disabled = false; }
});
$('#copyExtensionToken').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#extensionToken').value); $('#copyExtensionToken').textContent = 'Copied'; }
  catch { $('#extensionToken').select(); document.execCommand('copy'); $('#copyExtensionToken').textContent = 'Copied'; }
});
$('#revokeExtensionButton').addEventListener('click', async () => {
  const button = $('#revokeExtensionButton'); button.disabled = true;
  try {
    await api('/api/extension-token', {}, 'DELETE');
    $('#extensionTokenBlock').classList.add('hidden'); $('#extensionConnectionStatus').textContent = 'Extension connection revoked.';
    button.classList.add('hidden');
  } catch (error) { $('#extensionDialogError').textContent = error.message; $('#extensionDialogError').classList.remove('hidden'); }
  finally { button.disabled = false; }
});
$('#appBackButton').addEventListener('click', () => {
  if (history.length > 1) history.back();
  else if (state.currentView !== 'choose') show('choose');
});
$('#searchInput').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(loadHome, 180); });
$('#quickForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const request = $('#quickRequest').value.trim();
  if (!request) return;
  const button = $('#quickSubmit');
  const error = $('#quickError');
  const loading = $('#quickLoading');
  const loadingText = $('#quickLoadingText');
  error.textContent = ''; error.classList.add('hidden'); loading.classList.remove('hidden');
  button.disabled = true; button.textContent = 'Polishing prompt…';
  const slowMessage = setTimeout(() => { loadingText.textContent = 'Still working—please keep this page open.'; }, 5000);
  const longerMessage = setTimeout(() => { loadingText.textContent = 'The AI service is taking longer than usual. Promptly is still trying.'; }, 12000);
  try {
    const result = await api('/api/quick-prompt', { request });
    state.mode = 'general'; state.task = 'ask'; state.currentPromptId = result.prompt.id; state.detail = null;
    $('#promptTitle').value = result.prompt.title;
    $('#promptOutput').value = result.prompt.content;
    $('#backToContext').textContent = '← Prompt studio';
    $('#generationNotice').textContent = ''; $('#generationNotice').classList.add('hidden');
    $('#modePill').textContent = promptModeLabel('general', 'ask');
    $('#runButton').classList.add('hidden');
    const chatUrl = `https://chatgpt.com/?q=${encodeURIComponent(result.prompt.content)}`;
    $('#openChatGPTButton').href = chatUrl; $('#openChatGPTButton').classList.remove('hidden');
    setResultHeading('general');
    $('#modelResult').classList.add('hidden'); $('#modelResponse').textContent = '';
    await refreshDetail();
    show('result'); loadHome();
    window.location.assign(chatUrl);
  } catch (requestError) {
    error.textContent = requestError.status === 503
      ? 'Gemini is still busy after a few retries. Your request is here—wait a little and try again.'
      : requestError.message;
    error.classList.remove('hidden');
  } finally {
    clearTimeout(slowMessage); clearTimeout(longerMessage);
    loading.classList.add('hidden'); loadingText.textContent = 'Gemini is refining your request. This usually takes a few seconds.';
    button.disabled = false; button.innerHTML = 'Polish &amp; open ChatGPT <span>↗</span>';
  }
});
$('#contextForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()); state.answers = values;
  const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true; button.textContent = 'Thinking…';
  try {
    const result = await api('/api/prompt', { mode: state.mode, task: state.task, answers: values });
    state.currentPromptId = null; state.detail = null;
    $('#promptTitle').value = suggestedTitle(values); $('#promptOutput').value = result.prompt;
    const notice = $('#generationNotice');
    notice.textContent = result.source === 'template_fallback' ? 'Gemini is temporarily unavailable. This reusable prompt was assembled from your answers as a backup; no lesson or quiz answers were generated.' : '';
    notice.classList.toggle('hidden', !notice.textContent);
    $('#modelResult').classList.add('hidden'); $('#modePill').textContent = promptModeLabel(state.mode, state.task);
    $('#runButton').classList.toggle('hidden', state.mode === 'image' || state.mode === 'study');
    $('#openChatGPTButton').classList.add('hidden');
    setResultHeading(state.mode);
    $('#versionPicker').replaceChildren(); $('#runHistory').replaceChildren(); setSavedState(false); show('result');
  } catch (error) { showWorkflowError(error); }
  finally { button.disabled = false; button.innerHTML = 'Generate prompt <span>↗</span>'; }
});
$('#saveButton').addEventListener('click', async () => {
  const button = $('#saveButton'); button.disabled = true;
  try { await savePrompt(); }
  catch (error) { window.alert(error.message); }
  finally { button.disabled = false; }
});
$('#runButton').addEventListener('click', async () => {
  const button = $('#runButton'); button.disabled = true; button.textContent = 'Running…';
  $('#modelResult').classList.remove('hidden'); $('#modelResponse').textContent = 'Using your prompt to generate a response…';
  try {
    if (!state.currentPromptId || !state.detail || $('#promptTitle').value !== state.detail.prompt.title || $('#promptOutput').value !== state.detail.prompt.content) await savePrompt();
    const result = await api(`/api/prompts/${state.currentPromptId}/runs`, {}, 'POST');
    $('#modelResponse').textContent = result.response; $('#runModelLabel').textContent = '';
    await refreshDetail(); loadHome();
  } catch (error) { $('#modelResponse').textContent = error.message; }
  finally { button.disabled = false; button.textContent = state.mode === 'general' ? 'Run again ↗' : 'Try prompt with AI ↗'; }
});
$('#versionPicker').addEventListener('change', () => {
  const version = state.detail?.versions.find(item => String(item.id) === $('#versionPicker').value);
  if (!version) return;
  $('#promptOutput').value = version.content; $('#restoreVersionButton').disabled = false; updateDirtyState();
});
$('#restoreVersionButton').addEventListener('click', async () => {
  const versionId = $('#versionPicker').value; if (!state.currentPromptId || !versionId) return;
  try {
    await api(`/api/prompts/${state.currentPromptId}/versions/${versionId}`, {}, 'POST');
    await openPrompt(state.currentPromptId); loadHome();
  } catch (error) { window.alert(error.message); }
});
$('#promptTitle').addEventListener('input', updateDirtyState);
$('#promptOutput').addEventListener('input', updateDirtyState);
$('#clearResponse').addEventListener('click', () => { $('#modelResult').classList.add('hidden'); $('#modelResponse').textContent = ''; });
$('#backToModes').addEventListener('click', () => goBack('choose'));
$('#backToContext').addEventListener('click', () => goBack(state.mode === 'general' ? 'choose' : 'context'));
$('#copyButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('#promptOutput').value); } catch { $('#promptOutput').select(); document.execCommand('copy'); } });
$('#helpButton').addEventListener('click', () => window.alert('Write a rough request in Prompt studio. Promptly improves it, opens ChatGPT with the polished prompt, and saves it in your private library.'));
$('#year').textContent = new Date().getFullYear();
window.addEventListener('popstate', event => {
  if (!state.user) return;
  const next = Object.hasOwn(panels, event.state?.promptlyView) ? event.state.promptlyView : 'choose';
  show(next, { fromHistory: true });
});
setAuthMode('login');
api('/api/session').then(({ user }) => { if (user) enterApp(user); }).catch(() => { $('#authScreen').classList.remove('hidden'); });
