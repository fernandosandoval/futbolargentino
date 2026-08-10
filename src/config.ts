import dotenv from 'dotenv';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable de entorno requerida no definida: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  resendApiKey: requireEnv('RESEND_API_KEY'),
  resendFromEmail: requireEnv('RESEND_FROM_EMAIL'),
  notificationEmail: requireEnv('NOTIFICATION_EMAIL'),
  port: Number(optionalEnv('PORT', '3000')),
  matchDurationMinutes: 115,
  oneHourBeforeMinutes: 60,
  liveTrackingPollIntervalMs: Number(optionalEnv('LIVE_POLL_INTERVAL_MS', '60000')),
  jobStorePath: optionalEnv('JOB_STORE_PATH', 'data/jobs.json'),
};
