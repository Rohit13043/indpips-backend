import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  mt5Adapter: process.env.MT5_ADAPTER ?? 'mock',
  eaBridgeSecret: process.env.EA_BRIDGE_SECRET ?? 'change-me',
  syncIntervalMs: Number(process.env.SYNC_INTERVAL_MS ?? 60000),
};
