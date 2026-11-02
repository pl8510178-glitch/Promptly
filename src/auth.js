const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { db } = require('./database');

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'promptly_session';
const SESSION_DAYS = 14;
const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const sessionByHash = db.prepare(`
  SELECT users.id, users.name, users.email, users.created_at
  FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > ?
`);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex || !/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(header = '') {
  const values = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { values[key] = decodeURIComponent(value); } catch { values[key] = ''; }
  }
  return values;
}

function setSessionCookie(res, token, req) {
  const secure = req.socket.encrypted || (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https');
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res, req) {
  const secure = req.socket.encrypted || (process.env.TRUST_PROXY === 'true' && req.headers['x-forwarded-proto'] === 'https');
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

function issueSession(userId, res, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hashToken(token), userId, expires);
  setSessionCookie(res, token, req);
}

function getUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 128) return null;
  return sessionByHash.get(hashToken(token), new Date().toISOString()) || null;
}

function revokeSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token && token.length <= 128) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

module.exports = { hashPassword, verifyPassword, issueSession, getUser, revokeSession, clearSessionCookie };
