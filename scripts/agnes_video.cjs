#!/usr/bin/env node
'use strict';
/*
 * Agnes 视频生成 CLI —— 文生视频 / 首尾帧 / 图片·音频参考
 * 模型: agnes-video-2.5-flash（固定 720P，异步任务）
 *
 * 用法: node agnes_video.cjs --prompt "<提示词>" [选项]
 *   --prompt <text>      必填（也可作为首个位置参数，或用管道 stdin 传入）
 *   --mode <m>           text | keyframe | reference（默认 text）
 *   --seconds <s>        时长 4–12，默认 5
 *   --aspect-ratio <r>   21:9 16:9 4:3 1:1 3:4 9:16（默认 16:9）
 *   --first-frame <url>  keyframe 首帧（与 --last-frame 至少一个）
 *   --last-frame <url>   keyframe 尾帧
 *   --images <u1,u2>     reference 参考图（逗号分隔，最多 5）
 *   --audios <a1,a2>     reference 参考音频（逗号分隔，最多 3）
 *   --seed <n>           随机种子（0 合法）
 *   --model <id>         默认 agnes-video-2.5-flash
 *   --out <file>         本地保存路径（.mp4）
 *   --timeout <sec>      轮询超时秒数，默认 900
 *   --video-id <id>      跳过创建，直接接管/恢复一个已存在的任务
 *   --dry-run            只打印将要发送的请求体，不发网络请求
 *   --json               以 JSON 输出结果
 *   --help               显示本帮助
 *
 * 输出: 文本摘要；--json 时输出 {"ok":true,"code":"OK",...}，失败输出 {"ok":false,"code":"...","error":"..."}
 * 退出码: 0 成功 / 1 运行失败 / 2 参数错误
 *
 * Key 读取顺序: AGNES_API_KEY -> AGNES_KEY_FILE -> ~/.agnes_key -> ~/.workbuddy/agnes-key.txt
 * 环境变量: AGNES_BASE_URL（默认 https://api.agnes-ai.cn）、AGNES_OUTPUT_DIR（默认 ~/agnes-output）
 * 依赖: Node.js >= 18（内置 fetch 与 stream/web）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

/* --------------------------------------------------------------- 常量 */

const MODEL = 'agnes-video-2.5-flash';
const SIZE = '720P';
const API_BASE = (process.env.AGNES_BASE_URL || 'https://api.agnes-ai.cn').replace(/\/+$/, '');
const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '';
const OUT_DIR = process.env.AGNES_OUTPUT_DIR || path.join(HOME || process.cwd(), 'agnes-output');

const MODES = ['text', 'keyframe', 'reference'];
const ASPECTS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
const MAX_IMAGES = 5;
const MAX_AUDIOS = 3;

const REQ_TIMEOUT_MS = 60_000;   // 创建任务
const POLL_TIMEOUT_MS = 30_000;  // 单次查询
const POLL_TOTAL_MS = 900_000;   // 轮询总时限，默认 15 分钟
const DL_TIMEOUT_MS = 600_000;   // 视频下载（最长 10 分钟）

const FLAGS = {
  prompt: 'string', mode: 'string', seconds: 'string', 'aspect-ratio': 'string',
  'first-frame': 'string', 'last-frame': 'string', images: 'string', audios: 'string',
  seed: 'string', model: 'string', out: 'string', timeout: 'string', 'video-id': 'string',
  'dry-run': 'boolean', json: 'boolean', help: 'boolean', h: 'boolean'
};

const KEY_HELP = [
  '未找到 Agnes API Key。请任选其一：',
  '  1) 设置环境变量 AGNES_API_KEY',
  '  2) 新建文件 ' + (HOME ? path.join(HOME, '.agnes_key') : '~/.agnes_key') + ' 并写入你的 key（仅一行）',
  '  Key 获取地址: https://www.agnes-ai.cn'
].join('\n');

/* --------------------------------------------------------- 错误与输出 */

// 统一错误码：便于 Agent 与调用方按码分支，而不是解析中文文案
const FAIL = {
  BAD_ARGS: 2,
  MISSING_KEY: 1,
  NETWORK: 1,
  API_ERROR: 1,
  TASK_FAILED: 1,
  POLL_TIMEOUT: 1,
  EMPTY_RESULT: 1,
  IO_ERROR: 1,
  BAD_RESPONSE: 1
};

// 出错时若开了 --json，额外输出一行机器可读 JSON，保持 stdout 可被解析
let jsonMode = false;

class SkillError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SkillError';
    this.code = code;
  }
}

function fail(code, message, exitCode = 1) {
  warn('【' + code + '】' + String(message) + '\n');
  if (jsonMode) out(JSON.stringify({ ok: false, code, error: String(message) }) + '\n');
  process.exit(exitCode);
}

/* ----------------------------------------------------------- 基础工具 */

const write = (fd, text) => { try { fs.writeSync(fd, text); } catch (_) { /* 忽略 EPIPE 等 */ } };
const out = (text) => write(1, text);
const warn = (text) => write(2, text);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const csv = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);

function resolveKey() {
  const env = process.env.AGNES_API_KEY;
  if (env && env.trim()) return env.trim();
  const files = [
    process.env.AGNES_KEY_FILE,
    HOME && path.join(HOME, '.agnes_key'),
    HOME && path.join(HOME, '.workbuddy', 'agnes-key.txt')
  ].filter(Boolean);
  for (const f of files) {
    try {
      const v = fs.readFileSync(f, 'utf8').trim();
      if (v) return v;
    } catch (_) { /* 读不到就试下一个 */ }
  }
  return null;
}

/** 通用参数解析：flags 决定每个 --xxx 的取值类型（string | list | boolean） */
function parseArgs(argv, flags) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('-')) { a._.push(tok); continue; }
    const name = tok.replace(/^--?/, '');
    const type = flags[name];
    if (!type) fail(FAIL.BAD_ARGS, '未知参数: ' + tok, 2);
    if (type === 'boolean') { a[name] = true; continue; }
    const val = argv[++i];
    if (val === undefined) fail(FAIL.BAD_ARGS, '参数 ' + tok + ' 缺少值', 2);
    if (type === 'list') (a[name] = a[name] || []).push(val);
    else a[name] = val;
  }
  return a;
}

/* --------------------------------------------------------------- 网络 */

/** 带超时的 JSON 请求；网络抖动/5xx 自动退避重试 */
async function requestJson(url, { method = 'GET', key, body, timeoutMs = 60_000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const headers = { Authorization: 'Bearer ' + key };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ac.signal
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
      // 5xx / 429（限频）/ 408（超时）均为可恢复，退避重试
      if ((res.status >= 500 || res.status === 429 || res.status === 408) && attempt < retries) {
        lastErr = new Error('HTTP ' + res.status);
        continue;
      }
      return { ok: res.ok, status: res.status, data };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? new Error('请求超时(' + timeoutMs + 'ms)') : e;
      if (attempt >= retries) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SkillError(FAIL.NETWORK, '网络请求失败（已重试 ' + retries + ' 次）: ' + lastErr.message);
}

/** 流式下载到磁盘：先写 .part 再原子改名 */
async function download(url, dest, timeoutMs = DL_TIMEOUT_MS, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const tmp = dest + '.part';
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
      fs.renameSync(tmp, dest);
      return;
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* 清理失败忽略 */ }
      lastErr = e.name === 'AbortError' ? new Error('下载超时(' + timeoutMs + 'ms)') : e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SkillError(FAIL.IO_ERROR, '视频下载失败（已重试 ' + retries + ' 次）: ' + lastErr.message);
}

/**
 * 轮询任务：指数退避（2s→8s）。
 * - 网络抖动 / 5xx / 429：退避后重试，不直接失败（429 是限频，属可恢复的瞬时状态）
 * - 其余 4xx（如 key 失效、video_id 不存在）：立即失败，避免空等到超时
 */
// 429 限频虽然也是 4xx，但语义上属于「稍后重试即可」，不能当致命错误
const isRetryableStatus = (s) => s >= 500 || s === 429 || s === 408;

async function poll(key, videoId, model, totalMs) {
  const url = API_BASE + '/agnesapi?video_id=' + encodeURIComponent(videoId)
    + '&model_name=' + encodeURIComponent(model);
  const deadline = Date.now() + totalMs;
  let interval = 2000;
  for (;;) {
    const wait = Math.min(interval, deadline - Date.now());
    if (wait <= 0) {
      throw new SkillError(FAIL.POLL_TIMEOUT,
        '轮询超时（已等待 ' + Math.round(totalMs / 1000) + 's）。任务可能仍在跑：' +
        '可用 --video-id ' + videoId + ' --timeout <更大秒数> 原地续等，或加大 --timeout 重跑。');
    }
    await sleep(wait);
    let resp;
    try {
      resp = await requestJson(url, { key, timeoutMs: POLL_TIMEOUT_MS, retries: 0 });
    } catch (_) {
      interval = Math.min(interval + 1000, 8000);
      continue;
    }
    // 可恢复的状态码：退避后继续轮询
    if (!resp.ok && isRetryableStatus(resp.status)) {
      warn('[agnes] 查询返回 HTTP ' + resp.status + '，退避重试中...\n');
      interval = Math.min(interval + 1000, 8000);
      continue;
    }
    // 其余 4xx 是确定性问题，重试无意义：直接抛出可读原因
    if (!resp.ok) {
      const d = resp.data || {};
      throw new SkillError(FAIL.API_ERROR,
        '查询任务失败（HTTP ' + resp.status + '）: ' + JSON.stringify(d).slice(0, 400) +
        (resp.status === 401 ? '\n提示：Key 无效或已过期。' : '') +
        (resp.status === 404 ? '\n提示：video_id 不存在或已过期，请确认 ID 是否正确。' : ''));
    }
    const d = resp.data || {};
    const status = d.status || (d.metadata && d.metadata.status);
    if (status === 'completed') return d;
    if (status === 'failed') {
      throw new SkillError(FAIL.TASK_FAILED,
        '视频生成失败: ' + JSON.stringify(d.error || d.detail || d).slice(0, 500));
    }
    interval = Math.min(interval + 1000, 8000);
  }
}

const pickUrl = (d) =>
  (d && d.metadata && (d.metadata.url || d.metadata.video_url)) ||
  (d && (d.url || d.video_url)) ||
  (d && d.data && d.data[0] && d.data[0].url) || null;

/* -------------------------------------------------------------- 主流程 */

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  try {
    for await (const c of process.stdin) chunks.push(c);
  } catch (_) { return ''; }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function usage() {
  out('用法: node agnes_video.cjs --prompt "<提示词>" [--mode text|keyframe|reference] [--seconds 5]\n' +
      '                        [--aspect-ratio 16:9] [--first-frame URL] [--last-frame URL]\n' +
      '                        [--images u1,u2] [--audios a1] [--seed N] [--out file]\n' +
      '                        [--timeout 900] [--video-id ID] [--dry-run] [--json]\n' +
      '提示: 也可以不传 --prompt，改用管道传入；轮到超时可用 --video-id 原地续等。\n');
}

/** 组装并校验请求体；返回 null 表示走 --video-id 恢复模式（无需新建任务） */
function buildBody(a) {
  const mode = a.mode || 'text';
  if (!MODES.includes(mode)) fail(FAIL.BAD_ARGS, 'mode 必须是 ' + MODES.join(' / '), 2);

  const body = { model: a.model || MODEL, prompt: a.prompt, mode, size: SIZE };

  if (a.seconds !== undefined) {
    const s = Number(a.seconds);
    if (!Number.isInteger(s) || s < 4 || s > 12) fail(FAIL.BAD_ARGS, 'seconds 需为 4–12 的整数', 2);
    body.seconds = String(s);
  }
  if (a['aspect-ratio'] !== undefined) {
    if (!ASPECTS.includes(a['aspect-ratio'])) {
      fail(FAIL.BAD_ARGS, 'aspect-ratio 必须是 ' + ASPECTS.join(' / '), 2);
    }
    body.aspect_ratio = a['aspect-ratio'];
  }
  if (a.seed !== undefined) {
    const n = Number(a.seed);
    if (!Number.isFinite(n)) fail(FAIL.BAD_ARGS, 'seed 需为数字', 2);
    body.seed = n; // 注意：0 是合法种子，故用 !== undefined 判断
  }

  if (mode === 'keyframe') {
    if (a['first-frame']) body.first_frame = a['first-frame'];
    if (a['last-frame']) body.last_frame = a['last-frame'];
    if (!body.first_frame && !body.last_frame) {
      fail(FAIL.BAD_ARGS, 'keyframe 模式需 --first-frame 或 --last-frame', 2);
    }
  } else if (mode === 'reference') {
    const images = a.images ? csv(a.images) : [];
    const audios = a.audios ? csv(a.audios) : [];
    if (images.length > MAX_IMAGES) fail(FAIL.BAD_ARGS, 'reference 模式参考图最多 ' + MAX_IMAGES + ' 张', 2);
    if (audios.length > MAX_AUDIOS) fail(FAIL.BAD_ARGS, 'reference 模式参考音频最多 ' + MAX_AUDIOS + ' 段', 2);
    if (!images.length && !audios.length) fail(FAIL.BAD_ARGS, 'reference 模式需 --images 或 --audios', 2);
    if (images.length) body.images = images;
    if (audios.length) body.audios = audios;
  }
  return body;
}

async function main() {
  if (typeof fetch !== 'function') {
    fail(FAIL.BAD_ARGS, '需要 Node.js >= 18（当前 ' + process.version + '）', 2);
  }

  const a = parseArgs(process.argv.slice(2), FLAGS);
  if (a.help || a.h) return usage();
  jsonMode = !!a.json;

  a.prompt = a.prompt || a._[0] || (await readStdin());
  const resumeId = a['video-id'];
  // --video-id 恢复模式不需要 prompt；否则 prompt 必填
  if (!a.prompt && !resumeId) {
    usage();
    warn('【' + FAIL.BAD_ARGS + '】缺少 --prompt（或位置参数 / 管道输入）\n');
    process.exit(2);
  }

  const timeoutMs = a.timeout !== undefined && Number(a.timeout) > 0
    ? Number(a.timeout) * 1000
    : POLL_TOTAL_MS;

  if (a['dry-run']) {
    const preview = resumeId
      ? { note: '恢复模式：不新建任务，直接查询已有 video_id', video_id: resumeId, poll_timeout_s: timeoutMs / 1000 }
      : { method: 'POST', url: API_BASE + '/v1/videos', body: buildBody(a) };
    out('[dry-run] ' + JSON.stringify(preview, null, 2) + '\n');
    return;
  }

  const key = resolveKey();
  if (!key) fail(FAIL.MISSING_KEY, KEY_HELP);

  const body = resumeId ? { model: a.model || MODEL } : buildBody(a);

  // 创建任务（除非用 --video-id 接管已有任务）
  let videoId = resumeId;
  if (!videoId) {
    const created = await requestJson(API_BASE + '/v1/videos', {
      method: 'POST', key, body, timeoutMs: REQ_TIMEOUT_MS
    });
    const d = created.data || {};
    videoId = d.video_id || d.id || d.task_id;
    if (!videoId) {
      throw new SkillError(FAIL.API_ERROR,
        'Agnes 返回异常（HTTP ' + created.status + '）: ' + JSON.stringify(d).slice(0, 800) +
        (created.status === 401 ? '\n提示：Key 无效或已过期。' : ''));
    }
    warn('[agnes] 任务已创建: ' + videoId + '，轮询中（最长 ' + Math.round(timeoutMs / 1000) + 's）...\n');
  } else {
    warn('[agnes] 接管已有任务: ' + videoId + '，轮询中（最长 ' + Math.round(timeoutMs / 1000) + 's）...\n');
  }

  const meta = await poll(key, videoId, body.model, timeoutMs);
  const url = pickUrl(meta);

  let outPath = null;
  if (url) {
    outPath = a.out ? path.resolve(a.out) : path.join(OUT_DIR, 'agnes-video-' + Date.now() + '.mp4');
    await download(url, outPath);
  } else {
    throw new SkillError(FAIL.EMPTY_RESULT,
      '任务已完成但未返回视频地址: ' + JSON.stringify(meta).slice(0, 400));
  }

  if (jsonMode) {
    out(JSON.stringify({ ok: true, code: 'OK', model: body.model, video_id: videoId, url, local_path: outPath }) + '\n');
  } else {
    out('视频已生成\nURL: ' + url + '\n本地文件: ' + outPath + '\n');
  }

  process.exit(0);
}

main().catch((e) => {
  if (e instanceof SkillError) fail(e.code, e.message, e.code === FAIL.BAD_ARGS ? 2 : 1);
  fail(FAIL.BAD_RESPONSE, '未预期的错误: ' + (e && e.message ? e.message : String(e)));
});
