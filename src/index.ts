import { createServer } from 'http';
import { FootballDataClient } from './apiClient';
import { config } from './config';
import { LEAGUE_NAME, MONITOR_NAME, SERVICE_ID } from './constants/branding';
import { startMiddaySummaryCron } from './dailyCron';
import { ResendEmailService } from './emailService';
import { JobStore } from './jobStore';
import { MatchScheduler } from './scheduler';
import { NodeScheduleAdapter } from './schedulerAdapter';
import { formatStartupEmailBody } from './utils/time';
import type { EmailService, FootballDataApi } from './types';

async function sendStartupTestEmail(
  emailService: EmailService,
  apiClient: FootballDataApi,
): Promise<void> {
  const nextMatch = await apiClient.getNextMatch();

  if (!nextMatch) {
    await emailService.send(
      `Prueba de ${MONITOR_NAME}`,
      `El monitor está activo. No hay partidos próximos programados en la ${LEAGUE_NAME}.`,
    );
    console.log('[monitor] Email de prueba enviado (sin próximos partidos).');
    return;
  }

  const body = formatStartupEmailBody(
    nextMatch.homeTeamName,
    nextMatch.awayTeamName,
    nextMatch.startTime,
  );

  await emailService.send(`Prueba de ${MONITOR_NAME}`, body);
  console.log('[monitor] Email de prueba enviado correctamente.');
}

async function startHealthServer(port: number): Promise<void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: SERVICE_ID }));
  });

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`[server] Health check disponible en http://localhost:${port}`);
      resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log(`[monitor] Iniciando monitor de la ${LEAGUE_NAME}`);

  const apiClient = new FootballDataClient();

  const emailService = new ResendEmailService({
    apiKey: config.resendApiKey,
    fromEmail: config.resendFromEmail,
    toEmail: config.notificationEmail,
  });

  await sendStartupTestEmail(emailService, apiClient);

  const jobStore = new JobStore(config.jobStorePath);

  const monitor = new MatchScheduler({
    apiClient,
    emailService,
    scheduler: new NodeScheduleAdapter(),
    jobStore,
    matchDurationMinutes: config.matchDurationMinutes,
    oneHourBeforeMinutes: config.oneHourBeforeMinutes,
    liveTrackingPollIntervalMs: config.liveTrackingPollIntervalMs,
  });

  startMiddaySummaryCron({ apiClient, emailService });

  await startHealthServer(config.port);
  await monitor.initialize();

  console.log('[monitor] Proceso en ejecución. Las notificaciones están programadas.');
}

main().catch((error) => {
  console.error('[monitor] Error fatal:', error);
  process.exit(1);
});
