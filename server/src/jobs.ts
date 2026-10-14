import crypto from 'node:crypto';
import type { Candidate, ScanEvent } from '../../shared/types';

export const newId = (bytes = 9) => crypto.randomBytes(bytes).toString('base64url');

export class Job {
  readonly id = newId(12);
  readonly createdAt = Date.now();
  status: 'running' | 'done' | 'canceled' = 'running';
  events: ScanEvent[] = [];
  items = new Map<string, Candidate>();
  abort = new AbortController();
  /** Every media URL of this job: only these can be previewed or downloaded. */
  constructor(public sources: { id: string; url: string }[]) {}

  emit(ev: ScanEvent) {
    // nothing may follow job.done, or a poller that stopped at "done" would miss it
    if (this.status !== 'running' && ev.type !== 'job.done') return;
    if (this.events.length < 40000 || ev.type === 'job.done') this.events.push(ev);
  }

  addItems(list: Candidate[], max = 30000): Candidate[] {
    const out: Candidate[] = [];
    for (const c of list) {
      if (this.items.size >= max) break;
      this.items.set(c.id, c);
      out.push(c);
    }
    return out;
  }

  finish(status: 'done' | 'canceled') {
    if (this.status !== 'running') return;
    this.status = status;
    this.events.push({ type: 'job.done', status });
  }
}

export class JobStore {
  private jobs = new Map<string, Job>();
  constructor(
    private ttlMs: number,
    private maxJobs: number,
  ) {}

  /** A finished job rebuilt from a snapshot this server signed (see /v1/restore). */
  restore(sources: { id: string; url: string }[], items: Candidate[]): Job {
    const job = this.create(sources);
    job.addItems(items);
    job.finish('done');
    return job;
  }

  create(sources: { id: string; url: string }[]): Job {
    this.sweep();
    if (this.jobs.size >= this.maxJobs) {
      // drop the oldest finished job; if all are running, drop the oldest
      const sorted = [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
      const victim = sorted.find((j) => j.status !== 'running') ?? sorted[0];
      victim.abort.abort();
      this.jobs.delete(victim.id);
    }
    const job = new Job(sources);
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (now - job.createdAt > this.ttlMs) {
        job.abort.abort();
        this.jobs.delete(id);
      }
    }
  }

  size() {
    return this.jobs.size;
  }

  closeAll() {
    for (const j of this.jobs.values()) j.abort.abort();
    this.jobs.clear();
  }
}
