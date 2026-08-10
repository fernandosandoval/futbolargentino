import 'dotenv/config';
import { FootballDataClient } from './apiClient';
import { config } from './config';
import { ResendEmailService } from './emailService';
import { escapeHtml } from './utils/emailTemplates';
import { translateTeamName } from './utils/translations';

const TEST_SUBJECT = '✅ Prueba de Sistema - Fútbol Argentino';

function buildTestEmailHtml(homeTeamName: string, awayTeamName: string): string {
  const home = escapeHtml(translateTeamName(homeTeamName));
  const away = escapeHtml(translateTeamName(awayTeamName));

  return `<!DOCTYPE html>
<html lang="es">
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
    <p>¡El sistema está funcionando con ESPN! El próximo partido es: <strong>${home} vs ${away}</strong>.</p>
  </body>
</html>`;
}

function buildTestEmailText(homeTeamName: string, awayTeamName: string): string {
  const home = translateTeamName(homeTeamName);
  const away = translateTeamName(awayTeamName);
  return `¡El sistema está funcionando con ESPN! El próximo partido es: ${home} vs ${away}.`;
}

async function main(): Promise<void> {
  console.log('[test-email] Consultando próximo partido en ESPN...');

  const apiClient = new FootballDataClient();
  const nextMatch = await apiClient.getNextMatch();

  const emailService = new ResendEmailService({
    apiKey: config.resendApiKey,
    fromEmail: config.resendFromEmail,
    toEmail: config.notificationEmail,
  });

  if (!nextMatch) {
    const fallbackText =
      '¡El sistema está funcionando con ESPN! No hay partidos próximos programados en este momento.';
    const fallbackHtml = `<!DOCTYPE html>
<html lang="es">
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
    <p>${escapeHtml(fallbackText)}</p>
  </body>
</html>`;

    console.log('[test-email] No hay próximo partido; se envía correo de prueba igualmente.');
    await emailService.send(TEST_SUBJECT, fallbackText, { html: fallbackHtml });
    console.log(`[test-email] Email enviado a ${config.notificationEmail}`);
    return;
  }

  const text = buildTestEmailText(nextMatch.homeTeamName, nextMatch.awayTeamName);
  const html = buildTestEmailHtml(nextMatch.homeTeamName, nextMatch.awayTeamName);

  console.log(
    `[test-email] Próximo partido: ${nextMatch.homeTeamName} vs ${nextMatch.awayTeamName} (${nextMatch.startTime.toISOString()})`,
  );
  console.log('[test-email] Enviando correo de prueba con Resend...');

  await emailService.send(TEST_SUBJECT, text, { html });

  console.log(`[test-email] Email enviado correctamente a ${config.notificationEmail}`);
}

main().catch((error) => {
  console.error('[test-email] Error:', error);
  process.exit(1);
});
