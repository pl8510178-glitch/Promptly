const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { db, databasePath } = require('./src/database');
const { hashPassword, verifyPassword, issueSession, getUser, revokeSession, clearSessionCookie } = require('./src/auth');

// Load a local .env file without adding a runtime dependency. Environment variables
// already provided by the host take precedence.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
}

const root = __dirname;
const publicRoot = path.join(root, 'public');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function json(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' }); res.end(JSON.stringify(data)); }
function readBody(req, limit = 100_000) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; let tooLarge = false; req.on('data', chunk => { if (tooLarge) return; size += chunk.length; if (size > limit) { tooLarge = true; chunks.length = 0; return; } chunks.push(chunk); }); req.on('end', () => { if (tooLarge) return reject(new Error('Request too large')); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); } }); req.on('error', reject); }); }
const avatarMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
function readAvatarData(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !avatarMimeTypes.has(match[1])) throw Object.assign(new Error('Choose a JPEG, PNG, or WebP photo.'), { status: 400 });
  const data = Buffer.from(match[2], 'base64');
  if (!data.length || data.length > 2 * 1024 * 1024) throw Object.assign(new Error('Profile photos must be 2 MB or smaller.'), { status: 413 });
  const validSignature = match[1] === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : match[1] === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  if (!validSignature) throw Object.assign(new Error('That file does not match its image type.'), { status: 400 });
  return { mimeType: match[1], data };
}
function getQuestions(mode, task) {
  if (mode === 'image') return task === 'create' ? [
    { key: 'subject', label: 'What should the image show?', placeholder: 'Describe the main subject and key details' },
    { key: 'purpose', label: 'Where will you use it?', placeholder: 'e.g. social post, presentation, product page' },
    { key: 'style', label: 'What visual style do you want?', placeholder: 'e.g. clean editorial, watercolor, cinematic' },
    { key: 'composition', label: 'What should the composition look like?', placeholder: 'Framing, layout, lighting, or color palette' },
    { key: 'tool', label: 'Which image tool will you use?', placeholder: 'e.g. Photoshop, Gemini, Midjourney, or another tool' }
  ] : [
    { key: 'change', label: 'What do you want to change?', placeholder: 'Describe the edit you want in plain language' },
    { key: 'imageContext', label: 'What is in the current image?', placeholder: 'Mention the subject and details the editor should recognize' },
    { key: 'preserve', label: 'What must stay unchanged?', placeholder: 'Identity, expression, text, logo, framing, or other details' },
    { key: 'style', label: 'What should the result look or feel like?', placeholder: 'Lighting, colors, style, realism, or mood' },
    { key: 'tool', label: 'Which image editor will you use?', placeholder: 'e.g. Photoshop, Gemini, Midjourney, or another tool' }
  ];
  if (mode === 'study') return [
    { key: 'subject', label: 'What subject or topic?', placeholder: 'e.g. photosynthesis, calculus, history' },
    { key: 'level', label: 'What level are you studying at?', placeholder: 'e.g. high school, first-year university' },
    { key: 'help', label: 'What kind of help would be useful?', placeholder: 'e.g. explain simply, give hints, quiz me' },
    { key: 'format', label: 'Any format or length preference?', placeholder: 'e.g. step-by-step, brief notes, 5 questions' }
  ];
  const codeTasks = {
    debug: [ { key: 'language', label: 'What language, framework, and version?', placeholder: 'e.g. Python 3.12, React 19' }, { key: 'error', label: 'What is the error or unexpected behavior?', placeholder: 'Paste the exact error or describe what happens' }, { key: 'expected', label: 'What did you expect to happen?', placeholder: 'Describe the intended behavior' }, { key: 'context', label: 'What have you tried? Add relevant code or context.', placeholder: 'Include the smallest useful code snippet' } ],
    build: [ { key: 'language', label: 'What language, framework, and version?', placeholder: 'e.g. TypeScript, Next.js 15' }, { key: 'requirements', label: 'What should the feature do?', placeholder: 'Describe the behavior and expected result' }, { key: 'context', label: 'What codebase or API context matters?', placeholder: 'Relevant files, interfaces, existing patterns' }, { key: 'constraints', label: 'Any constraints or conventions?', placeholder: 'Performance, compatibility, style, tests' } ],
    review: [ { key: 'language', label: 'What language and framework?', placeholder: 'e.g. Go, Django, React' }, { key: 'code', label: 'Paste the code to review.', placeholder: 'Paste the smallest relevant snippet' }, { key: 'focus', label: 'What should the review prioritize?', placeholder: 'Bugs, security, performance, readability' }, { key: 'constraints', label: 'Any project conventions or constraints?', placeholder: 'Versions, patterns, compatibility' } ]
  };
  return codeTasks[task] || codeTasks.debug;
}
function buildPrompt(mode, task, a) {
  if (mode === 'image' && task === 'create') return [
    'Create a new image from the following brief.',
    `Subject and key details: ${a.subject || '[describe the subject]'}`,
    `Purpose and audience: ${a.purpose || '[state where this image will be used]'}`,
    `Visual style and mood: ${a.style || '[describe a style or mood]'}`,
    `Composition, framing, and lighting: ${a.composition || '[describe layout, framing, or lighting]'}`,
    `Target image tool: ${a.tool || '[name the image generator or editor]'}`,
    'Produce a visually coherent result. Respect the requested subject, style, composition, and intended use. Do not add text, logos, or extra objects unless requested. If an essential detail is missing, state a concise placeholder rather than inventing a specific fact.'
  ].join('\n\n');
  if (mode === 'image') return [
    'Edit an existing image according to the user’s instructions.',
    `Current image and visible subject: ${a.imageContext || '[briefly describe the existing image]'}`,
    `Requested changes: ${a.change || '[describe the exact changes to make]'}`,
    `Details to preserve: ${a.preserve || '[state what must remain unchanged]'}`,
    `Desired visual treatment: ${a.style || '[describe style, color, lighting, or mood]'}`,
    `Target image editor: ${a.tool || '[name the image editor or model]'}`,
    'Make only the requested changes. Preserve the identity, facial features, pose, composition, text, and other details the user marked as unchanged. Blend edits naturally with the original image’s perspective, lighting, shadows, and texture. Do not add unrequested objects, words, logos, or visual changes.'
  ].join('\n\n');
  if (mode === 'study') return [
    'Write a reusable study prompt for another AI assistant. Do not explain the topic or write the quiz yourself; turn the learner’s request into clear instructions the other AI can follow.',
    `Task: ${task === 'practice' ? 'create practice questions' : task === 'feedback' ? 'give feedback on the supplied work' : 'explain the topic'}`,
    `Topic: ${a.subject || '[add topic]'}`,
    `My level: ${a.level || '[add level]'}`,
    `I need: ${a.help || '[describe the explanation, practice, or feedback needed]'}`,
    a.format && `Preferred format and order: ${a.format}`,
    'Ask the other AI to keep the response concise and follow the requested format. If both a brief description and a quiz are requested, instruct it to give the description first and make the quiz the final section. Do not request an answer key unless the learner asks for one. Tell it not to start with a greeting or preliminary questions.'
  ].filter(Boolean).join('\n\n');
  if (task === 'debug') return [ 'Act as a careful debugging partner. Diagnose the issue before proposing a fix.', `Stack and versions: ${a.language || '[add language/framework/version]'}`, `Unexpected behavior or error: ${a.error || '[paste exact error or describe behavior]'}`, `Expected behavior: ${a.expected || '[describe expected behavior]'}`, `Code and investigation so far: ${a.context || '[add relevant code and what you tried]'}`, 'Explain the likely root cause, state assumptions, and give the smallest safe fix. Ask for missing information rather than inventing codebase details.' ].join('\n\n');
  if (task === 'review') return [ 'Review the supplied code as a constructive senior engineer.', `Stack: ${a.language || '[add language/framework]'}`, `Code: ${a.code || '[paste code]'}`, `Review focus: ${a.focus || '[bugs, security, performance, readability]'}`, `Project conventions: ${a.constraints || '[add constraints or conventions]'}`, 'Prioritize actionable findings by severity. For each finding, point to the relevant code, explain the impact, and suggest a concrete fix. Separate confirmed issues from questions or assumptions. If you find no issue in a category, say so briefly.' ].join('\n\n');
  return [ 'Act as a software engineering partner. Help implement the requested change in the existing codebase.', `Stack and versions: ${a.language || '[add language/framework/version]'}`, `Requirements: ${a.requirements || '[describe the feature and expected behavior]'}`, `Relevant codebase context: ${a.context || '[add files, APIs, interfaces, and existing patterns]'}`, `Constraints: ${a.constraints || '[add compatibility, performance, style, or testing constraints]'}`, 'First summarize your understanding and flag missing decisions. Then propose a focused implementation that follows the existing patterns. Explain key changes and include relevant checks or tests; do not invent APIs that were not provided.' ].join('\n\n');
}
function basicStudyPrompt(a, task) {
  return [
    'You are a clear, supportive study tutor. Create study material from the details below.',
    `Task: ${task === 'practice' ? 'practice questions' : task === 'feedback' ? 'feedback' : 'explain the topic'}`,
    `Topic: ${a.subject || '[add topic]'}`,
    `Learner level: ${a.level || '[add level]'}`,
    `What I need: ${a.help || '[describe the help needed]'}`,
    `Preferred format: ${a.format || 'Keep it brief. Give a short description first, followed by a quiz as the final section.'}`,
    'Follow the requested length and format. If both an explanation and a quiz are requested, put the quiz last. Do not begin with a greeting or ask preliminary questions.'
  ].join('\n\n');
}
function modelText(data) {
  const text = (data.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  return text;
}
function aiProvider() { return (process.env.AI_PROVIDER || 'openai').trim().toLowerCase(); }
function aiModel() { return process.env[aiProvider() === 'gemini' ? 'GEMINI_MODEL' : 'OPENAI_MODEL'] || (aiProvider() === 'gemini' ? 'gemini-3.1-pro-preview' : 'gpt-6-astra'); }
function aiKey() { return process.env[aiProvider() === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY']; }
async function askModel(instructions, input) {
  const provider = aiProvider();
  if (!['openai', 'gemini'].includes(provider)) throw new Error('AI_PROVIDER must be either "openai" or "gemini" in .env.');
  const apiKey = aiKey();
  if (!apiKey) throw new Error(`AI is not configured yet. Add ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} to your .env file, then restart Promptly.`);
  const model = aiModel();
  const endpoint = provider === 'gemini'
    ? (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
    : (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/responses');
  const payload = provider === 'gemini'
    ? { model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }] }
    : { model, instructions, input, store: false };
  let response;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000)
      });
    } catch (error) {
      const service = provider === 'gemini' ? 'Gemini' : 'OpenAI';
      const code = error?.cause?.code || error?.code;
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        throw new Error(`Could not resolve the ${service} API address (${code}). Check DNS or your network, then restart Promptly.`);
      }
      if (code === 'ETIMEDOUT' || error?.name === 'TimeoutError') {
        throw new Error(`The connection to the ${service} API timed out. Check your network or firewall, then try again.`);
      }
      if (code) {
        throw new Error(`Could not connect to the ${service} API (${code}). Check your network or firewall, then try again.`);
      }
      throw new Error(`Could not reach the ${service} API${error?.message ? `: ${error.message}` : ''}. Check the server internet connection and try again.`);
    }
    if (response.status !== 503 || attempt === 3) break;
    await new Promise(resolve => setTimeout(resolve, 800 * (2 ** attempt) + Math.random() * 300));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `Model request failed (${response.status}).`;
    if ([401, 403].includes(response.status)) throw new Error(`${provider === 'gemini' ? 'Gemini' : 'OpenAI'} rejected the API key. Check the provider key in .env.`);
    if (response.status === 503) throw Object.assign(new Error(`${provider === 'gemini' ? 'Gemini' : 'AI'} is temporarily unavailable or overloaded (503). This is a service issue, not an API-key or quota error. Wait briefly and try again.`), { status: 503 });
    if (response.status === 429) {
      if (provider === 'gemini') {
        const cause = /quota|billing|spend|resource_exhausted|exhausted/i.test(message) ? 'quota or billing limit' : 'request or token rate limit';
        throw new Error(`Gemini hit a ${cause}. Check AI Studio → Rate limits for the Google project linked to this key. For a temporary rate limit, wait and retry; if the free quota is exhausted, wait for its reset. ${message}`);
      }
      throw new Error(`OpenAI API quota or rate limit reached. Check the API project's usage and limits. ${message}`);
    }
    throw new Error(message);
  }
  const text = provider === 'gemini'
    ? String(data.choices?.[0]?.message?.content || '').trim()
    : modelText(data);
  if (!text) throw new Error('The model returned an empty response. Please try again.');
  return text;
}
function userView(row) { return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at }; }
function promptView(row) {
  return { id: row.id, title: row.title, mode: row.mode, task: row.task, content: row.current_text,
    preview: row.current_text.slice(0, 180), createdAt: row.created_at, updatedAt: row.updated_at,
    versionCount: row.version_count ?? 0, runCount: row.run_count ?? 0 };
}
function parseId(raw) { const id = Number(raw); return Number.isSafeInteger(id) && id > 0 ? id : null; }
function getOwnedPrompt(id, userId) {
  return db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(id, userId) || null;
}
function validatePromptInput(body, partial = false) {
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) return 'Title must be 1–120 characters.';
  }
  if (!partial || body.content !== undefined) {
    if (typeof body.content !== 'string' || !body.content.trim() || body.content.length > 20000) return 'Prompt must be 1–20,000 characters.';
  }
  if (!partial || body.mode !== undefined) if (!['study', 'code', 'image', 'general'].includes(body.mode)) return 'Choose a valid prompt workspace.';
  if (!partial || body.task !== undefined) {
    const tasks = body.mode === 'study' ? ['explain', 'practice', 'feedback'] : body.mode === 'image' ? ['edit', 'create'] : body.mode === 'general' ? ['ask'] : ['debug', 'build', 'review'];
    if (!tasks.includes(body.task)) return 'Choose a valid task for this workspace.';
  }
  return null;
}
function addPromptVersion(promptId, content) {
  const last = db.prepare('SELECT COALESCE(MAX(version_number), 0) AS version FROM prompt_versions WHERE prompt_id = ?').get(promptId).version;
  return db.prepare('INSERT INTO prompt_versions (prompt_id, version_number, content) VALUES (?, ?, ?)').run(promptId, last + 1, content).lastInsertRowid;
}
const authAttempts = new Map();
function rateLimited(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (authAttempts.get(key) || []).filter(time => now - time < 15 * 60_000);
  if (recent.length >= 12) { authAttempts.set(key, recent); return true; }
  recent.push(now); authAttempts.set(key, recent); return false;
}
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
function extensionCors(req, res, methods = 'POST, OPTIONS') {
  const allowed = process.env.PROMPTLY_EXTENSION_ORIGIN;
  if (!allowed || req.headers.origin !== allowed) return false;
  res.setHeader('access-control-allow-origin', allowed);
  res.setHeader('access-control-allow-methods', methods);
  res.setHeader('access-control-allow-headers', 'Authorization, Content-Type');
  res.setHeader('access-control-max-age', '600');
  res.setHeader('vary', 'Origin');
  return true;
}
function hashExtensionToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
const extensionAttempts = new Map();
function extensionRateLimited(userId) {
  const now = Date.now();
  const recent = (extensionAttempts.get(userId) || []).filter(time => now - time < 60_000);
  if (recent.length >= 20) { extensionAttempts.set(userId, recent); return true; }
  recent.push(now); extensionAttempts.set(userId, recent); return false;
}
function apiError(res, error) {
  const status = error.status || (error.name === 'TimeoutError' ? 504 : 500);
  return json(res, status, { error: error.message || 'The request could not be completed.' });
}
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, app: 'Promptly', version: '1.0.0', database: 'sqlite', aiConfigured: Boolean(aiKey()) });
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      const user = getUser(req);
      return json(res, 200, { user: user ? userView(user) : null });
    }
    if (url.pathname === '/api/extension/refine' || url.pathname === '/api/extension/status') {
      const isStatus = url.pathname.endsWith('/status');
      if (!extensionCors(req, res, isStatus ? 'GET, OPTIONS' : 'POST, OPTIONS')) return json(res, 403, { error: 'This browser extension is not allowed to connect. Check PROMPTLY_EXTENSION_ORIGIN.' });
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (req.method !== (isStatus ? 'GET' : 'POST')) return json(res, 405, { error: 'Method not allowed.' });
      const bearer = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1];
      const user = bearer && db.prepare(`SELECT users.id, users.name, users.email FROM extension_tokens JOIN users ON users.id = extension_tokens.user_id WHERE extension_tokens.token_hash = ? AND extension_tokens.expires_at > ?`).get(hashExtensionToken(bearer), new Date().toISOString());
      if (!user) return json(res, 401, { error: 'Extension connection expired or revoked. Reconnect it from Promptly.' });
      if (isStatus) return json(res, 200, { connected: true, name: user.name });
      if (extensionRateLimited(user.id)) return json(res, 429, { error: 'Promptly extension is being used too quickly. Wait a minute and try again.' });
      const body = await readBody(req);
      const roughRequest = typeof body.request === 'string' ? body.request.trim() : '';
      if (!roughRequest) return json(res, 400, { error: 'Enter a rough prompt first.' });
      if (roughRequest.length > 10000) return json(res, 413, { error: 'Keep your request under 10,000 characters.' });
      const instructions = [
        'You are Promptly, an AI prompt improver. The user has supplied a rough request that will be sent to another AI afterward.',
        'Silently rewrite it as a clear, specific prompt that preserves the user’s intent. Add useful structure and ask for missing details only when essential; do not invent facts, context, or capabilities.',
        'For learning requests, preserve the requested format and order. For software requests, ask for relevant code or errors when needed and do not invent details about an unseen codebase. For image editing, describe desired edits and what should remain unchanged.',
        'Do not answer the request. Return only the final polished prompt with no preamble, labels, quotation marks, or answer.'
      ].join('\n');
      const prompt = (await askModel(instructions, roughRequest)).trim();
      if (!prompt) throw Object.assign(new Error('The AI returned an empty prompt. Please try again.'), { status: 502 });
      if (prompt.length > 20000) throw Object.assign(new Error('The improved prompt is too long. Please shorten your request and try again.'), { status: 413 });
      return json(res, 200, { prompt });
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/auth/')) {
      if (!originAllowed(req)) return json(res, 403, { error: 'Request origin is not allowed.' });
      if (rateLimited(req)) return json(res, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });
      const body = await readBody(req);
      if (url.pathname === '/api/auth/register') {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        if (name.length < 2 || name.length > 80) return json(res, 400, { error: 'Name must be between 2 and 80 characters.' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json(res, 400, { error: 'Enter a valid email address.' });
        if (password.length < 10 || password.length > 128) return json(res, 400, { error: 'Password must be 10–128 characters.' });
        const passwordHash = await hashPassword(password);
        try {
          const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(name, email, passwordHash);
          issueSession(Number(result.lastInsertRowid), res, req);
          return json(res, 201, { user: userView(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(result.lastInsertRowid))) });
        } catch (error) {
          if (String(error.message).includes('UNIQUE constraint failed: users.email')) return json(res, 409, { error: 'An account with this email already exists.' });
          throw error;
        }
      }
      if (url.pathname === '/api/auth/login') {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        const password = typeof body.password === 'string' ? body.password : '';
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user || !(await verifyPassword(password, user.password_hash))) return json(res, 401, { error: 'Email or password is incorrect.' });
        issueSession(user.id, res, req);
        return json(res, 200, { user: userView(user) });
      }
      if (url.pathname === '/api/auth/logout') {
        revokeSession(req); clearSessionCookie(res, req); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Not found.' });
    }

    const user = getUser(req);
    if (url.pathname.startsWith('/api/') && !user) return json(res, 401, { error: 'Sign in to continue.' });
    if (req.method !== 'GET' && url.pathname.startsWith('/api/') && !originAllowed(req)) return json(res, 403, { error: 'Request origin is not allowed.' });

    if (url.pathname === '/api/extension-token') {
      if (req.method === 'GET') {
        const connection = db.prepare('SELECT expires_at AS expiresAt FROM extension_tokens WHERE user_id = ? AND expires_at > ?').get(user.id, new Date().toISOString());
        return json(res, 200, { connected: Boolean(connection), expiresAt: connection?.expiresAt || null });
      }
      if (req.method === 'POST') {
        const token = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
        db.prepare(`INSERT INTO extension_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at, created_at=excluded.created_at`).run(user.id, hashExtensionToken(token), expiresAt);
        return json(res, 201, { token, expiresAt });
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM extension_tokens WHERE user_id = ?').run(user.id);
        return json(res, 200, { connected: false });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/questions') {
      const body = await readBody(req);
      if (!['study', 'code', 'image'].includes(body.mode)) return json(res, 400, { error: 'Choose a valid prompt workspace.' });
      return json(res, 200, { questions: getQuestions(body.mode, body.task) });
    }
    if (url.pathname === '/api/profile/avatar' && req.method === 'GET') {
      const avatar = db.prepare('SELECT mime_type, image_data FROM user_avatars WHERE user_id = ?').get(user.id);
      if (!avatar) return json(res, 404, { error: 'No profile photo has been set.' });
      res.writeHead(200, { 'content-type': avatar.mime_type, 'content-length': avatar.image_data.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' });
      return res.end(avatar.image_data);
    }
    if (url.pathname === '/api/profile/avatar' && req.method === 'PUT') {
      const body = await readBody(req, 3_000_000);
      const { mimeType, data } = readAvatarData(body.image);
      db.prepare(`INSERT INTO user_avatars (user_id, mime_type, image_data, updated_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET mime_type=excluded.mime_type, image_data=excluded.image_data, updated_at=excluded.updated_at`).run(user.id, mimeType, data);
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/profile/avatar' && req.method === 'DELETE') {
      db.prepare('DELETE FROM user_avatars WHERE user_id = ?').run(user.id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/prompt') {
      const body = await readBody(req);
      if (!['study', 'code', 'image'].includes(body.mode)) return json(res, 400, { error: 'Choose a valid prompt workspace.' });
      const draft = buildPrompt(body.mode, body.task, body.answers || {});
      if (draft.length > 20000) return json(res, 413, { error: 'Your context is too long. Please shorten it and try again.' });
      const instructions = body.mode === 'image'
        ? 'You are Promptly, an image-prompt coach. Turn the supplied image brief into a concise, specific, ready-to-paste instruction for the named image editor. Preserve the user’s requested changes and constraints. For edits, clearly separate what to change from what must remain unchanged, and describe natural integration with perspective, lighting, shadows, and texture. Do not claim to edit or inspect an image; the user supplied a written description only. Do not invent missing details. Output only the final image prompt.'
        : 'You are Promptly, a prompt coach for students and software engineers. Turn the supplied draft into a clear, useful, copyable prompt that preserves the user’s intent. Output instructions for another AI to follow; never answer the topic or produce the requested lesson/quiz yourself. Ask concise clarifying questions inside the prompt only when essential information is missing; otherwise use placeholders. For study requests, preserve the requested length and order. If both a brief explanation and quiz are requested, the prompt must ask for the explanation first and the quiz as the final section; avoid greetings and preliminary questions. For students, encourage learning and original work. For engineers, avoid inventing codebase details and request evidence when needed. Output only the final prompt, with no preamble.';
      try {
        const prompt = await askModel(instructions, draft);
        return json(res, 200, { prompt, source: 'ai' });
      } catch (error) {
        if (body.mode === 'study' && error.status === 503) {
          return json(res, 200, { prompt: basicStudyPrompt(body.answers || {}, body.task), source: 'template_fallback' });
        }
        throw error;
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/quick-prompt') {
      const body = await readBody(req);
      const roughRequest = typeof body.request === 'string' ? body.request.trim() : '';
      if (!roughRequest) return json(res, 400, { error: 'Type what you need help with first.' });
      if (roughRequest.length > 10000) return json(res, 413, { error: 'Keep your request under 10,000 characters.' });
      const instructions = [
        'You are Promptly, an AI prompt improver. The user has supplied a rough request that will be sent to ChatGPT afterward.',
        'First silently rewrite it as a clear, specific prompt that preserves the user’s intent. Add useful structure and ask for missing details only when essential; do not invent facts, context, or capabilities.',
        'For learning requests, preserve the learner’s requested format and order. For software requests, ask for relevant code or errors when needed and do not invent details about an unseen codebase. For image editing requests, describe the desired edits and what should remain unchanged.',
        'Do not answer or perform the user’s request. Do not mention that you are improving a prompt. Return only the final, polished prompt, with no preamble, labels, quotation marks, or answer.'
      ].join('\n');
      const prompt = (await askModel(instructions, roughRequest)).trim();
      if (!prompt) throw Object.assign(new Error('The AI returned an empty prompt. Please try again.'), { status: 502 });
      if (prompt.length > 20000) throw Object.assign(new Error('The improved prompt is too long to save. Please shorten your request and try again.'), { status: 413 });
      const title = roughRequest.replace(/\s+/g, ' ').slice(0, 116).trim() || 'Quick AI request';
      db.exec('BEGIN IMMEDIATE');
      try {
        const created = db.prepare('INSERT INTO prompts (user_id, title, mode, task, current_text) VALUES (?, ?, ?, ?, ?)').run(user.id, title, 'general', 'ask', prompt);
        const promptId = Number(created.lastInsertRowid);
        addPromptVersion(promptId, prompt);
        const saved = getOwnedPrompt(promptId, user.id);
        db.exec('COMMIT');
        return json(res, 200, { prompt: promptView(saved) });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    if (req.method === 'GET' && url.pathname === '/api/prompts') {
      const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
      const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
      const rows = db.prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM prompt_versions v WHERE v.prompt_id=p.id) AS version_count,
          (SELECT COUNT(*) FROM prompt_runs r WHERE r.prompt_id=p.id) AS run_count
        FROM prompts p WHERE p.user_id = ? AND (? = '' OR p.title LIKE ? ESCAPE '\\' OR p.current_text LIKE ? ESCAPE '\\')
        ORDER BY p.updated_at DESC LIMIT 100
      `).all(user.id, search, like, like);
      return json(res, 200, { prompts: rows.map(promptView) });
    }
    if (req.method === 'POST' && url.pathname === '/api/prompts') {
      const body = await readBody(req);
      const problem = validatePromptInput(body);
      if (problem) return json(res, 400, { error: problem });
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('INSERT INTO prompts (user_id, title, mode, task, current_text) VALUES (?, ?, ?, ?, ?)').run(user.id, body.title.trim(), body.mode, body.task, body.content.trim());
        const id = Number(result.lastInsertRowid);
        addPromptVersion(id, body.content.trim());
        db.exec('COMMIT');
        return json(res, 201, { prompt: promptView(getOwnedPrompt(id, user.id)) });
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }

    const promptRoute = url.pathname.match(/^\/api\/prompts\/(\d+)(?:\/(versions|runs)(?:\/(\d+))?)?$/);
    if (promptRoute) {
      const id = parseId(promptRoute[1]);
      const prompt = id && getOwnedPrompt(id, user.id);
      if (!prompt) return json(res, 404, { error: 'Prompt not found.' });
      const child = promptRoute[2];
      const childId = promptRoute[3] ? parseId(promptRoute[3]) : null;
      if (req.method === 'GET' && !child) {
        const versions = db.prepare('SELECT id, version_number AS version, content, created_at AS createdAt FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC').all(id);
        const runs = db.prepare('SELECT id, version_id AS versionId, response_text AS response, created_at AS createdAt FROM prompt_runs WHERE prompt_id = ? ORDER BY id DESC LIMIT 20').all(id);
        return json(res, 200, { prompt: promptView(prompt), versions, runs });
      }
      if (req.method === 'PUT' && !child) {
        const body = await readBody(req);
        const next = { title: body.title ?? prompt.title, content: body.content ?? prompt.current_text, mode: prompt.mode, task: prompt.task };
        const problem = validatePromptInput(next, true);
        if (problem) return json(res, 400, { error: problem });
        db.exec('BEGIN IMMEDIATE');
        try {
          if (next.content !== prompt.current_text) addPromptVersion(id, next.content.trim());
          db.prepare(`UPDATE prompts SET title = ?, current_text = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?`).run(next.title.trim(), next.content.trim(), id, user.id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { prompt: promptView(getOwnedPrompt(id, user.id)) });
      }
      if (req.method === 'DELETE' && !child) {
        db.prepare('DELETE FROM prompts WHERE id = ? AND user_id = ?').run(id, user.id);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && child === 'versions' && !childId) {
        const versions = db.prepare('SELECT id, version_number AS version, content, created_at AS createdAt FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC').all(id);
        return json(res, 200, { versions });
      }
      if (req.method === 'POST' && child === 'versions' && childId) {
        const version = db.prepare('SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?').get(childId, id);
        if (!version) return json(res, 404, { error: 'Prompt version not found.' });
        db.exec('BEGIN IMMEDIATE');
        try {
          addPromptVersion(id, version.content);
          db.prepare(`UPDATE prompts SET current_text = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(version.content, id);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return json(res, 200, { prompt: promptView(getOwnedPrompt(id, user.id)) });
      }
      if (req.method === 'POST' && child === 'runs' && !childId) {
        const currentVersion = db.prepare('SELECT id FROM prompt_versions WHERE prompt_id = ? ORDER BY version_number DESC LIMIT 1').get(id);
        const response = await askModel('Follow the user’s prompt helpfully and accurately. Be transparent about uncertainty. For study tasks, support learning rather than completing graded work for the student.', prompt.current_text);
        db.prepare('INSERT INTO prompt_runs (prompt_id, version_id, model, response_text) VALUES (?, ?, ?, ?)').run(id, currentVersion?.id || null, `${aiProvider()}/${aiModel()}`, response);
        db.prepare(`UPDATE prompts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(id);
        return json(res, 200, { response });
      }
      if (req.method === 'DELETE' && child === 'runs' && childId) {
        const result = db.prepare('DELETE FROM prompt_runs WHERE id = ? AND prompt_id = ?').run(childId, id);
        if (!result.changes) return json(res, 404, { error: 'Saved run not found.' });
        return json(res, 200, { ok: true });
      }
    }

    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.resolve(publicRoot, `.${requested}`);
    if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'", 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    if (error.message === 'Request too large') return json(res, 413, { error: error.message });
    console.error('Promptly request failed:', error.message);
    return apiError(res, error);
  }
});
const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Promptly is ready at http://localhost:${port}`));
