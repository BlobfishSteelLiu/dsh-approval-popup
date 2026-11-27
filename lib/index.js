/**
 * dsh-approval-popup — host approval owner.
 *
 * A single pending approval is owned by the host, so the in-app modal and the
 * native Windows dialog can answer the same request exactly once. The browser
 * polls a loopback-only bridge; the native dialog is opened when the poll says
 * the app is hidden.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeBash } from './bash-analyze.js';

export const name = 'dsh-approval-popup';
export const inject = ['webServer'];

const DIALOG_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'dialog.ps1');
const NOTIFY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'notify.ps1');
const OVERLAY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'overlay.ps1');
const ANALYZE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'analyze.ps1');
const POWERSHELL = join(
  process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe'
);
const ROUTE = '/dsh-approval-popup';
const OUTCOMES = new Set(['allowed-once', 'rejected']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const SETTINGS_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'dsh-approval-popup');
const SETTINGS_FILE = join(SETTINGS_DIR, 'settings.json');
const APPROVAL_LOG = join(SETTINGS_DIR, 'approvals.log');
const FLOATING_STATE = join(SETTINGS_DIR, 'floating.json');
const CATEGORY_KEYS = ['delete', 'registry', 'systemFiles', 'permissions', 'disk', 'dynamic'];
const SETTINGS_KEYS = ['enabled', 'floatingEnabled', ...CATEGORY_KEYS];
const OUTSIDE_VALUES = new Set(['off', 'notification', 'window']);
const THEME_VALUES = new Set(['system', 'light', 'dark']);
const QUESTION_MODES = new Set(['off', 'bubble']);
const FLOATING_CONDITIONS = new Set(['hidden', 'always']);

const ACCENT_OPTIONS = Object.freeze({
  deepBlue: { hex: '#1D4ED8', text: '#FFFFFF' },
  skyBlue: { hex: '#0EA5E9', text: '#FFFFFF' },
  emerald: { hex: '#059669', text: '#FFFFFF' },
  amber: { hex: '#D97706', text: '#111827' }
});
const HIGH_RISK_ACCENT = Object.freeze({
  id: 'alertRed',
  hex: '#DC2626',
  text: '#FFFFFF'
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  delete: true,
  registry: true,
  systemFiles: true,
  permissions: true,
  disk: true,
  dynamic: true,
  theme: 'system',
  questionMode: 'bubble',
  floatingEnabled: false,
  floatingWidth: 480,
  floatingCondition: 'hidden',
  accent: 'deepBlue',
  outside: 'notification'
});

function loadSettings() {
  try {
    const stored = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of SETTINGS_KEYS) {
      if (typeof stored?.[key] === 'boolean') settings[key] = stored[key];
    }
    if (typeof stored?.accent === 'string' && ACCENT_OPTIONS[stored.accent] !== undefined) {
      settings.accent = stored.accent;
    }
    if (typeof stored?.outside === 'string' && OUTSIDE_VALUES.has(stored.outside)) {
      settings.outside = stored.outside;
    }
    if (typeof stored?.theme === 'string' && THEME_VALUES.has(stored.theme)) {
      settings.theme = stored.theme;
    }
    if (typeof stored?.questionMode === 'string' && QUESTION_MODES.has(stored.questionMode)) {
      settings.questionMode = stored.questionMode;
    } else if (stored?.questionNotify === false) {
      settings.questionMode = 'off';
    }
    if (Number.isFinite(stored?.floatingWidth)) {
      settings.floatingWidth = Math.min(900, Math.max(320, Math.round(stored.floatingWidth)));
    }
    if (typeof stored?.floatingCondition === 'string' && FLOATING_CONDITIONS.has(stored.floatingCondition)) {
      settings.floatingCondition = stored.floatingCondition;
    }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(candidate) {
  const settings = { ...DEFAULT_SETTINGS };
  for (const key of SETTINGS_KEYS) {
    if (typeof candidate?.[key] === 'boolean') settings[key] = candidate[key];
  }
  if (typeof candidate?.accent === 'string' && ACCENT_OPTIONS[candidate.accent] !== undefined) {
    settings.accent = candidate.accent;
  }
  if (typeof candidate?.outside === 'string' && OUTSIDE_VALUES.has(candidate.outside)) {
    settings.outside = candidate.outside;
  }
  if (typeof candidate?.theme === 'string' && THEME_VALUES.has(candidate.theme)) {
    settings.theme = candidate.theme;
  }
  if (typeof candidate?.questionMode === 'string' && QUESTION_MODES.has(candidate.questionMode)) {
    settings.questionMode = candidate.questionMode;
  }
  if (Number.isFinite(candidate?.floatingWidth)) {
    settings.floatingWidth = Math.min(900, Math.max(320, Math.round(candidate.floatingWidth)));
  }
  if (typeof candidate?.floatingCondition === 'string' && FLOATING_CONDITIONS.has(candidate.floatingCondition)) {
    settings.floatingCondition = candidate.floatingCondition;
  }
  mkdirSync(SETTINGS_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return settings;
}

function logApproval(sessionId, callId, toolName, highRisk) {
  try {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    appendFileSync(
      APPROVAL_LOG,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        sessionId,
        callId,
        tool: toolName,
        level: highRisk ? 'high-risk' : 'normal'
      })}\n`,
      'utf8'
    );
  } catch {
    // Logging must never block or fail an approval.
  }
}

const COPY = {
  zh: {
    title: 'DeepSeek Harness · 权限提升请求',
    header: '模型请求以更高权限执行本次操作。批准仅对这一次调用生效。',
    reasonLabel: '申请说明',
    toolLabel: '发起工具：',
    conversation: '对话',
    workspace: '工作区',
    allow: '允许一次',
    reject: '拒绝',
    highRisk: '高危请求',
    highRiskHint: '高危请求：请用鼠标点击「允许一次」。',
    notifyTitle: '权限审批待处理',
    notifyHint: '点击返回 DeepSeek Harness',
    questionNotifyTitle: '需要你的回答',
    questionNotifyHint: '点击返回 DeepSeek Harness 回答',
    hint: '请点击「允许一次」或「拒绝」',
    fallbackReason: '工具请求越权执行本次操作。'
  },
  en: {
    title: 'DeepSeek Harness · Permission escalation',
    header: 'The model wants to run this operation with wider permissions. Approval applies to this one call only.',
    reasonLabel: 'Reason',
    toolLabel: 'Requested by: ',
    conversation: 'Conversation',
    workspace: 'Workspace',
    allow: 'Allow once',
    reject: 'Reject',
    highRisk: 'HIGH RISK',
    highRiskHint: 'High-risk: use the mouse to click Allow once.',
    notifyTitle: 'Approval waiting',
    notifyHint: 'Click to return to DeepSeek Harness',
    questionNotifyTitle: 'Your answer is needed',
    questionNotifyHint: 'Click to return to DeepSeek Harness to answer',
    hint: 'Choose Allow once or Reject',
    fallbackReason: 'A tool requests privileged execution for this operation.'
  }
};

let nextKey = 0;
const pending = new Map();
const questionNotified = new Set();
const sessions = new Map();
let nativeOwner = null;
let overlayChild = null;
let floatingWriteTimer = null;
let balance = null;
let balanceFetchedAt = 0;
let balanceInFlight = false;
let appVisible = true;
let appOrigin = '';

function prefersChinese() {
  const locale =
    process.env.DSH_UI_LOCALE ??
    process.env.LC_ALL ??
    process.env.LC_MESSAGES ??
    process.env.LANG ??
    Intl.DateTimeFormat().resolvedOptions().locale ??
    '';
  return /^zh(?:[-_]|$)/i.test(locale);
}

function localized(value, lang) {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const picked = lang === 'zh' ? (value.zh ?? value.en) : (value.en ?? value.zh);
    return typeof picked === 'string' ? picked : '';
  }
  return '';
}

const HIGH_RISK_PATTERNS = {
  delete: [
    /\b(?:rm|del|delete|remove|erase|unlink|rmdir|rd|deltree|truncate|purge)\b/i,
    /\brobocopy\b[\s\S]*?\/(?:mir|purge)\b/i,
    /\bgit\s+clean\b[\s\S]*?\s-[a-z]*f[a-z]*/i,
    /\b(?:rd|rmdir)\s+\/s\b/i,
    /\b(?:del|erase)\s+\/f\b/i,
    /\bfind\b[\s\S]*?\s-delete\b/i,
    /(?:删除|移除|清空|抹除|销毁)/
  ],
  registry: [/\b(?:reg|regedit|registry)\b|HKEY_|HKLM|HKCU|HKCR|注册表/i],
  systemFiles: [
    /system32|[\\/]windows[\\/]|Program Files|ProgramData|boot\.ini|ntoskrnl|system\s+file|系统文件/i
  ],
  permissions: [/takeown|icacls|chmod|chown|attrib/i],
  disk: [
    /diskpart[\s\S]*?\b(?:clean|format)\b|format\s+[a-z]:|cipher\s+\/w|shutdown|services\.msc|bcdedit|\bsc\s+(?:delete|config)\b/i
  ],
  dynamic: [/\b(?:invoke-expression|iex)\b/i]
};

const PROSE_ARGS = new Set([
  'justification',
  'description',
  'reason',
  'displayReason',
  'prompt',
  'explanation'
]);

/** Flatten the actual tool-call arguments, excluding prose fields. */
function commandTextOf(argumentsValue) {
  let parsed = argumentsValue;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return parsed;
    }
  }
  const values = [];
  const walk = (value) => {
    if (typeof value === 'string') {
      values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (PROSE_ARGS.has(key)) continue;
        walk(child);
      }
    }
  };
  walk(parsed);
  return values.join('\n');
}

/** Find the tool-call event matching the approval's callId. */
function toolCallFor(session, callId) {
  if (!session || typeof session.eventAt !== 'function' || typeof callId !== 'string') return null;
  const last = Number(session.seq ?? 0);
  for (let seq = last - 1; seq >= 0; seq -= 1) {
    let event;
    try {
      event = session.eventAt(seq);
    } catch {
      break;
    }
    if (event?.type !== 'tool/call') continue;
    const data = event.data;
    if (data?.callId !== callId) continue;
    let parsed = data.arguments;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        // Keep the raw string; the fallback text scan still sees it.
      }
    }
    return { name: data.name, args: parsed };
  }
  return null;
}

/** Parse a PowerShell command with the real PowerShell AST and classify it semantically. */
function analyzePowerShellSync(command) {
  if (typeof command !== 'string' || command.trim() === '' || !existsSync(ANALYZE_SCRIPT)) return null;
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), 'dsh-analyze-'));
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    writeFileSync(inputPath, JSON.stringify({ command }), 'utf8');
    // File-based payload/output avoids named-pipe restrictions in confined hosts.
    execFileSync(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ANALYZE_SCRIPT],
      {
        env: { ...process.env, DSH_ANALYZE_INPUT: inputPath, DSH_ANALYZE_OUTPUT: outputPath },
        timeout: 2_500,
        windowsHide: true,
        stdio: 'ignore'
      }
    );
    const result = JSON.parse(readFileSync(outputPath, 'utf8').replace(/^\uFEFF/, ''));
    return {
      highRisk: result?.highRisk === true,
      reasons: Array.isArray(result?.reasons) ? result.reasons : [],
      categories: Array.isArray(result?.categories) ? result.categories : []
    };
  } catch {
    return null;
  } finally {
    if (directory !== undefined) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

function isHighRisk(request, reason, commandText = '', settings = DEFAULT_SETTINGS) {
  if (!settings.enabled) return false;
  // Detection is based on the actual tool-call arguments. Only when the call
  // cannot be resolved do we fall back to the human-readable approval reason.
  const text = [request?.toolName, commandText || reason]
    .filter((value) => typeof value === 'string')
    .join('\n');
  return Object.entries(HIGH_RISK_PATTERNS).some(
    ([category, patterns]) => settings[category] !== false && patterns.some((pattern) => pattern.test(text))
  );
}

function metaFor(request) {
  const session = request?.agent?.session;
  const sessionId = session?.id ?? request?.agent?.id ?? 'unknown';

  // Titles and the session's working directory live in the durable projection
  // cache. Read them so the in-app and native dialogs can name the conversation
  // instead of showing a raw session id.
  let cachedTitle;
  let cachedCwd;
  try {
    const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
    const cached = JSON.parse(
      readFileSync(join(dshHome, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), 'utf8')
    );
    cachedTitle = cached?.record?.rows?.title?.val;
    cachedCwd = cached?.record?.identity?.cwd;
  } catch {
    // No cache yet (new session) or a different storage layout; use fallbacks.
  }

  const title = session?.title ?? session?.projections?.title ?? cachedTitle ?? sessionId;
  const candidateWorkspace = session?.workspace ?? session?.cwd;
  const workspace =
    (typeof candidateWorkspace === 'string'
      ? candidateWorkspace
      : candidateWorkspace?.path ?? candidateWorkspace?.root) ??
    cachedCwd ??
    process.cwd();
  const lang = prefersChinese() ? 'zh' : 'en';
  const copy = COPY[lang];
  const reason =
    localized(request?.displayReason, lang) ||
    (typeof request?.reason === 'string' && request.reason !== '' ? request.reason : '') ||
    copy.fallbackReason;
  const settings = loadSettings();
  const call = toolCallFor(session, request?.callId);
  const commandText = call === null ? '' : commandTextOf(call.args);
  const toolName = String(call?.name ?? request?.toolName ?? 'unknown');
  const command = typeof call?.args?.command === 'string' ? call.args.command : '';
  let semantic = null;
  let analysisFailed = false;
  if (settings.enabled && /^(pwsh|powershell)(\.exe)?$/i.test(toolName)) {
    semantic = analyzePowerShellSync(command);
    analysisFailed = semantic === null;
  } else if (
    settings.enabled &&
    /^(bash|sh|zsh|dash|ksh|fish)(\.exe)?$/i.test(toolName) &&
    command.trim() !== ''
  ) {
    try {
      semantic = analyzeBash(command);
    } catch {
      analysisFailed = true;
    }
  }
  let highRisk = false;
  if (settings.enabled) {
    if (analysisFailed) {
      // Fail safe: an analyzer timeout, crash or unavailable parser must not
      // silently downgrade a privileged request to "normal".
      highRisk = true;
    } else if (semantic !== null) {
      const categories =
        semantic.categories.length > 0
          ? semantic.categories
          : semantic.highRisk
            ? CATEGORY_KEYS
            : [];
      highRisk = categories.some((category) => settings[category] === true);
    } else {
      highRisk = isHighRisk(request, reason, commandText, settings);
    }
  }
  const callId = String(request?.callId ?? 'unknown');
  logApproval(String(sessionId), callId, toolName, highRisk);
  const accent = highRisk
    ? { ...HIGH_RISK_ACCENT }
    : { id: settings.accent, ...(ACCENT_OPTIONS[settings.accent] ?? ACCENT_OPTIONS.deepBlue) };
  return {
    lang,
    sessionId: String(sessionId),
    title: String(title),
    workspace: String(workspace),
    toolName,
    reason,
    highRisk,
    accent,
    outside: settings.outside,
    theme: settings.theme
  };
}

function publicPending(entry) {
  return {
    key: entry.key,
    sessionId: entry.sessionId,
    title: entry.title,
    workspace: entry.workspace,
    toolName: entry.toolName,
    reason: entry.reason,
    displayReason: entry.displayReason,
    highRisk: entry.highRisk === true,
    accent: entry.accent,
    theme: entry.theme
  };
}

function settle(entry, outcome) {
  if (entry.settled) return;
  entry.settled = true;
  if (entry.native !== null) {
    try {
      entry.native.cancel();
    } catch {
      // Already closed.
    }
    entry.native = null;
  }
  if (nativeOwner === entry) nativeOwner = null;
  entry.resolve(outcome);
}

function showDialog(entry) {
  const handle = { cancel: () => {} };
  const promise = new Promise((resolve) => {
    if (!existsSync(POWERSHELL) || !existsSync(DIALOG_SCRIPT)) {
      resolve({ kind: 'unavailable' });
      return;
    }
    let directory;
    try {
      directory = mkdtempSync(join(tmpdir(), 'dsh-approval-'));
      const payloadPath = join(directory, 'payload.json');
      const copy = COPY[entry.lang];
      const context = [
        `${copy.conversation}: ${entry.title}`,
        `${copy.workspace}: ${entry.workspace}`,
        `${copy.toolLabel}${entry.toolName}`,
        '',
        entry.reason
      ].join('\n');
      writeFileSync(
        payloadPath,
        JSON.stringify({
          lang: entry.lang,
          title: `${copy.title} — ${entry.title}`,
          dialogTitle: copy.title,
          header: copy.header,
          reasonLabel: copy.reasonLabel,
          conversationLabel: copy.conversation,
          conversation: entry.title,
          workspaceLabel: copy.workspace,
          workspace: entry.workspace,
          toolLabel: copy.toolLabel,
          tool: entry.toolName,
          reason: context.slice(0, 32_000),
          allow: copy.allow,
          reject: copy.reject,
          highRisk: entry.highRisk === true,
          highRiskLabel: copy.highRisk,
          accentColor: entry.accent.hex,
          accentTextColor: entry.accent.text,
          hint: entry.highRisk ? copy.highRiskHint : copy.hint
        }),
        'utf8'
      );
      const child = spawn(
        POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', DIALOG_SCRIPT],
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: { ...process.env, DSH_APPROVAL_PAYLOAD: payloadPath }
        }
      );
      let settled = false;
      let stderr = '';
      const finish = (result) => {
        if (settled) return;
        settled = true;
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {}
        resolve(result);
      };
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
        if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
      });
      child.once('error', () => finish({ kind: 'unavailable' }));
      child.once('close', (code) => {
        if (code === 6) finish({ kind: 'allowed-once' });
        else if (code === 7) finish({ kind: 'rejected' });
        else finish({ kind: 'unavailable', detail: stderr.trim() || `dialog exited with ${String(code)}` });
      });
      handle.cancel = () => {
        try {
          child.kill();
        } catch {}
        finish({ kind: 'cancelled' });
      };
    } catch {
      if (directory !== undefined) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch {}
      }
      resolve({ kind: 'unavailable' });
    }
  });
  return { promise, cancel: () => handle.cancel() };
}

function showNotification(entry) {
  if (entry.settled || entry.notified || entry.notification !== null) return;
  entry.notified = true;
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), 'dsh-approval-notify-'));
    const payloadPath = join(directory, 'payload.json');
    const copy = COPY[entry.lang];
    writeFileSync(
      payloadPath,
      JSON.stringify({
        lang: entry.lang,
        title: copy.notifyTitle,
        conversation: entry.title,
        toolLabel: copy.toolLabel,
        tool: entry.toolName,
        highRisk: entry.highRisk === true,
        highRiskLabel: copy.highRisk,
        accentColor: entry.accent.hex,
        accentTextColor: entry.accent.text,
        hint: copy.notifyHint,
        dshPid: process.pid,
        dshUrl: entry.origin
      }),
      'utf8'
    );
    const child = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', NOTIFY_SCRIPT],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, DSH_APPROVAL_PAYLOAD: payloadPath }
      }
    );
    entry.notification = child;
    const cleanup = () => {
      if (entry.notification === child) entry.notification = null;
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    };
    child.once('error', cleanup);
    child.once('close', cleanup);
  } catch {
    if (directory !== undefined) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    }
  }
}

function showQuestionNotification(exec) {
  notifyQuestion(exec?.callId, exec?.name, exec?.arguments, exec?.agent?.session);
}

function notifyQuestion(callIdValue, name, argumentsValue, session) {
  if (name !== 'ask_user_question') return;
  const settings = loadSettings();
  if (settings.questionMode === 'off' || appVisible !== false) return;
  const callId = String(callIdValue ?? 'unknown');
  if (session !== undefined && session !== null) {
    const state = sessions.get(String(session.id));
    if (state !== undefined) {
      state.status = '提问';
      scheduleFloatingWrite();
    }
  }
  if (questionNotified.has(callId)) return;
  questionNotified.add(callId);
  if (questionNotified.size > 64) {
    questionNotified.delete(questionNotified.values().next().value);
  }

  if (typeof argumentsValue === 'string') {
    try {
      argumentsValue = JSON.parse(argumentsValue);
    } catch {
      argumentsValue = undefined;
    }
  }
  const questions = Array.isArray(argumentsValue?.questions) ? argumentsValue.questions : [];
  const question = String(
    questions[0]?.question ??
      argumentsValue?.question ??
      'ask_user_question'
  ).slice(0, 4_000);
  const copy = COPY[prefersChinese() ? 'zh' : 'en'];
  const accent = ACCENT_OPTIONS[settings.accent] ?? ACCENT_OPTIONS.deepBlue;
  let directory;
  try {
    directory = mkdtempSync(join(tmpdir(), 'dsh-question-notify-'));
    const payloadPath = join(directory, 'payload.json');
    writeFileSync(
      payloadPath,
      JSON.stringify({
        lang: copy === COPY.zh ? 'zh' : 'en',
        kind: 'question',
        title: copy.questionNotifyTitle,
        conversation: question,
        toolLabel: copy.toolLabel,
        tool: 'ask_user_question',
        highRisk: false,
        highRiskLabel: '',
        accentColor: accent.hex,
        accentTextColor: accent.text,
        hint: copy.questionNotifyHint,
        dshPid: process.pid,
        dshUrl: appOrigin
      }),
      'utf8'
    );
    const child = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', NOTIFY_SCRIPT],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: { ...process.env, DSH_APPROVAL_PAYLOAD: payloadPath }
      }
    );
    const cleanup = () => {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    };
    child.once('error', cleanup);
    child.once('close', cleanup);
  } catch {
    if (directory !== undefined) {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch {}
    }
  }
}

function periodLabel(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= 30 && minutes < 510 ? '低谷' : '高峰';
}

async function refreshBalance(ctx) {
  if (balanceInFlight) return;
  if (balance !== null && Date.now() - balanceFetchedAt < 5 * 60_000) return;
  balanceInFlight = true;
  try {
    let credential;
    try {
      const credentials = ctx.get?.('credentials');
      if (credentials && typeof credentials.resolve === 'function') {
        credential = await credentials.resolve('DEEPSEEK_API_KEY');
      }
    } catch {
      credential = undefined;
    }
    if (credential?.value) {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: { authorization: `Bearer ${credential.value}` },
        signal: AbortSignal.timeout(8_000)
      });
      if (!response.ok) return;
      const data = await response.json();
      const infos = Array.isArray(data?.balance_infos) ? data.balance_infos : [];
      const info = infos.find((item) => item?.currency === 'CNY') ?? infos[0];
      if (!info || !Number.isFinite(Number(info.total_balance))) return;
      balance = {
        currency: String(info.currency ?? 'CNY'),
        amount: Number(info.total_balance),
        at: Date.now()
      };
    } else {
      const account = ctx.get?.('deepseekAccount');
      if (!account || typeof account.getBalance !== 'function') return;
      const result = await account.getBalance({
        version: '0.2.0-rc.2',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
      });
      if (result?.status !== 'ready' || !Array.isArray(result.value) || result.value.length === 0) return;
      const wallet = result.value.find((item) => item?.currency === 'CNY') ?? result.value[0];
      if (!Number.isFinite(Number(wallet?.balance))) return;
      balance = {
        currency: String(wallet.currency ?? 'CNY'),
        amount: Number(wallet.balance),
        at: Date.now()
      };
    }
    balanceFetchedAt = Date.now();
    scheduleFloatingWrite();
  } catch {
    // Keep the last known balance; the overlay shows -- until one is available.
  } finally {
    balanceInFlight = false;
  }
}

function scheduleFloatingWrite() {
  if (floatingWriteTimer !== null) return;
  floatingWriteTimer = setTimeout(() => {
    floatingWriteTimer = null;
    writeFloatingState();
  }, 120);
}

function writeFloatingState() {
  try {
    const settings = loadSettings();
    mkdirSync(SETTINGS_DIR, { recursive: true });
    const rows = [...sessions.values()].map((session) => ({
      id: session.id,
      title: session.title,
      model: session.model,
      status: session.status,
      turns: session.turns,
      tokens: session.tokens
    }));
    writeFileSync(
      FLOATING_STATE,
      JSON.stringify({
        ts: Date.now(),
        labels: {
          balance: '余额',
          noSessions: '暂无活动会话',
          waiting: '等待 Agent 活动',
          untitled: '未命名会话',
          turn: '第',
          round: '轮',
          tokens: 'tokens'
        },
        enabled: settings.floatingEnabled === true,
        width: settings.floatingWidth,
        condition: settings.floatingCondition,
        accent: (ACCENT_OPTIONS[settings.accent] ?? ACCENT_OPTIONS.deepBlue).hex,
        theme: settings.theme,
        appVisible,
        balance: balance === null ? null : `${balance.currency === 'USD' ? '$' : '¥'}${balance.amount.toFixed(2)}`,
        period: periodLabel(),
        sessions: rows
      }),
      'utf8'
    );
  } catch {
    // Status overlay is best effort.
  }
}

function ensureOverlay() {
  if (overlayChild !== null) return;
  try {
    overlayChild = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', OVERLAY_SCRIPT],
      { windowsHide: true, stdio: 'ignore' }
    );
    overlayChild.once('close', () => {
      overlayChild = null;
    });
    overlayChild.once('error', () => {
      overlayChild = null;
    });
  } catch {
    overlayChild = null;
  }
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (typeof block === 'string' ? block : typeof block?.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function sessionTitleOf(ctx, session) {
  try {
    const title = ctx.get?.('sessionTitle')?.get?.(session)?.title;
    if (typeof title === 'string' && title !== '') return title;
  } catch {
    // Title service is optional; the session object may still carry one.
  }
  const own = session?.title;
  return typeof own === 'string' && own !== '' && own !== session?.id ? own : '';
}

function updateSession(ctx, session, event) {
  const id = session?.id;
  if (typeof id !== 'string' || id === '') return;
  const resolvedTitle = sessionTitleOf(ctx, session);
  let state = sessions.get(id);
  if (state === undefined) {
    state = {
      id,
      title: resolvedTitle || '未命名会话',
      fallbackTitle: '',
      model: String(session?.header?.model ?? session?.model ?? ''),
      status: '空闲',
      turns: 0,
      tokens: 0
    };
    sessions.set(id, state);
  }
  if (resolvedTitle !== '') state.title = resolvedTitle;
  if (event?.type === 'user/message' && resolvedTitle === '' && state.fallbackTitle === '') {
    const text = messageText(event?.data?.message).replace(/\s+/g, ' ').trim();
    if (text !== '') {
      state.fallbackTitle = text.slice(0, 40);
      state.title = state.fallbackTitle;
    }
  }
  if (typeof session?.header?.model === 'string') state.model = session.header.model;
  const data = event?.data ?? {};
  switch (event?.type) {
    case 'turn/start':
      if (Number.isFinite(data.turn)) state.turns = data.turn;
      state.status = '思考中';
      break;
    case 'assistant/attempt':
      state.status = '思考中';
      break;
    case 'assistant/message': {
      state.status = '输出中';
      const usage = data.usage;
      const total =
        Number(usage?.totalTokens) ||
        (Number(usage?.inputTokens) || 0) + (Number(usage?.outputTokens) || 0);
      if (Number.isFinite(total) && total > 0) state.tokens += total;
      break;
    }
    case 'tool/call':
      state.status = `调用 ${String(data.name ?? '工具')}`;
      break;
    case 'tool/result':
      state.status = '思考中';
      break;
    case 'turn/end':
      state.status = '空闲';
      break;
    case 'model/selection':
      state.model = String(data.model?.id ?? data.model ?? data.id ?? state.model);
      break;
    default:
      break;
  }
  scheduleFloatingWrite();
}

function openOutside(entry) {
  if (entry.outside === 'window') {
    openNative(entry);
    return;
  }
  if (entry.outside === 'notification') showNotification(entry);
}

function openNative(entry) {
  if (entry.settled || entry.native !== null) return;
  if (nativeOwner !== null && nativeOwner !== entry) return;
  nativeOwner = entry;
  const dialog = showDialog(entry);
  entry.native = dialog;
  dialog.promise.then((result) => {
    if (entry.native === dialog) entry.native = null;
    if (nativeOwner === entry) nativeOwner = null;
    if (!entry.settled && result.kind !== 'unavailable' && result.kind !== 'cancelled') {
      settle(entry, result.kind);
    }
  });
}

function createPending(request) {
  const meta = metaFor(request);
  const key = `approval-${++nextKey}`;
  const completion = Promise.withResolvers();
  const entry = {
    ...meta,
    key,
    displayReason: request?.displayReason,
    settled: false,
    resolve: completion.resolve,
    native: null,
    notification: null,
    notified: false,
    origin: '',
    lastPoll: 0
  };
  pending.set(key, entry);
  const tracked = sessions.get(entry.sessionId);
  if (tracked !== undefined) {
    tracked.status = '请求审批';
    scheduleFloatingWrite();
  }
  const timer = setTimeout(() => {
    if (!entry.settled && entry.lastPoll === 0) openOutside(entry);
  }, 4_000);
  request?.signal?.addEventListener(
    'abort',
    () => settle(entry, 'cancelled'),
    { once: true }
  );
  return completion.promise.finally(() => {
    clearTimeout(timer);
    if (entry.native !== null) {
      try {
        entry.native.cancel();
      } catch {}
    }
    if (entry.notification !== null) {
      try {
        entry.notification.kill();
      } catch {}
    }
    pending.delete(key);
    if (nativeOwner === entry) nativeOwner = null;
  });
}

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

/** Use the same Host/Origin/browser-login fence as the host's own API. */
function rejectUnadmitted(req, res, ctx) {
  let connection;
  try {
    connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  } catch {
    return false;
  }
  const gate = connection?.requestRejection;
  if (typeof gate !== 'function') return false;
  let status;
  try {
    status = gate.call(connection, req);
  } catch {
    status = 403;
  }
  if (status === undefined || status === null) return false;
  send(res, status === 401 ? 401 : 403, { ok: false });
  return true;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function route(req, res, ctx) {
  if (rejectUnadmitted(req, res, ctx)) return;
  if (req.method !== 'POST' || !LOOPBACK.has(req.socket.remoteAddress ?? '')) {
    send(res, 403, { ok: false });
    return;
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  readJson(req)
    .then((body) => {
      if (path === `${ROUTE}/settings/get`) {
        send(res, 200, { ok: true, settings: loadSettings() });
        return;
      }
      if (path === `${ROUTE}/settings/set`) {
        const saved = saveSettings(body?.settings);
        scheduleFloatingWrite();
        ensureOverlay();
        send(res, 200, { ok: true, settings: saved });
        return;
      }
      if (path === `${ROUTE}/poll`) {
        const nextVisible = body?.visible === true;
        if (nextVisible !== appVisible) {
          appVisible = nextVisible;
          scheduleFloatingWrite();
        }
        if (typeof body?.origin === 'string' && /^https?:\/\//.test(body.origin)) {
          appOrigin = body.origin;
        }
        const entry = [...pending.values()].find((candidate) => !candidate.settled);
        if (entry === undefined) {
          send(res, 200, { pending: null });
          return;
        }
        entry.lastPoll = Date.now();
        if (typeof body?.origin === 'string' && /^https?:\/\//.test(body.origin)) {
          entry.origin = body.origin;
        }
        // The in-app modal is global, so a visible app needs no system UI even
        // when another conversation is active. The outside strategy only runs
        // while the app is minimized or hidden.
        const background = body?.visible !== true;
        if (background) openOutside(entry);
        // Never close an already-open native dialog because a later poll reports
        // foreground: Electron can report a stale focus state, and the user may
        // still be looking at the system window. It closes on answer/abort.
        send(res, 200, { pending: publicPending(entry) });
        return;
      }
      if (path === `${ROUTE}/answer`) {
        const entry = pending.get(body?.key);
        if (entry === undefined) {
          send(res, 404, { ok: false });
          return;
        }
        if (!OUTCOMES.has(body?.outcome)) {
          send(res, 400, { ok: false });
          return;
        }
        settle(entry, body.outcome);
        send(res, 200, { ok: true });
        return;
      }
      send(res, 404, { ok: false });
    })
    .catch(() => send(res, 400, { ok: false }));
}

export function apply(ctx) {
  if (process.platform !== 'win32') return;

  const registered = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE,
    handler: (req, res) => route(req, res, ctx)
  });
  ctx.effect(
    () => () => {
      if (typeof registered === 'function') registered();
    },
    'approval-popup: bridge route'
  );

  ctx.on(
    'approval/request',
    function (request) {
      return createPending(request);
    },
    { prepend: true }
  );

  ctx.on(
    'tools/pre-execute',
    function (exec, next) {
      try {
        showQuestionNotification(exec);
      } catch {
        // A reminder must never block the tool pipeline.
      }
      return next();
    },
    { prepend: true }
  );

  // Some compositions provide ask_user_question outside this profile's tool
  // stack, so tools/pre-execute can be bypassed. These two seams cover that
  // case; duplicate call ids are suppressed by questionNotified.
  ctx.on(
    'user-questions/request',
    function (request, next) {
      try {
        notifyQuestion(
          request?.wait?.callId,
          'ask_user_question',
          { questions: request?.questions },
          request?.agent?.session
        );
      } catch {
        // A reminder must never block the question waterfall.
      }
      return typeof next === 'function' ? next() : undefined;
    },
    { prepend: true }
  );

  writeFloatingState();
  ensureOverlay();
  void refreshBalance(ctx);
  const balanceTimer = setInterval(() => {
    void refreshBalance(ctx);
  }, 5 * 60_000);
  balanceTimer.unref?.();
  const floatingHeartbeat = setInterval(writeFloatingState, 10_000);
  floatingHeartbeat.unref?.();
  ctx.effect(
    () => () => {
      clearInterval(floatingHeartbeat);
      clearInterval(balanceTimer);
      if (overlayChild !== null) {
        try {
          overlayChild.kill();
        } catch {}
        overlayChild = null;
      }
    },
    'approval-popup: status overlay process'
  );

  ctx.on('session/event', function (session, event) {
    try {
      updateSession(ctx, session, event);
    } catch {
      // Observational only.
    }
    if (event?.type !== 'tool/call' || event?.data?.name !== 'ask_user_question') return;
    try {
      notifyQuestion(event.data.callId, event.data.name, event.data.arguments, session);
    } catch {
      // Observational only.
    }
  });
}


