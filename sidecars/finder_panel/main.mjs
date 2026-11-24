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
const MAX_RECENT_CONVERSATIONS = 15;

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

const SLIDES_EXTS = new Set(['.pptx', '.ppt', '.key', '.odp']);
const PDF_EXTS = new Set(['.pdf']);
const OFFICE_EXTS = new Set(['.docx', '.doc', '.pages', '.rtf', '.odt']);
const LATEX_EXTS = new Set(['.tex', '.bib', '.cls', '.sty', '.bst']);
const DATA_EXTS = new Set(['.xlsx', '.xls', '.numbers', '.csv', '.tsv', '.parquet', '.jsonl', '.db', '.sqlite']);
const MARKDOWN_EXTS = new Set(['.md', '.mdx', '.txt', '.org', '.rst']);
const WEB_EXTS = new Set(['.html', '.htm', '.xhtml', '.mhtml']);
const CODE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.ipynb', '.sh', '.zsh', '.bash', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.sql', '.vue', '.svelte', '.rb', '.php']);
const CONFIG_EXTS = new Set(['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.xml']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.bmp', '.tiff', '.heic', '.eps']);
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm', '.m4v']);

// Preferred apps by file group (shown at top of picker if installed on this Mac)
const RECOMMENDED_APPS = {
  slides: ['Microsoft PowerPoint', 'Keynote', 'WPS Office', 'Preview'],
  pdf: ['Preview', 'Adobe Acrobat', 'Skim', 'Google Chrome', 'Safari'],
  office: ['Microsoft Word', 'Pages', 'WPS Office', 'TextEdit'],
  latex: ['Visual Studio Code', 'Cursor', 'Antigravity', 'TeXShop', 'Texifier', 'Texpad', 'Sublime Text', 'TextEdit'],
  data: ['Microsoft Excel', 'Numbers', 'WPS Office', 'Visual Studio Code', 'Cursor'],
  markdown: ['Typora', 'Obsidian', 'Visual Studio Code', 'Cursor', 'Antigravity', 'TextEdit'],
  web: ['Google Chrome', 'Safari', 'Arc', 'Firefox', 'Microsoft Edge', 'Visual Studio Code', 'Cursor'],
  code: ['Visual Studio Code', 'Cursor', 'Antigravity', 'Zed', 'Sublime Text', 'Xcode', 'PyCharm', 'WebStorm', 'TextEdit'],
  config: ['Visual Studio Code', 'Cursor', 'Antigravity', 'Sublime Text', 'TextEdit'],
  image: ['Preview', 'Figma', 'Google Chrome', 'Safari', 'Photos'],
  audio: ['QuickTime Player', 'IINA', 'VLC', 'Audacity', 'Music'],
  video: ['QuickTime Player', 'IINA', 'VLC', 'Google Chrome'],
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
  if (!s || !s.startsWith('/')) return null;
  return resolve(s);
}

function parseFileUri(rawUriPath) {
  if (typeof rawUriPath !== 'string') return null;
  // Strip line-number anchor or query string if present
  let cleaned = rawUriPath.replace(/[#?].*$/, '').replace(/[),.;:]+$/, '');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // Keep as-is if malformed percent-encoding.
  }
  return normalizeRawPath('/' + cleaned.replace(/^\/+/, ''));
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
        const convId = typeof item?.conversationId === 'string' ? item.conversationId.trim() : '';
        if (!cleanPath || !ID_RE.test(convId)) return null;
        return { ...item, path: cleanPath, conversationId: convId };
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
      const ts = step.created_at ? Date.parse(step.created_at) : Date.now();
      const updatedAt = Number.isFinite(ts) ? ts : Date.now();

      // 1. Direct file-edit tool calls (write_file, edit_file, etc.)
      if (Array.isArray(step.tool_calls)) {
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
            updatedAt,
          });
        }
      }

      // 2. Assistant-delivered file:// links in PLANNER_RESPONSE.content
      //    (captures files generated/modified via run_command scripts such as .pptx, .pdf, .docx, etc.)
      if (step.type === 'PLANNER_RESPONSE' && typeof step.content === 'string' && step.content.includes('file:///')) {
        for (const m of step.content.matchAll(/file:\/\/\/([^)\s"<>]+)/g)) {
          const cleanPath = parseFileUri(m[1]);
          if (!cleanPath) continue;
          records.push({
            path: cleanPath,
            tool: 'file_link',
            conversationId,
            updatedAt,
          });
        }
      }
    }
  } catch {
    return [];
  }
  return records;
}

function readRecentConversationsTranscripts() {
  const appData = getAppDataDir();
  if (!appData) return [];
  const brainDir = join(appData, 'brain');
  if (!existsSync(brainDir)) return [];

  const convs = [];
  try {
    for (const entry of readdirSync(brainDir)) {
      if (!ID_RE.test(entry)) continue;
      const tPath = join(brainDir, entry, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const st = statSync(tPath);
        convs.push({ id: entry, mtimeMs: st.mtimeMs });
      } catch {
        // Ignore conversations without transcript.
      }
    }
  } catch {
    return [];
  }

  convs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const allRecords = [];
  for (const conv of convs.slice(0, MAX_RECENT_CONVERSATIONS)) {
    allRecords.push(...readTranscriptRecords(conv.id));
  }
  return allRecords;
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

  if (base === 'plugin.json') {
    return 'config';
  }
  if (SLIDES_EXTS.has(ext)) return 'slides';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (OFFICE_EXTS.has(ext)) return 'office';
  if (LATEX_EXTS.has(ext)) return 'latex';
  if (DATA_EXTS.has(ext)) return 'data';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (WEB_EXTS.has(ext)) return 'web';
  if (CODE_EXTS.has(ext)) return 'code';
  if (CONFIG_EXTS.has(ext)) return 'config';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (VIDEO_EXTS.has(ext)) return 'video';
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

export function buildFilesList(conversationId, scope) {
  const validConvId = typeof conversationId === 'string' && ID_RE.test(conversationId.trim())
    ? conversationId.trim()
    : '';

  let filtered = [];
  if (scope === 'current') {
    // Strict session isolation: never fall back to other conversations if conversationId is absent.
    if (!validConvId) {
      return { conversationId: '', scope: 'current', platform: process.platform, items: [] };
    }
    const transcriptRecords = readTranscriptRecords(validConvId);
    const hookRecords = readHookRecords().filter((r) => r.conversationId === validConvId);
    filtered = [...transcriptRecords, ...hookRecords];
  } else {
    const recentTranscripts = readRecentConversationsTranscripts();
    const hookRecords = readHookRecords();
    filtered = [...recentTranscripts, ...hookRecords];
  }

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
      // Skip non-existent file_link mentions (e.g., example paths in markdown docs)
      if (!exists && item.tool === 'file_link') return null;

      const { category, fileType, tag } = classifyFile(item.path, exists);
      return {
        path: item.path,
        name: basename(item.path),
        dir: shortenHome(dirname(item.path)),
        ext: extname(item.path).toLowerCase(),
        tool: item.tool || 'edit',
        conversationId: item.conversationId || '',
        isCurrentConversation: Boolean(validConvId && item.conversationId === validConvId),
        updatedAt: item.updatedAt || 0,
        exists,
        isDir,
        category,
        fileType,
        tag,
      };
    })
    .filter(Boolean);

  return {
    conversationId: validConvId,
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

if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
  const app = new SidecarApp();

  app.page('/', () => new Response(readFileSync(join(__dirname, 'index.html'), 'utf-8'), { contentType: 'text/html; charset=utf-8' }));
  app.page('/styles.css', () => new Response(readFileSync(join(__dirname, 'styles.css'), 'utf-8'), { contentType: 'text/css; charset=utf-8' }));
  app.page('/app.js', () => new Response(readFileSync(join(__dirname, 'app.js'), 'utf-8'), { contentType: 'application/javascript; charset=utf-8' }));

  app.api(
    '/api/files',
    async (data) => {
      // Strictly use the requesting iframe's own conversationId (never fallback to shared process env)
      const convId = typeof data?.conversationId === 'string' ? data.conversationId.trim() : '';
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
}
