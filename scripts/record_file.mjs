import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAX_ITEMS = 200;
const ID_RE = /^[0-9a-f-]{8,}$/i;

function getStorePath() {
  const base =
    process.env.PLUGIN_DATA ||
    join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'finder-reveal');
  mkdirSync(base, { recursive: true });
  return join(base, 'recent_files.json');
}

function extractPath(args) {
  if (!args || typeof args !== 'object') return null;
  let raw = args.Path || args.TargetFile || args.path || args.targetFile;
  if (typeof raw !== 'string') return null;
  raw = raw.trim();
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    try {
      const parsed = JSON.parse(raw);
      raw = typeof parsed === 'string' ? parsed : raw.slice(1, -1);
    } catch {
      raw = raw.slice(1, -1);
    }
  }
  raw = raw.trim();
  if (!raw || !raw.startsWith('/')) return null;
  return resolve(raw);
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
    const convId = typeof payload.conversationId === 'string' ? payload.conversationId.trim() : '';
    const toolCall = payload.toolCall || {};
    const filePath = extractPath(toolCall.args);
    // Require a valid conversationId so entries never leak across sessions
    if (filePath && ID_RE.test(convId)) {
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
        conversationId: convId,
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
