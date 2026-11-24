import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const MAX_ITEMS = 200;

function getStorePath() {
  const base =
    process.env.PLUGIN_DATA ||
    join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'finder-reveal');
  mkdirSync(base, { recursive: true });
  return join(base, 'recent_files.json');
}

function extractPath(args) {
  if (!args || typeof args !== 'object') return null;
  const raw = args.Path || args.TargetFile || args.path || args.targetFile;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return resolve(raw.trim());
}

let input = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  try {
    const payload = input.trim() ? JSON.parse(input) : {};
    if (payload.error) {
      process.stdout.write('{}\n');
      return;
    }
    const toolCall = payload.toolCall || {};
    const filePath = extractPath(toolCall.args);
    if (filePath) {
      const storePath = getStorePath();
      let list = [];
      if (existsSync(storePath)) {
        try {
          const parsed = JSON.parse(readFileSync(storePath, 'utf-8'));
          if (Array.isArray(parsed)) list = parsed;
        } catch {
          list = [];
        }
      }
      const entry = {
        path: filePath,
        tool: toolCall.name || 'edit',
        conversationId: payload.conversationId || '',
        updatedAt: Date.now(),
      };
      const filtered = list.filter(
        (item) => !(item.path === entry.path && item.conversationId === entry.conversationId),
      );
      filtered.unshift(entry);
      writeFileSync(storePath, JSON.stringify(filtered.slice(0, MAX_ITEMS), null, 2), 'utf-8');
    }
  } catch {
    // Never block tool execution on logging failure.
  }
  process.stdout.write('{}\n');
});
