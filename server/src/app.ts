import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { ApiError, CreateScanRequest, CreateScanResponse, HealthResponse, PollResponse, ReasonCode, ScanOptions } from '../../shared/types';
import { parseUrlInput } from '../../shared/urls';
import { loadConfig, type Config } from './config';
import { deepAvailable } from './extract/deep';
import { JobStore } from './jobs';
import { buildFile, buildPreview, getSharp, type MediaResponse } from './media';
import { RobotsCache } from './net/robots';
import { GrabError, SafeFetcher } from './net/safeFetch';
import { runScan, type RunnerDeps } from './runner';

const STATUS: Partial<Record<ReasonCode, number>> = {
  INVALID_URL: 400,
  BLOCKED_TARGET: 403,
  ROBOTS_DISALLOWED: 403,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  NOT_MEDIA: 415,
  NOT_DIRECT_MEDIA: 422,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  CANCELED: 499,
};

function sendError(reply: FastifyReply, code: ReasonCode, message: string, extra: object = {}) {
  const body: ApiError & object = { error: { code, message }, ...extra };
  return reply.code(STATUS[code] ?? 502).send(body);
}

function sendMedia(reply: FastifyReply, m: MediaResponse) {
  for (const [k, v] of Object.entries(m.headers)) reply.header(k, v);
  return reply.code(m.status).send(m.body);
}

export interface AppHandle {
  app: FastifyInstance;
  cfg: Config;
  jobs: JobStore;
  close: () => Promise<void>;
}

export async function createApp(overrides: Partial<Config> = {}): Promise<AppHandle> {
  const cfg = loadConfig(overrides);
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: 64 * 1024,
    trustProxy: process.env.GRAB_TRUST_PROXY === '1',
  });
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'OPTIONS'], maxAge: 600, exposedHeaders: ['x-grab-width', 'x-grab-height', 'x-grab-bytes', 'content-disposition'] });
  await app.register(rateLimit, { max: cfg.rateLimitPerMinute, timeWindow: '1 minute' });

  const fetcher = new SafeFetcher(cfg);
  const robots = new RobotsCache(fetcher, cfg);
  const jobs = new JobStore(cfg.jobTtlMs, cfg.maxJobs);
  const deps: RunnerDeps = { cfg, fetcher, robots };
  const sweeper = setInterval(() => jobs.sweep(), 60_000);
  sweeper.unref();

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GrabError) return sendError(reply, err.code, err.message);
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return sendError(reply, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
    if (status === 413) return sendError(reply, 'TOO_LARGE', 'That request is too large.');
    if (status && status >= 400 && status < 500) return sendError(reply, 'INVALID_URL', 'The request was not valid.');
    app.log.error(err);
    return sendError(reply, 'INTERNAL', 'Something went wrong on the server.');
  });
  app.setNotFoundHandler((_req, reply) => sendError(reply, 'NOT_FOUND', 'Not found.'));

  app.get('/v1/health', async (): Promise<HealthResponse> => ({
    ok: true,
    version: cfg.version,
    features: { thumbnails: !!(await getSharp()), deepScan: await deepAvailable() },
    limits: {
      maxUrlsPerScan: cfg.maxUrlsPerScan,
      maxPagesPerSite: cfg.maxPagesPerSite,
      maxImageMb: Math.round(cfg.maxImageBytes / 1048576),
      maxVideoMb: Math.round(cfg.maxVideoBytes / 1048576),
    },
  }));

  app.post('/v1/scans', { config: { rateLimit: { max: cfg.scanRateLimitPerMinute, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = (req.body ?? {}) as Partial<CreateScanRequest>;
    if (!Array.isArray(body.urls) || body.urls.length === 0 || body.urls.length > 40 || body.urls.some((u) => typeof u !== 'string' || u.length > 2048)) {
      return sendError(reply, 'INVALID_URL', 'Send a list of links to scan.');
    }
    const parsed = parseUrlInput(body.urls.join(' '), cfg.maxUrlsPerScan);
    const rejected = [...parsed.invalid];
    const sources: { id: string; url: string }[] = [];
    for (const url of parsed.valid) {
      try {
        fetcher.validateUrl(url);
        sources.push({ id: `s${sources.length}`, url });
      } catch (err) {
        rejected.push({ input: url, code: err instanceof GrabError ? err.code : 'INVALID_URL' });
      }
    }
    if (!sources.length) {
      return sendError(reply, 'INVALID_URL', 'None of those links can be scanned.', { rejected });
    }
    const pages = Math.max(1, Math.min(cfg.maxPagesPerSite, Math.floor(Number(body.options?.pages) || 1)));
    const options: ScanOptions = { deep: body.options?.deep === true, pages };
    const job = jobs.create(sources);
    void runScan(job, options, deps).catch(() => job.finish('done'));
    const res: CreateScanResponse = { jobId: job.id, sources, rejected };
    return reply.code(201).send(res);
  });

  app.get<{ Params: { id: string }; Querystring: { since?: string } }>('/v1/scans/:id', async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return sendError(reply, 'NOT_FOUND', 'This scan expired. Start it again.');
    const since = Math.max(0, Number(req.query.since) || 0);
    const events = job.events.slice(since, since + 500);
    const next = since + events.length;
    const status: PollResponse['status'] = job.status !== 'running' && next < job.events.length ? 'running' : job.status;
    const res: PollResponse = { status, next, events };
    return reply.header('cache-control', 'no-store').send(res);
  });

  app.post<{ Params: { id: string } }>('/v1/scans/:id/cancel', async (req, reply) => {
    const job = jobs.get(req.params.id);
    if (!job) return reply.send({ ok: true }); // idempotent
    job.abort.abort(); // the runner notices, stops, and closes the job with job.done = canceled
    return reply.send({ ok: true });
  });

  app.get<{ Params: { id: string; iid: string }; Querystring: { w?: string; fmt?: string } }>('/v1/scans/:id/items/:iid/preview', async (req, reply) => {
    const job = jobs.get(req.params.id);
    const cand = job?.items.get(req.params.iid);
    if (!job || !cand) return sendError(reply, 'NOT_FOUND', 'This item expired. Scan again.');
    const m = await buildPreview(cand, Number(req.query.w) || 360, req.query.fmt === 'png' ? 'png' : 'webp', { fetcher, cfg, signal: job.abort.signal });
    return sendMedia(reply, m);
  });

  app.get<{ Params: { id: string; iid: string }; Querystring: { download?: string; figma?: string; hd?: string } }>('/v1/scans/:id/items/:iid/file', async (req, reply) => {
    const job = jobs.get(req.params.id);
    const cand = job?.items.get(req.params.iid);
    if (!job || !cand) return sendError(reply, 'NOT_FOUND', 'This item expired. Scan again.');
    const m = await buildFile(cand, { figma: req.query.figma === '1', download: req.query.download === '1', hd: req.query.hd === '1' }, { fetcher, cfg });
    return sendMedia(reply, m);
  });

  return {
    app,
    cfg,
    jobs,
    close: async () => {
      clearInterval(sweeper);
      jobs.closeAll();
      await app.close();
      await fetcher.close();
    },
  };
}
