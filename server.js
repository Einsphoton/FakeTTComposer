'use strict';
/*
 * TT作曲家 Web 版 —— 零依赖服务端
 * 静态资源 + 账号系统 + 每个用户独立的工程存储
 *
 * 数据布局（DATA_DIR，默认 /data）：
 *   users.json              用户表（scrypt 加盐哈希）
 *   secret.key              会话签名密钥（首次启动生成）
 *   projects/<用户ID>/*.json 每个用户自己的作品
 */
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const MAX_BODY = 8 * 1024 * 1024; // 8MB，足够一份超长简谱

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const MIGRATE_MARKER = path.join(DATA_DIR, '.legacy-migrated');

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天
const COOKIE_NAME = 'tt_session';

// 可选的外层访问密码（AUTH_USER / AUTH_PASS），留空则不启用
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.mid': 'audio/midi',
};

let users = [];
let sessionSecret = '';

/* ================= 基础工具 ================= */
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function safeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

function userProjectsDir(uid) {
  return path.join(PROJECTS_DIR, uid);
}

async function atomicWrite(file, text, mode) {
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fsp.writeFile(tmp, text, { encoding: 'utf8', mode: mode || 0o644 });
  await fsp.rename(tmp, file);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJSONBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw Object.assign(new Error('JSON 解析失败'), { status: 400 });
  }
}

function sendJSON(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  }, headers || {}));
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

/* ================= 启动初始化 ================= */
async function initStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    users = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    users = [];
  }
  try {
    sessionSecret = (await fsp.readFile(SECRET_FILE, 'utf8')).trim();
  } catch (_) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    await atomicWrite(SECRET_FILE, sessionSecret, 0o600);
  }
  if (!sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    await atomicWrite(SECRET_FILE, sessionSecret, 0o600);
  }
}

/* ================= 密码与会话 ================= */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const calc = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return stored.length === calc.length && crypto.timingSafeEqual(stored, calc);
  } catch (_) {
    return false;
  }
}

function signPayload(payload) {
  return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function makeToken(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + SESSION_TTL, v: 1 })).toString('base64url');
  return payload + '.' + signPayload(payload);
}

function readToken(token) {
  if (!token || typeof token !== 'string') return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expect = signPayload(payload);
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !data.uid || !data.exp || data.exp < Date.now()) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) {
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    }
  });
  return out;
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  const data = readToken(token);
  if (!data) return null;
  return users.find((u) => u.id === data.uid) || null;
}

function sessionCookie(req, token, maxAgeSec) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function publicUser(u) {
  return { id: u.id, username: u.username, displayName: u.displayName || u.username, createdAt: u.createdAt };
}

/* ================= 用户存储（串行写入，避免并发覆盖） ================= */
let userWriteChain = Promise.resolve();
function withUserLock(fn) {
  const run = userWriteChain.then(fn, fn);
  userWriteChain = run.then(() => {}, () => {});
  return run;
}

async function persistUsers() {
  await atomicWrite(USERS_FILE, JSON.stringify(users, null, 2), 0o600);
}

function findUserByName(username) {
  const key = String(username || '').trim().toLowerCase();
  return users.find((u) => u.username.toLowerCase() === key) || null;
}

/* ================= 登录限流 ================= */
const failures = new Map();
const regCounts = new Map();

function clientIP(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || 'unknown';
}

function isBlocked(key) {
  const rec = failures.get(key);
  return !!(rec && rec.until > Date.now());
}

function noteFailure(key) {
  const rec = failures.get(key) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= 8) {
    rec.until = Date.now() + 5 * 60 * 1000;
    rec.n = 0;
  }
  failures.set(key, rec);
}

function clearFailures(key) {
  failures.delete(key);
}

function noteRegistration(ip) {
  const rec = regCounts.get(ip) || { n: 0, since: Date.now() };
  if (Date.now() - rec.since > 60 * 60 * 1000) {
    rec.n = 0;
    rec.since = Date.now();
  }
  rec.n += 1;
  regCounts.set(ip, rec);
  return rec.n <= 20; // 每个 IP 每小时最多注册 20 个
}

/* ================= 工程存储 ================= */
async function listProjects(uid) {
  const dir = userProjectsDir(uid);
  await fsp.mkdir(dir, { recursive: true });
  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json'));
  const items = [];
  for (const f of files) {
    const id = f.slice(0, -5);
    if (!safeId(id)) continue;
    try {
      const full = path.join(dir, f);
      const st = await fsp.stat(full);
      let title = id;
      let measures = 0;
      try {
        const doc = JSON.parse(await fsp.readFile(full, 'utf8'));
        title = (doc && doc.title) || id;
        measures = Array.isArray(doc && doc.measures) ? doc.measures.length : 0;
      } catch (_) { /* 文件损坏也列出来，避免用户以为丢了 */ }
      items.push({ id, title, measures, updated: st.mtimeMs, size: st.size });
    } catch (_) { /* ignore */ }
  }
  items.sort((a, b) => b.updated - a.updated);
  return items;
}

/** 把旧版本（无账号时代）留在 data 根目录的工程，交给第一个注册的用户 */
async function migrateLegacyProjects(uid) {
  try {
    await fsp.access(MIGRATE_MARKER);
    return 0;
  } catch (_) { /* 还没迁移过 */ }
  let moved = 0;
  try {
    const dir = userProjectsDir(uid);
    await fsp.mkdir(dir, { recursive: true });
    const files = (await fsp.readdir(DATA_DIR)).filter((f) => /^[A-Za-z0-9_-]{1,64}\.json$/.test(f) && f !== 'users.json');
    for (const f of files) {
      try {
        await fsp.rename(path.join(DATA_DIR, f), path.join(dir, f));
        moved++;
      } catch (_) { /* 单个失败不影响其它 */ }
    }
    await atomicWrite(MIGRATE_MARKER, new Date().toISOString());
  } catch (e) {
    log('旧工程迁移失败：', e.message);
  }
  if (moved) log(`已把 ${moved} 个旧工程迁移给第一个注册用户`);
  return moved;
}

/* ================= 账号接口 ================= */
const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{2,20}$/;

async function handleAuth(req, res, url, action) {
  const ip = clientIP(req);

  if (action === 'register' && req.method === 'POST') {
    if (!noteRegistration(ip)) return sendError(res, 429, '注册太频繁，请稍后再试');
    const body = await readJSONBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim().slice(0, 20);

    if (!USERNAME_RE.test(username)) {
      return sendError(res, 400, '用户名需 2-20 位，只能包含中文、字母、数字或下划线');
    }
    if (password.length < 6) return sendError(res, 400, '密码至少 6 位');
    if (password.length > 64) return sendError(res, 400, '密码太长了');
    if (findUserByName(username)) return sendError(res, 409, '这个用户名已经被注册了');

    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomBytes(8).toString('hex'),
      username,
      displayName: displayName || username,
      salt,
      hash,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const created = await withUserLock(async () => {
      if (findUserByName(username)) return null; // 并发下二次检查
      users.push(user);
      await persistUsers();
      return user;
    });
    if (!created) return sendError(res, 409, '这个用户名已经被注册了');

    await fsp.mkdir(userProjectsDir(user.id), { recursive: true });
    const migrated = await migrateLegacyProjects(user.id);
    log('新用户注册', username, migrated ? `(接管 ${migrated} 个旧工程)` : '');
    return sendJSON(res, 201, { user: publicUser(user), migrated }, {
      'Set-Cookie': sessionCookie(req, makeToken(user.id), SESSION_TTL / 1000),
    });
  }

  if (action === 'login' && req.method === 'POST') {
    const body = await readJSONBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const key = ip + '|' + username.toLowerCase();
    if (isBlocked(key)) return sendError(res, 429, '密码错误次数太多，请 5 分钟后再试');

    const user = findUserByName(username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      noteFailure(key);
      return sendError(res, 401, '用户名或密码不对');
    }
    clearFailures(key);
    return sendJSON(res, 200, { user: publicUser(user) }, {
      'Set-Cookie': sessionCookie(req, makeToken(user.id), SESSION_TTL / 1000),
    });
  }

  if (action === 'logout' && req.method === 'POST') {
    return sendJSON(res, 200, { ok: true }, {
      'Set-Cookie': sessionCookie(req, '', 0),
    });
  }

  if (action === 'me' && req.method === 'GET') {
    const user = currentUser(req);
    if (!user) return sendError(res, 401, '未登录');
    return sendJSON(res, 200, { user: publicUser(user) });
  }

  if (action === 'password' && req.method === 'POST') {
    const user = currentUser(req);
    if (!user) return sendError(res, 401, '请先登录');
    const body = await readJSONBody(req);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifyPassword(oldPassword, user.salt, user.hash)) return sendError(res, 400, '原密码不对');
    if (newPassword.length < 6) return sendError(res, 400, '新密码至少 6 位');
    const { salt, hash } = hashPassword(newPassword);
    await withUserLock(async () => {
      user.salt = salt;
      user.hash = hash;
      user.updatedAt = Date.now();
      await persistUsers();
    });
    return sendJSON(res, 200, { ok: true });
  }

  return sendError(res, 404, '接口不存在');
}

/* ================= 工程接口 ================= */
async function handleProjects(req, res, parts) {
  const user = currentUser(req);
  if (!user) return sendError(res, 401, '请先登录');

  const id = parts[2] ? safeId(parts[2]) : null;
  if (parts[2] && !id) return sendError(res, 400, '工程 ID 不合法');
  const dir = userProjectsDir(user.id);
  await fsp.mkdir(dir, { recursive: true });

  if (!id) {
    if (req.method === 'GET') return sendJSON(res, 200, { projects: await listProjects(user.id) });
    if (req.method === 'POST') {
      const doc = await readJSONBody(req);
      const newId = crypto.randomBytes(8).toString('hex');
      doc.id = newId;
      doc.owner = user.id;
      doc.updatedAt = Date.now();
      await atomicWrite(path.join(dir, newId + '.json'), JSON.stringify(doc, null, 2));
      log('新建工程', user.username, newId, doc.title || '(无标题)');
      return sendJSON(res, 201, { id: newId });
    }
    return sendError(res, 405, '不支持的方法');
  }

  const file = path.join(dir, id + '.json');

  if (req.method === 'GET') {
    try {
      const text = await fsp.readFile(file, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(text);
    } catch (_) {
      return sendError(res, 404, '工程不存在');
    }
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const doc = await readJSONBody(req);
    if (!doc || typeof doc !== 'object') return sendError(res, 400, '数据格式错误');
    try {
      await fsp.access(file);
    } catch (_) {
      return sendError(res, 404, '工程不存在');
    }
    doc.id = id;
    doc.owner = user.id;
    doc.updatedAt = Date.now();
    await atomicWrite(file, JSON.stringify(doc, null, 2));
    return sendJSON(res, 200, { ok: true, id, updatedAt: doc.updatedAt });
  }

  if (req.method === 'DELETE') {
    try {
      await fsp.unlink(file);
      log('删除工程', user.username, id);
      return sendJSON(res, 200, { ok: true });
    } catch (_) {
      return sendError(res, 404, '工程不存在');
    }
  }

  return sendError(res, 405, '不支持的方法');
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method;

  if (url.pathname === '/api/health') {
    return sendJSON(res, 200, { ok: true, app: 'ttcomposer', version: '1.1.0', users: users.length });
  }

  if (parts[1] === 'auth') {
    return handleAuth(req, res, url, parts[2]);
  }

  if (parts[1] === 'projects') {
    return handleProjects(req, res, parts);
  }

  return sendError(res, 404, '接口不存在');
}

/* ================= 静态资源 ================= */
async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) throw new Error('dir');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>页面不存在</p>');
  }
}

/* ================= 外层访问密码（可选） ================= */
function checkBasicAuth(req, res) {
  if (!AUTH_USER) return true;
  const hdr = req.headers.authorization || '';
  if (hdr.startsWith('Basic ')) {
    const raw = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const idx = raw.indexOf(':');
    if (idx > 0 && raw.slice(0, idx) === AUTH_USER && raw.slice(idx + 1) === AUTH_PASS) return true;
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="TT Composer", charset="UTF-8"',
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end('<h1>401 需要登录</h1>');
  return false;
}

/* ================= 服务 ================= */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch (_) {
    res.writeHead(400);
    return res.end('Bad Request');
  }

  try {
    // 健康检查不需要任何密码，方便容器 healthcheck
    if (url.pathname !== '/api/health' && !checkBasicAuth(req, res)) return;
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (e) {
    const status = e.status || 500;
    log('请求出错', req.method, url.pathname, e.message);
    if (!res.headersSent) sendError(res, status, e.message || '服务器内部错误');
    else res.end();
  }

  if (process.env.LOG_REQUESTS === '1') {
    log(req.method, url.pathname, res.statusCode, Date.now() - started + 'ms');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请换一个端口，例如：PORT=8090 node server.js，或在 docker-compose.yml 里改 "8090:8080"。`);
    process.exit(1);
  }
  console.error('服务启动失败：', err);
  process.exit(1);
});

initStorage().then(() => {
  server.listen(PORT, HOST, () => {
    log(`TT作曲家 Web 版已启动: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    log(`数据目录: ${DATA_DIR} · 已有用户 ${users.length} 个`);
  });
});

function shutdown(sig) {
  log('收到信号', sig, '正在关闭…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
