import { LEAGUE_NAME } from '../constants/branding';
import type { BookingEvent, GoalEvent, MatchInfo, SubstitutionEvent } from '../types';
import { getKickoffTimeInArgentina } from './timezone';
import { translateTeamName } from './translations';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderCrestImg(crestUrl: string | null, teamName: string): string {
  if (!crestUrl) {
    return '';
  }
  return `<img src="${escapeHtml(crestUrl)}" alt="Escudo de ${escapeHtml(teamName)}" width="50" height="50" style="display:block;margin:0 auto 8px;border:0;" />`;
}

function baseTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(LEAGUE_NAME)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f4f6f8;padding:24px 12px;">
      <tr>
        <td align="center">
          ${content}
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function cardContainer(rows: string): string {
  return `<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;">
    ${rows}
  </table>`;
}

function teamVersusBlock(match: MatchInfo): string {
  const home = escapeHtml(translateTeamName(match.homeTeamName));
  const away = escapeHtml(translateTeamName(match.awayTeamName));
  return `<tr>
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
  </tr>`;
}

function matchInfoBlock(match: MatchInfo): string {
  const stage = escapeHtml(match.stage);
  const venue = escapeHtml(match.venue);
  const time = escapeHtml(getKickoffTimeInArgentina(match.startTime));
  const referee = escapeHtml(match.refereeName);
  const groupInfo = match.group ? `<div>📋 ${escapeHtml(match.group)}</div>` : '';

  return `<tr>
    <td style="padding:0 24px 28px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;border-radius:10px;">
        <tr>
          <td style="padding:16px 18px;font-size:15px;line-height:1.7;color:#374151;">
            ${groupInfo}
            <div>🏆 Instancia: ${stage}</div>
            <div>🏟️ Estadio: ${venue}</div>
            <div>⏱️ Horario: ${time} hs (Hora Argentina)</div>
            <div>⚖️ Árbitro: ${referee}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function oneHourBeforeHtml(match: MatchInfo): string {
  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#111827;">¡Falta 1 hora!</h1>
      <p style="margin:8px 0 0;font-size:15px;color:#6b7280;">Preparate para el partido</p>
    </td>
  </tr>
  ${teamVersusBlock(match)}
  ${matchInfoBlock(match)}`);
  return baseTemplate(content);
}

export function kickoffHtml(match: MatchInfo): string {
  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#059669;">¡Comenzó el partido!</h1>
    </td>
  </tr>
  ${teamVersusBlock(match)}`);
  return baseTemplate(content);
}

export function halftimeHtml(match: MatchInfo): string {
  const home = escapeHtml(translateTeamName(match.homeTeamName));
  const away = escapeHtml(translateTeamName(match.awayTeamName));
  const htHome = match.halfTimeHome ?? 0;
  const htAway = match.halfTimeAway ?? 0;

  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#d97706;">Descanso</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 24px 20px;text-align:center;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td width="45%" align="center" style="vertical-align:top;padding:8px;">
            ${renderCrestImg(match.homeCrest, home)}
            <div style="font-size:18px;font-weight:700;line-height:1.3;">${home}</div>
          </td>
          <td width="10%" align="center" style="vertical-align:middle;">
            <span style="font-size:28px;font-weight:800;color:#111827;">${htHome} - ${htAway}</span>
          </td>
          <td width="45%" align="center" style="vertical-align:top;padding:8px;">
            ${renderCrestImg(match.awayCrest, away)}
            <div style="font-size:18px;font-weight:700;line-height:1.3;">${away}</div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`);
  return baseTemplate(content);
}

export function formatGoalsList(goals: GoalEvent[]): string {
  if (goals.length === 0) return '';
  return goals
    .map((g) => {
      const scorer = escapeHtml(g.scorer.name);
      const team = escapeHtml(translateTeamName(g.team.name));
      const minute = g.minute;
      const injuryTime = g.injuryTime ? `+${g.injuryTime}` : '';
      const typeTag =
        g.type === 'PENALTY' ? ' (pen)' : g.type === 'OWN_GOAL' ? ' (og)' : '';
      return `<div style="margin:4px 0;">⚽ ${minute}${injuryTime}' - ${scorer}${typeTag} (${team})</div>`;
    })
    .join('');
}

export function formatBookingsList(bookings: BookingEvent[]): string {
  if (bookings.length === 0) return '';
  return bookings
    .map((b) => {
      const player = escapeHtml(b.player.name);
      const team = escapeHtml(translateTeamName(b.team.name));
      const icon = b.card === 'RED' || b.card === 'YELLOW_RED' ? '🟥' : '🟨';
      return `<div style="margin:4px 0;">${icon} ${b.minute}' - ${player} (${team})</div>`;
    })
    .join('');
}

export function formatSubstitutionsList(subs: SubstitutionEvent[]): string {
  if (subs.length === 0) return '';
  return subs
    .map((s) => {
      const out = escapeHtml(s.playerOut.name);
      const inp = escapeHtml(s.playerIn.name);
      return `<div style="margin:4px 0;">🔄 ${s.minute}' - ${out} → ${inp}</div>`;
    })
    .join('');
}

export function matchResultHtml(match: MatchInfo, description: string): string {
  const home = escapeHtml(translateTeamName(match.homeTeamName));
  const away = escapeHtml(translateTeamName(match.awayTeamName));
  const homeGoals = match.fullTimeHome ?? 0;
  const awayGoals = match.fullTimeAway ?? 0;

  const goalsHtml = formatGoalsList(match.goals);
  const bookingsHtml = formatBookingsList(match.bookings);
  const subsHtml = formatSubstitutionsList(match.substitutions);

  const eventsSection =
    goalsHtml || bookingsHtml || subsHtml
      ? `<tr>
    <td style="padding:0 24px 20px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f9fafb;border-radius:10px;">
        <tr>
          <td style="padding:16px 18px;font-size:14px;line-height:1.6;color:#374151;">
            ${goalsHtml ? `<div style="font-weight:700;margin-bottom:8px;">Goles:</div>${goalsHtml}` : ''}
            ${bookingsHtml ? `<div style="font-weight:700;margin-top:12px;margin-bottom:8px;">Tarjetas:</div>${bookingsHtml}` : ''}
            ${subsHtml ? `<div style="font-weight:700;margin-top:12px;margin-bottom:8px;">Sustituciones:</div>${subsHtml}` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>`
      : '';

  const durationTag =
    match.duration === 'EXTRA_TIME'
      ? '<span style="color:#d97706;font-weight:700;">(Tiempo extra)</span>'
      : match.duration === 'PENALTY_SHOOTOUT'
        ? '<span style="color:#dc2626;font-weight:700;">(Penales)</span>'
        : '';

  const attendanceHtml = match.attendance
    ? `<div style="margin-top:8px;color:#6b7280;">👥 Asistencia: ${match.attendance.toLocaleString('es-AR')}</div>`
    : '';

  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#111827;">Resultado final</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 24px 20px;text-align:center;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td width="40%" align="center" style="vertical-align:top;padding:8px;">
            ${renderCrestImg(match.homeCrest, home)}
            <div style="font-size:16px;font-weight:700;line-height:1.3;">${home}</div>
          </td>
          <td width="20%" align="center" style="vertical-align:middle;">
            <span style="font-size:32px;font-weight:800;color:#111827;">${homeGoals} - ${awayGoals}</span>
            <div>${durationTag}</div>
          </td>
          <td width="40%" align="center" style="vertical-align:top;padding:8px;">
            ${renderCrestImg(match.awayCrest, away)}
            <div style="font-size:16px;font-weight:700;line-height:1.3;">${away}</div>
          </td>
        </tr>
      </table>
      ${attendanceHtml}
    </td>
  </tr>
  ${eventsSection}`);
  return baseTemplate(content);
}

export function goalNotificationHtml(match: MatchInfo, goal: GoalEvent): string {
  const scorer = escapeHtml(goal.scorer.name);
  const team = escapeHtml(translateTeamName(goal.team.name));
  const home = escapeHtml(translateTeamName(match.homeTeamName));
  const away = escapeHtml(translateTeamName(match.awayTeamName));
  const score = goal.score;
  const minute = goal.minute;
  const injuryTime = goal.injuryTime ? `+${goal.injuryTime}` : '';
  const typeTag = goal.type === 'PENALTY' ? ' (penalti)' : goal.type === 'OWN_GOAL' ? ' (autogol)' : '';

  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#059669;">¡Gol!</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 24px 12px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#111827;">⚽ ${scorer}${typeTag}</div>
      <div style="font-size:15px;color:#6b7280;margin-top:4px;">${team} - Minuto ${minute}${injuryTime}'</div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 24px 28px;text-align:center;">
      <div style="font-size:22px;font-weight:800;color:#111827;">${home} ${score.home} - ${score.away} ${away}</div>
    </td>
  </tr>`);
  return baseTemplate(content);
}

export function redCardNotificationHtml(match: MatchInfo, booking: BookingEvent): string {
  const player = escapeHtml(booking.player.name);
  const team = escapeHtml(translateTeamName(booking.team.name));

  const content = cardContainer(`<tr>
    <td style="padding:28px 24px 12px;text-align:center;">
      <h1 style="margin:0;font-size:26px;line-height:1.3;color:#dc2626;">🟥 Tarjeta roja</h1>
    </td>
  </tr>
  <tr>
    <td style="padding:8px 24px 28px;text-align:center;">
      <div style="font-size:18px;font-weight:700;color:#111827;">${player}</div>
      <div style="font-size:15px;color:#6b7280;margin-top:4px;">${team} - Minuto ${booking.minute}'</div>
    </td>
  </tr>`);
  return baseTemplate(content);
}
