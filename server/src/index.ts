import { createApp } from './app';
import { closeDeep } from './extract/deep';

const { app, cfg, close } = await createApp();

const stop = async () => {
  await close();
  await closeDeep();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: cfg.port, host: cfg.host });
console.log(`GRAB server ${cfg.version} listening on ${cfg.host}:${cfg.port}`);
