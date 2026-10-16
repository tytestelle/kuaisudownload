// main.js — UpdateService.ts 的 Node/Electron 移植
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const { Agent, request } = require('undici');
const {
  createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync,
} = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { join, dirname } = require('node:path');
const { URL } = require('node:url');

// =========================================================================
// ---- src/shared/update.ts 常量，照抄 ----
// =========================================================================
const GH_ACCEL_PREFIXES = [
  'https://gh-proxy.org/',
  'https://gh.acmsz.top/',
  'https://xsadwsd.kdns.fr/',
  'https://ghpxy.hwinzniej.top/',
  'https://js.jiangss.shop/',
  'https://cfgh.ikgy.top/',
  'https://gh.meali.top/',
  'https://gg.z321.cc.cd/',
  'https://fastgit.cc/',
  'https://777.z321.cc.cd/',
  'https://github.mxw.qzz.io/',
  'https://gh.ddlc.top/',
  'https://gh.chjina.com/',
  'https://ghf.无名氏.top/',
  'https://ghproxy.cxkpro.top/',
  'https://gh.idayer.com/',
  'https://githubdog.com/',
  'https://git.yylx.win/',
  'https://ghproxy.imciel.com/',
  'https://ghm.078465.xyz/',
  'https://gitproxy.mrhjx.cn/',
  'https://gh.monlor.com/',
  'https://github.geekery.cn/',
  'https://github.ednovas.xyz/',
  'https://ghproxy.felicity.land/',
  'https://down.mxw.xx.kg/',
  'https://gh.qfmc0721.cc.cd/',
  'https://github.xxlab.tech/',
  'https://gh.jjj.gv.uy/',
  'https://gh.felicity.ac.cn/',
  'https://jiashu.1win.eu.org/',
  'https://github.tbap.top/',
  'https://gh.my-website.ccwu.cc/',
  'https://cdn.akaere.online/',
  'https://gh-proxy.com/',
  'https://tvv.tw/',
  'https://gh.07150721.xyz/',
  'https://github.dpik.top/',
  'https://g.blfrp.cn/',
  'https://gh.dpik.top/',
  'https://gh.sixyin.com/',
  'https://ghproxy.net/',
  'https://gh.noki.icu/',
  'https://ghfast.top/',
  'https://gh.catmak.name/',
  'https://github.ikgy.top/',
  'https://gh.inkchills.cn/',
  'https://git.669966.xyz/',
  'https://ghproxy.monkeyray.net/',
  'https://ghfile.geekertao.top/',
  'https://cdn.gh-proxy.com/',
  'https://j.1lin.dpdns.org/',
  'https://github.starrlzy.cn/',
  'https://github-proxy.memory-echoes.cn/',
  'https://gh.927223.xyz/',
  'https://gh.bugdey.us.kg/',
  'https://j.1win.ggff.net/',
  'https://gitproxy.127731.xyz/',
  'https://gh.b52m.cn/',
  'https://down.mxw.qzz.io/',
  'https://slink.ltd/',
  'https://github.tmby.shop/',
  'https://ghpr.cc/',
  'https://gh.tryxd.cn/',
  'https://gitproxy.click/',
  'https://github.chenc.dev/',
  'https://gh.jasonzeng.dev/',
  'https://gp.zkitefly.eu.org/',
  'https://ghproxy.1888866.xyz/',
  'https://ghp.arslantu.xyz/',
  'https://free.cn.eu.org/',
  'https://ghp.keleyaa.com/',
  'https://proxy.yaoyaoling.net/',
  'https://g.z321.cc.cd/',
  'https://gap.andyjin.website/',
  'https://gh.ruan.dpdns.org/',
  'https://github.nswrz.cn/',
  'https://gh.zhai.edu.pl/',
  'https://github-cf.947563.xyz/',
  'https://github.gohj99.site/',
  'https://githubproxy.gohj99.site/',
];

const ACCEL_PROBE_LIMIT = 56;
const ACCEL_PROBE_CONCURRENCY = 10;
const ACCEL_PROBE_BYTES = 96 * 1024;
const ACCEL_PROBE_MS = 2200;
const ACCEL_FINALISTS = 3;

const PROBE_SMALL = { bytes: ACCEL_PROBE_BYTES, ms: ACCEL_PROBE_MS, headersTimeout: 2500 };
const PROBE_BIG = { bytes: 1536 * 1024, ms: 3000, headersTimeout: 3000 };
const SPEED_MIN_BYTES = 64 * 1024;
const UA = 'Win-Box-Updater';

const agent = new Agent({ connect: { timeout: 20000 } });

// =========================================================================
// ---- update.ts 纯函数移植 ----
// =========================================================================
function sampleBps(s) {
  if (!s.ok || s.ms <= 0 || s.bytes <= 0) return 0;
  const ttfb = Math.max(0, Number(s.ttfb) || 0);
  const steadyMs = s.ms - ttfb;
  const useMs = steadyMs >= 100 ? steadyMs : s.ms;
  return Math.round((s.bytes * 1000) / useMs);
}

function rankBySpeed(samples, minBytes = 0) {
  const good = samples
    .filter((s) => s.ok && s.bytes >= minBytes)
    .sort((a, b) => sampleBps(b) - sampleBps(a))
    .map((s) => s.url);
  const rest = samples.filter((s) => !(s.ok && s.bytes >= minBytes)).map((s) => s.url);
  return [...good, ...rest];
}

function buildAccelUrls(url, prefixes = GH_ACCEL_PREFIXES) {
  const raw = (url || '').trim();
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const p of prefixes) {
    const pre = p.endsWith('/') ? p : p + '/';
    push(pre + raw);
  }
  push(raw);
  return out;
}

function hostOf(url) {
  return url.replace(/^https?:\/\//, '').split('/')[0];
}

// =========================================================================
// ---- UpdateService.ts 算法移植 ----
// =========================================================================
async function probeSpeed(url, opts) {
  const ac = new AbortController();
  const t0 = Date.now();
  let first = 0;
  let bytes = 0;
  let ok = false;
  try {
    const res = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Range: `bytes=0-${opts.bytes - 1}` },
      headersTimeout: opts.headersTimeout,
      bodyTimeout: opts.ms + 500,
      signal: ac.signal,
      dispatcher: agent,
    });
    if (res.statusCode !== 200 && res.statusCode !== 206) {
      await res.body.dump();
      return { url, bytes: 0, ms: Date.now() - t0, ok: false };
    }
    ok = true;
    await new Promise((resolve) => {
      const timer = setTimeout(() => { ac.abort(); resolve(); }, opts.ms);
      res.body.on('data', (c) => {
        if (!first) first = Date.now();
        bytes += c.length;
        if (bytes >= opts.bytes) {
          clearTimeout(timer);
          ac.abort();
          resolve();
        }
      });
      res.body.on('end', () => { clearTimeout(timer); resolve(); });
      res.body.on('error', () => { clearTimeout(timer); resolve(); });
    });
  } catch {
    return { url, bytes, ms: Date.now() - t0, ok: ok && bytes > 0, ttfb: first ? first - t0 : 0 };
  }
  return { url, bytes, ms: Date.now() - t0, ok, ttfb: first ? first - t0 : 0 };
}

async function collectSamples(urls, opts, concurrency) {
  const got = urls.map(() => null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const i = cursor++;
      try {
        got[i] = await probeSpeed(urls[i], opts);
      } catch {
        got[i] = { url: urls[i], bytes: 0, ms: 0, ok: false };
      }
    }
  };
  await Promise.race([
    Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker)),
    new Promise((r) => setTimeout(r, opts.ms + 800)),
  ]);
  return urls.map((u, i) => got[i] ?? { url: u, bytes: 0, ms: 0, ok: false });
}

async function speedTest(urls, emit) {
  if (urls.length <= 1) return urls;
  const pool = urls.slice(0, ACCEL_PROBE_LIMIT);
  const rest = urls.slice(ACCEL_PROBE_LIMIT);
  emit({ type: 'phase', text: `正在为 ${pool.length} 条下载线路测速…` });

  const small = await collectSamples(pool, PROBE_SMALL, ACCEL_PROBE_CONCURRENCY);
  const alive = small
    .filter((s) => s.ok && s.bytes >= SPEED_MIN_BYTES)
    .sort((a, b) => sampleBps(b) - sampleBps(a));
  for (const s of alive.slice(0, 8)) {
    emit({ type: 'log', text: `测速(小)：${hostOf(s.url)} ${Math.round(sampleBps(s) / 1024)} KB/s` });
  }
  if (!alive.length) {
    emit({ type: 'log', text: `⚠ ${pool.length} 条候选全部不可用，按原顺序尝试` });
    return [...pool, ...rest];
  }

  const finalists = alive.slice(0, ACCEL_FINALISTS);
  emit({ type: 'phase', text: `大样本复测：前 ${finalists.length} 名…` });
  const big = await collectSamples(finalists.map((s) => s.url), PROBE_BIG, finalists.length);
  for (const s of big) {
    emit({ type: 'log', text: `测速(复)：${hostOf(s.url)} ${Math.round(sampleBps(s) / 1024)} KB/s（${s.bytes}B/${s.ms}ms）` });
  }

  const ranked = [
    ...rankBySpeed(big, SPEED_MIN_BYTES),
    ...alive.slice(ACCEL_FINALISTS).map((s) => s.url),
    ...small.filter((s) => !alive.includes(s)).map((s) => s.url),
    ...rest,
  ];
  const best = big.find((s) => s.url === ranked[0]) || finalists.find((s) => s.url === ranked[0]);
  if (best) {
    emit({ type: 'log', text: `→ 最快线路：${hostOf(best.url)}（${Math.round(sampleBps(best) / 1024)} KB/s）` });
  }
  return [...new Set(ranked)];
}

async function downloadOne(url, partPath, expectSize, emit, depth) {
  const res = await request(url, {
    method: 'GET',
    headers: { 'User-Agent': UA },
    headersTimeout: 20000,
    bodyTimeout: 0,
    dispatcher: agent,
  });
  const loc = res.headers['location'];
  if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
    await res.body.dump();
    if (depth >= 8) throw new Error('重定向次数过多');
    const next = new URL(String(loc), url).toString();
    return downloadOne(next, partPath, expectSize, emit, depth + 1);
  }
  if (res.statusCode !== 200) {
    await res.body.dump();
    throw new Error(`HTTP ${res.statusCode}`);
  }

  const total = Number(res.headers['content-length']) || expectSize || 0;
  let received = 0;
  let lastT = Date.now();
  let lastB = 0;
  let speed = 0;
  res.body.on('data', (chunk) => {
    received += chunk.length;
    const now = Date.now();
    if (now - lastT >= 300) {
      speed = Math.round(((received - lastB) * 1000) / (now - lastT));
      lastT = now;
      lastB = received;
      const percent = total ? Math.min(99, Math.floor((received * 100) / total)) : 0;
      emit({ type: 'progress', received, total, percent, speed });
    }
  });

  const ws = createWriteStream(partPath);
  await pipeline(res.body, ws);

  if (total && received !== total) {
    emit({ type: 'log', text: `⚠ 字节数不符（收到 ${received} / 预期 ${total}）` });
  }
  emit({ type: 'progress', received, total: total || received, percent: 100, speed });
}

async function downloadPackage(accelUrls, dest, expectSize, emit) {
  mkdirSync(dirname(dest), { recursive: true });

  if (existsSync(dest) && expectSize > 0 && statSync(dest).size === expectSize) {
    emit({ type: 'log', text: `已存在同大小文件，跳过下载` });
    return { ok: true, path: dest };
  }

  const part = dest + '.part';
  let lastErr = '下载失败';

  let urls = accelUrls;
  try {
    urls = await speedTest(accelUrls, emit);
  } catch (e) {
    emit({ type: 'log', text: `测速失败（改按原顺序）：${e.message}` });
  }

  for (const url of urls) {
    const host = hostOf(url);
    emit({ type: 'log', text: `→ 尝试 ${host}` });
    emit({ type: 'phase', text: `下载中 · ${host}` });
    try {
      await downloadOne(url, part, expectSize, emit, 0);
      rmSync(dest, { force: true });
      renameSync(part, dest);
      emit({ type: 'log', text: `✓ 完成（源 ${host}）` });
      emit({ type: 'done', ok: true, message: `下载完成：${dest}` });
      return { ok: true, path: dest };
    } catch (e) {
      lastErr = e.message || String(e);
      emit({ type: 'log', text: `✗ ${host} 失败：${lastErr}` });
      rmSync(part, { force: true });
    }
  }

  emit({ type: 'done', ok: false, message: lastErr });
  return { ok: false, error: lastErr };
}

// =========================================================================
// ---- Electron ----
// =========================================================================
let mainWindow = null;

function createWindow() {
  // 去掉默认菜单栏（File / Edit / View / Window / Help）
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 820,
    height: 720,
    minWidth: 700,
    minHeight: 620,
    backgroundColor: '#0f1115',
    title: '下载加速器',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(join(__dirname, 'index.html'));
}

ipcMain.handle('select-dir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

// ★ 用 shell.openPath 打开目录（window.open('file://') 会被 Electron 拦掉）
ipcMain.handle('open-dir', async (_e, dirPath) => {
  if (!dirPath) return '路径为空';
  try {
    const err = await shell.openPath(dirPath);
    return err || null; // 空字符串 = 成功
  } catch (e) {
    return e.message || String(e);
  }
});

ipcMain.handle('start-download', async (_e, { url, dest, filename }) => {
  const emit = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('progress', msg);
    }
  };

  let rawUrl = url.trim();
  for (const scheme of ['https://github.com/', 'http://github.com/']) {
    const i = rawUrl.indexOf(scheme);
    if (i > 0) {
      emit({ type: 'log', text: `检测到加速前缀，抽回原始地址` });
      rawUrl = rawUrl.slice(i);
      break;
    }
  }

  const isGithub = /^https?:\/\/(www\.)?github\.com\//i.test(rawUrl)
    || /githubusercontent\.com/i.test(rawUrl);

  const candidates = isGithub ? buildAccelUrls(rawUrl) : [rawUrl];
  emit({ type: 'log', text: `原始地址：${rawUrl}` });
  emit({ type: 'log', text: `候选线路：${candidates.length} 条（含直连兜底）` });
  emit({ type: 'log', text: '' });

  const fullPath = join(dest, filename);
  emit({ type: 'log', text: `保存到：${fullPath}` });
  emit({ type: 'log', text: '' });

  try {
    if (isGithub) {
      return await downloadPackage(candidates, fullPath, 0, emit);
    }
    const part = fullPath + '.part';
    await downloadOne(rawUrl, part, 0, emit, 0);
    rmSync(fullPath, { force: true });
    renameSync(part, fullPath);
    emit({ type: 'done', ok: true, message: `下载完成：${fullPath}` });
    return { ok: true, path: fullPath };
  } catch (e) {
    emit({ type: 'done', ok: false, message: e.message || String(e) });
    return { ok: false, error: e.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
