/**
 * 会话状态面板 —— 宿主半区。
 *
 * 只做一件事：注册一个**只读**的 git 状态路由，供本包浏览器半区拉取。
 * 为什么需要宿主：DSH 客户端没有 git 投影、也没有 git 服务（Service 目录里没有
 * `git`/`vcs`）；`workspaceChanges` 是"本会话文件改动"而不是 git 状态。所以由宿主用
 * `ctx.shell` 在**该会话的工作目录**跑 `git status --porcelain=v2 --branch` 与
 * `git diff HEAD --numstat`，解析成 JSON 返回。
 *
 * 安全（与 dsh-whale-widget 同一套做法）：
 *   - 只接受 GET；
 *   - 自带回环 Host / 同源 Origin / `sec-fetch-site` 校验，任何解析异常一律拒绝（fail-closed）；
 *   - 只读命令，不写任何东西；
 *   - 宿主 connection 栅栏可用时本可以委托它，但那是一个 Remote 面，这里用最小自校验即可，
 *     因为它只泄露本机可见的 git 摘要。
 */

export const name = 'dsh-session-status-panel';

/** 需要的能力：路由载体、跑 git、按 sessionId 找会话工作目录。 */
export const inject = ['webServer', 'shell', 'sessions', 'sandboxPolicy'];

const ROUTE = '/dsh-session-status-panel/git';
/** stdout 里分隔两段 git 输出的标记。 */
const MARKER = '###DSH_STATUS_PANEL_NUMSTAT###';
/** git 命令超时（毫秒）。 */
const GIT_TIMEOUT_MS = 5000;
/** stdout 上限（字节），避免仓库巨大时把内存拖爆。 */
const STDOUT_MAX_BYTES = 256 * 1024;

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

/** 自校验：返回 HTTP 状态码表示拒绝，返回 null 表示放行。fail-closed。 */
function rejection(req) {
  try {
    const headers = (req && req.headers) || {};
    let hostUrl = null;
    try {
      hostUrl = new URL('http://' + String(headers.host || ''));
    } catch (error) {
      return 403; // 缺 Host / 畸形 Host
    }
    if (!isLoopbackHostname(hostUrl.hostname)) return 403;
    const site = String(headers['sec-fetch-site'] || '').toLowerCase();
    if (site === 'cross-site') return 403;
    const origin = headers.origin;
    if (typeof origin === 'string' && origin && origin !== 'null') {
      let originUrl = null;
      try {
        originUrl = new URL(origin);
      } catch (error) {
        return 403;
      }
      if (originUrl.host.toLowerCase() !== hostUrl.host.toLowerCase()) return 403;
    }
    return null;
  } catch (error) {
    return 403;
  }
}

function sendJson(res, status, value) {
  let body = '{}';
  try {
    body = JSON.stringify(value);
  } catch (error) {
    body = JSON.stringify({ error: 'response not serializable' });
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** 解析 `git status --porcelain=v2 --branch`。 */
function parseStatus(text) {
  const result = { isRepository: true, branch: null, ahead: 0, behind: 0, dirtyCount: 0 };
  const lines = String(text || '').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      result.branch = head && head !== '(detached)' ? head : null;
    } else if (line.startsWith('# branch.ab ')) {
      const matched = /\+(\d+)\s+-(\d+)/.exec(line);
      if (matched) {
        result.ahead = Number(matched[1]) || 0;
        result.behind = Number(matched[2]) || 0;
      }
    } else if (line.length > 0 && !line.startsWith('#')) {
      // 普通改动 / 重命名 / 未合并 / 未跟踪（`? path`）都算一行改动。
      result.dirtyCount += 1;
    }
  }
  return result;
}

/** 解析 `git diff HEAD --numstat` 的增删行数（二进制文件是 `-`，跳过）。 */
function parseNumstat(text) {
  let added = 0;
  let removed = 0;
  for (const rawLine of String(text || '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const plus = Number(parts[0]);
    const minus = Number(parts[1]);
    if (Number.isFinite(plus)) added += plus;
    if (Number.isFinite(minus)) removed += minus;
  }
  return { added, removed };
}

/**
 * 注册只读 git 状态路由。
 * @param ctx - host 上下文（webServer / shell / sessions / sandboxPolicy）。
 */
export function apply(ctx) {
  const disposer = ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      const denied = rejection(req);
      if (denied !== null) {
        try {
          res.statusCode = denied;
          res.end();
        } catch (error) {
          /* 响应已断开 */
        }
        return;
      }
      try {
        if (String(req.method || 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const url = new URL('http://localhost' + String(req.url || ''));
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { error: 'sessionId required' });
          return;
        }
        const session = ctx.sessions.get(sessionId);
        const cwd = (session && session.cwd) || ctx.sandboxPolicy.workspaceRoot;
        if (!cwd) {
          sendJson(res, 200, { isRepository: false, reason: 'no-working-directory' });
          return;
        }
        const spec = ctx.shell.resolve({
          // 两段输出用一个标记分隔；`;` 与 `echo` 在 pwsh 与 bash 下都成立。
          command:
            'git status --porcelain=v2 --branch; echo ' + MARKER + '; git diff HEAD --numstat',
          workdir: cwd,
          timeoutMs: GIT_TIMEOUT_MS,
          onExpiry: 'kill',
          stdoutMaxBytes: STDOUT_MAX_BYTES,
        });
        const execution = await ctx.shell.execute(spec);
        const run = await execution.result();
        const stdout = (run && run.stdout && run.stdout.text) || '';
        const exitCode = run && typeof run.exitCode === 'number' ? run.exitCode : null;
        const markerAt = stdout.indexOf(MARKER);
        const statusText = markerAt >= 0 ? stdout.slice(0, markerAt) : stdout;
        const numstatText = markerAt >= 0 ? stdout.slice(markerAt + MARKER.length) : '';
        if (statusText.indexOf('# branch.') < 0) {
          // 不是 git 仓库，或 git 不可用：如实返回，不猜。
          sendJson(res, 200, { isRepository: false, reason: 'not-a-repository', exitCode });
          return;
        }
        const summary = parseStatus(statusText);
        const numstat = parseNumstat(numstatText);
        sendJson(
          res,
          200,
          Object.assign({}, summary, numstat, {
            exitCode,
            truncated: Boolean(run && run.stdout && run.stdout.truncated),
          }),
        );
      } catch (error) {
        sendJson(res, 500, { error: String((error && error.message) || error) });
      }
    },
  });
  ctx.effect(() => disposer);
}
