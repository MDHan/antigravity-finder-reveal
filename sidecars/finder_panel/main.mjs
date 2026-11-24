import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE_EDIT_TOOLS = new Set([
  'write_file',
  'edit_file',
  'replace_file_content',
  'multi_replace_file_content',
]);
const ID_RE = /^[0-9a-f-]{8,}$/i;

const PROCESS_FILENAMES = new Set([
  'learning_proposal.md',
  'implementation_plan.md',
  'task.md',
  'walkthrough.md',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  '.ds_store',
]);

const SUPPORT_FILENAMES = new Set([
  'package.json',
  'sidecar.json',
  'hooks.json',
  'tsconfig.json',
  'jsconfig.json',
  'styles.css',
  'style.css',
]);

const SUPPORT_EXTS = new Set([
  '.log',
  '.tmp',
  '.bak',
  '.lock',
  '.map',
  '.ico',
  '.css',
]);

const DOC_EXTS = new Set(['.md', '.mdx', '.txt', '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.rtf', '.tex', '.org']);
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.zsh', '.bash', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.html', '.css', '.scss', '.sql', '.vue', '.svelte', '.rb', '.php']);
const CONFIG_EXTS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.xml', '.csv', '.tsv']);
const MEDIA_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.bmp', '.tiff', '.mp4', '.mov', '.mp3', '.wav', '.m4a']);

// Preferred apps by file group (shown at top of picker if installed on this Mac)
const RECOMMENDED_APPS = {
  doc: ['Typora', 'Obsidian', 'Visual Studio Code', 'Cursor', 'Antigravity', 'Preview', 'TextEdit', 'Pages', 'Microsoft Word', 'Microsoft PowerPoint', 'Keynote', 'WPS Office'],
  code: ['Visual Studio Code', 'Cursor', 'Antigravity', 'Zed', 'Sublime Text', 'Xcode', 'PyCharm', 'WebStorm', 'TextEdit'],
  config: ['Visual Studio Code', 'Cursor', 'Antigravity', 'Sublime Text', 'TextEdit', 'Microsoft Excel', 'Numbers'],
  media: ['Preview', 'Google Chrome', 'Safari', 'Figma', 'QuickTime Player', 'IINA'],
  other: ['Visual Studio Code', 'TextEdit', 'Preview', 'Finder'],
};

let cachedApps = null;
let cachedAppsAt = 0;

function listInstalledApps() {
  const now = Date.now();
  if (cachedApps && now - cachedAppsAt < 60_000) return cachedApps;

  const dirs = ['/Applications', join(homedir(), 'Applications'), '/System/Applications'];
  const found = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.app')) {
          found.add(entry.slice(0, -4));
        }
      }
    } catch {
      // Ignore unreadable app folders.
    }
  }
  cachedApps = Array.from(found).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  cachedAppsAt = now;
  return cachedApps;
}

function normalizeRawPath(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try {
      const parsed = JSON.parse(s);
      s = typeof parsed === 'string' ? parsed : s.slice(1, -1);
    } catch {
      s = s.slice(1, -1);
    }
  }
  s = s.trim();
  return s ? resolve(s) : null;
}

function getAppDataDir() {
  const fallback = join(homedir(), '.gemini', 'antigravity');
  return existsSync(fallback) ? fallback : null;
}

function getHookStorePath() {
  return join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'finder-reveal', 'recent_files.json');
}

function readHookRecords() {
  const storePath = getHookStorePath();
  if (!existsSync(storePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const cleanPath = normalizeRawPath(item?.path);
        if (!cleanPath) return null;
        return { ...item, path: cleanPath };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readTranscriptRecords(conversationId) {
  if (!conversationId || !ID_RE.test(conversationId)) return [];
  const appData = getAppDataDir();
  if (!appData) return [];
  const transcriptPath = join(appData, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!existsSync(transcriptPath)) return [];

  const records = [];
  try {
    const lines = readFileSync(transcriptPath, 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let step;
      try {
        step = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(step.tool_calls)) continue;
      const ts = step.created_at ? Date.parse(step.created_at) : Date.now();
      for (const tc of step.tool_calls) {
        if (!tc || !FILE_EDIT_TOOLS.has(tc.name)) continue;
        const args = tc.args || {};
        const cleanPath = normalizeRawPath(
          args.Path || args.TargetFile || args.path || args.targetFile,
        );
        if (!cleanPath) continue;
        records.push({
          path: cleanPath,
          tool: tc.name,
          conversationId,
          updatedAt: Number.isFinite(ts) ? ts : Date.now(),
        });
      }
    }
  } catch {
    return [];
  }
  return records;
}

function shortenHome(p) {
  const home = homedir();
  if (p === home) return '~';
  if (p.startsWith(home + '/')) return '~/' + p.slice(home.length + 1);
  return p;
}

function detectFileType(filePath) {
  const base = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();

  if (base === 'skill.md' || base === 'gemini.md' || base === 'agents.md' || base === 'plugin.json') {
    return 'config';
  }
  if (DOC_EXTS.has(ext)) return 'doc';
  if (CODE_EXTS.has(ext)) return 'code';
  if (CONFIG_EXTS.has(ext)) return 'config';
  if (MEDIA_EXTS.has(ext)) return 'media';
  return 'other';
}

function classifyFile(filePath, exists) {
  const fileType = detectFileType(filePath);
  if (!exists) return { category: 'secondary', fileType, tag: '已移除' };

  const lowerPath = filePath.toLowerCase();
  const base = basename(filePath).toLowerCase();
  const ext = extname(filePath).toLowerCase();

  if (
    lowerPath.includes('/.gemini/antigravity/brain/') ||
    lowerPath.includes('/.system_generated/') ||
    lowerPath.includes('/scratch/') ||
    lowerPath.startsWith('/tmp/') ||
    lowerPath.startsWith('/private/tmp/') ||
    PROCESS_FILENAMES.has(base)
  ) {
    return { category: 'secondary', fileType, tag: '过程文件' };
  }

  if (
    SUPPORT_FILENAMES.has(base) ||
    SUPPORT_EXTS.has(ext) ||
    lowerPath.includes('/assets/') ||
    lowerPath.includes('/node_modules/')
  ) {
    return { category: 'secondary', fileType, tag: '辅助文件' };
  }

  if (lowerPath.includes('/.gemini/config/plugins/')) {
    if (base === 'plugin.json' || base === 'readme.md' || base === 'skill.md') {
      return { category: 'primary', fileType, tag: '插件入口' };
    }
    return { category: 'secondary', fileType, tag: '插件内部' };
  }

  if (base === 'skill.md' || base === 'gemini.md' || base === 'agents.md') {
    return { category: 'primary', fileType, tag: '核心技能' };
  }

  return { category: 'primary', fileType, tag: '' };
}

function buildFilesList(conversationId, scope) {
  const hookRecords = readHookRecords();
  const transcriptRecords = readTranscriptRecords(conversationId);

  const merged = [...transcriptRecords, ...hookRecords];
  const filtered =
    scope === 'current' && conversationId
      ? merged.filter((r) => r.conversationId === conversationId)
      : merged;

  const byPath = new Map();
  for (const item of filtered) {
    if (!item || typeof item.path !== 'string') continue;
    const prev = byPath.get(item.path);
    if (!prev || (item.updatedAt || 0) > (prev.updatedAt || 0)) {
      byPath.set(item.path, item);
    }
  }

  const items = Array.from(byPath.values())
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 120)
    .map((item) => {
      let exists = false;
      let isDir = false;
      try {
        const st = statSync(item.path);
        exists = true;
        isDir = st.isDirectory();
      } catch {
        exists = false;
      }
      const { category, fileType, tag } = classifyFile(item.path, exists);
      return {
        path: item.path,
        name: basename(item.path),
        dir: shortenHome(dirname(item.path)),
        ext: extname(item.path).toLowerCase(),
        tool: item.tool || 'edit',
        conversationId: item.conversationId || '',
        isCurrentConversation: Boolean(conversationId && item.conversationId === conversationId),
        updatedAt: item.updatedAt || 0,
        exists,
        isDir,
        category,
        fileType,
        tag,
      };
    });

  return {
    conversationId,
    scope,
    platform: process.platform,
    items,
  };
}

function runOpen(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    execFile(cmd, args, (err) => {
      if (err) rejectPromise(err);
      else resolvePromise();
    });
  });
}

const app = new SidecarApp();

app.page('/', () => new Response(readFileSync(join(__dirname, 'index.html'), 'utf-8'), { contentType: 'text/html; charset=utf-8' }));
app.page('/styles.css', () => new Response(readFileSync(join(__dirname, 'styles.css'), 'utf-8'), { contentType: 'text/css; charset=utf-8' }));
app.page('/app.js', () => new Response(readFileSync(join(__dirname, 'app.js'), 'utf-8'), { contentType: 'application/javascript; charset=utf-8' }));

app.api(
  '/api/files',
  async (data) => {
    const convId =
      (typeof data?.conversationId === 'string' && data.conversationId.trim()) ||
      app.config.conversationId ||
      '';
    const scope = data?.scope === 'all' ? 'all' : 'current';
    return buildFilesList(convId, scope);
  },
  'GET',
);

app.api(
  '/api/apps',
  async (data) => {
    const fileType = typeof data?.fileType === 'string' ? data.fileType : 'other';
    const allApps = listInstalledApps();
    const installedSet = new Set(allApps);
    const prefs = RECOMMENDED_APPS[fileType] || RECOMMENDED_APPS.other;
    const recommended = prefs.filter((name) => installedSet.has(name));
    const recSet = new Set(recommended);
    const others = allApps.filter((name) => !recSet.has(name));
    return { recommended, others };
  },
  'GET',
);

app.api(
  '/api/reveal',
  async (data) => {
    const target = normalizeRawPath(data?.path);
    if (!target) throw new Error('Missing file path');
    const mode = data?.mode || 'reveal';
    const appName = typeof data?.appName === 'string' ? data.appName.trim() : '';

    if (mode === 'open') {
      if (!existsSync(target)) throw new Error('文件不存在，无法打开');
      if (process.platform === 'darwin') {
        const args = appName ? ['-a', appName, target] : [target];
        await runOpen(args);
      } else {
        await runOpen([target]);
      }
      return { ok: true, opened: target, appName: appName || '默认应用' };
    }

    if (mode === 'dir') {
      const dir = existsSync(target) && statSync(target).isDirectory() ? target : dirname(target);
      if (!existsSync(dir)) throw new Error('Directory does not exist');
      await runOpen([dir]);
      return { ok: true, revealed: dir };
    }

    if (existsSync(target)) {
      const args = process.platform === 'darwin' ? ['-R', target] : process.platform === 'win32' ? [`/select,${target}`] : [dirname(target)];
      await runOpen(args);
      return { ok: true, revealed: target };
    }

    const parent = dirname(target);
    if (existsSync(parent)) {
      await runOpen([parent]);
      return { ok: true, revealed: parent, fallbackToParent: true };
    }
    throw new Error('File and parent directory do not exist');
  },
  'POST',
);

app.run();
