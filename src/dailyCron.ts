import cron, { type ScheduledTask } from 'node-cron';
import { LEAGUE_NAME } from './constants/branding';
import type { EmailService, FootballDataApi, MatchInfo } from './types';
import { escapeHtml, renderCrestImg } from './utils/emailTemplates';
import { translateTeamName } from './utils/translations';
import {
  ARGENTINA_TIMEZONE,
  getKickoffHourInArgentina,
  getKickoffTimeInArgentina,
  isSameCalendarDay,
} from './utils/timezone';

export const MIDDAY_SUMMARY_CRON = '0 12 * * *';

export function formatMorningSummarySubject(match: MatchInfo): string {
  const home = translateTeamName(match.homeTeamName);
  const away = translateTeamName(match.awayTeamName);
  return `⚽ Partido de hoy: ${home} vs ${away}`;
}

export function formatMorningSummaryBody(match: MatchInfo): string {
  const home = translateTeamName(match.homeTeamName);
  const away = translateTeamName(match.awayTeamName);
  const time = getKickoffTimeInArgentina(match.startTime);
  return [
    `El partido de hoy es ${home} vs ${away} y comienza a las ${getKickoffHourInArgentina(match.startTime)} horas`,
    `Instancia: ${match.stage}`,
    `Estadio: ${match.venue}`,
    `Horario: ${time} hs (Hora Argentina)`,
    `Árbitro: ${match.refereeName}`,
  ].join('\n');
}

export function formatMorningSummaryHtml(match: MatchInfo): string {
  const home = escapeHtml(translateTeamName(match.homeTeamName));
  const away = escapeHtml(translateTeamName(match.awayTeamName));
  const stage = escapeHtml(match.stage);
  const venue = escapeHtml(match.venue);
  const referee = escapeHtml(match.refereeName);
  const time = escapeHtml(getKickoffTimeInArgentina(match.startTime));

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Resumen matutino - ${escapeHtml(LEAGUE_NAME)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 24px 12px;text-align:center;">
                <h1 style="margin:0;font-size:26px;line-height:1.3;color:#111827;">¡Hoy hay partido de la ${escapeHtml(LEAGUE_NAME)}!</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="45%" align="center" style="vertical-align:top;padding:8px;">
                      ${renderCrestImg(match.homeCrest, home)}
                      <div style="font-size:18px;font-weight:700;line-height:1.3;">${home}</div>
                    </td>
                    <td width="10%" align="center" style="vertical-align:middle;font-size:16px;font-weight:700;color:#6b7280;">vs</td>
                    <td width="45%" align="center" style="vertical-align:top;padding:8px;">
                      ${renderCrestImg(match.awayCrest, away)}
                      <div style="font-size:18px;font-weight:700;line-height:1.3;">${away}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 28px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;border-radius:10px;">
                  <tr>
                    <td style="padding:16px 18px;font-size:15px;line-height:1.7;color:#374151;">
                      <div>🏆 Instancia: ${stage}</div>
                      <div>🏟️ Estadio: ${venue}</div>
                      <div>⏱️ Horario: ${time} hs (Hora Argentina)</div>
                      <div>⚖️ Árbitro: ${referee}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function filterMatchesForToday(
  matches: MatchInfo[],
  now: Date = new Date(),
): MatchInfo[] {
  return matches
    .filter((match) => isSameCalendarDay(match.startTime, now, ARGENTINA_TIMEZONE))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export interface DailyMorningSummaryOptions {
  apiClient: FootballDataApi;
  emailService: EmailService;
  now?: () => Date;
}

export async function sendMorningMatchSummaries(
  options: DailyMorningSummaryOptions,
): Promise<MatchInfo[]> {
  const { apiClient, emailService } = options;
  const now = options.now?.() ?? new Date();

  const todaysMatches = filterMatchesForToday(await apiClient.getTodaysMatches(now), now);

  if (todaysMatches.length === 0) {
    console.log('[daily-cron] No hay partidos programados para hoy. No se envían emails.');
    return [];
  }

  console.log(`[daily-cron] Enviando resumen matutino de ${todaysMatches.length} partido(s).`);

  for (const match of todaysMatches) {
    const subject = formatMorningSummarySubject(match);
    const body = formatMorningSummaryBody(match);
    const html = formatMorningSummaryHtml(match);
    await emailService.send(subject, body, { html });
    console.log(`[daily-cron] Email enviado: ${subject}`);
  }

  return todaysMatches;
}

export function startMiddaySummaryCron(options: DailyMorningSummaryOptions): ScheduledTask {
  const task = cron.schedule(
    MIDDAY_SUMMARY_CRON,
    () => {
      void sendMorningMatchSummaries(options).catch((error) => {
        console.error('[daily-cron] Error al enviar el resumen del mediodía:', error);
      });
    },
    {
      timezone: ARGENTINA_TIMEZONE,
    },
  );

  console.log(
    `[daily-cron] Resumen del mediodía programado a las 12:00 (${ARGENTINA_TIMEZONE}).`,
  );

  return task;
}
