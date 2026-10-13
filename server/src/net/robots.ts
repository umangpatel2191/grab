import type { Config } from '../config';
import type { SafeFetcher } from './safeFetch';

interface Rule {
  allow: boolean;
  path: string;
}

/** Minimal robots.txt parser: User-agent groups, Allow/Disallow, longest match wins. */
export function parseRobots(text: string, agents: string[]): Rule[] {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      if (current) current.rules.push({ allow: key === 'allow', path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const lowered = agents.map((a) => a.toLowerCase());
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && lowered.some((x) => x.includes(a))));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function toRegex(path: string): RegExp {
  const esc = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + esc.replace(/\\\$$/, '$'));
}

export function isAllowedByRules(rules: Rule[], pathAndQuery: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const r of rules) {
    if (!r.path) continue; // empty Disallow means allow all
    if (toRegex(r.path).test(pathAndQuery)) {
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { len, allow: r.allow };
    }
  }
  return best ? best.allow : true;
}

export class RobotsCache {
  private cache = new Map<string, { rules: Rule[]; at: number }>();
  constructor(
    private fetcher: SafeFetcher,
    private cfg: Config,
  ) {}

  async isAllowed(url: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.cfg.respectRobots) return true;
    const u = new URL(url);
    const key = u.origin;
    const hit = this.cache.get(key);
    let rules: Rule[];
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) {
      rules = hit.rules;
    } else {
      try {
        const res = await this.fetcher.fetchBuffer(`${u.origin}/robots.txt`, {
          maxBytes: 256 * 1024,
          timeoutMs: 5000,
          signal,
          accept: 'text/plain',
        });
        rules = parseRobots(res.body.toString('utf8'), ['grab']);
      } catch {
        rules = []; // missing or unreachable robots.txt means allowed
      }
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(key, { rules, at: Date.now() });
    }
    return isAllowedByRules(rules, u.pathname + u.search);
  }
}
