import { test, expect } from '@playwright/test';
import { LEAGUE_NAME } from '../src/constants/branding';
import { MockEmailService } from '../src/emailService';
import {
  filterMatchesForToday,
  formatMorningSummaryBody,
  formatMorningSummaryHtml,
  formatMorningSummarySubject,
  sendMorningMatchSummaries,
} from '../src/dailyCron';
import { translateStage } from '../src/utils/translations';
import { getKickoffHourInArgentina, getKickoffTimeInArgentina } from '../src/utils/timezone';
import { createSampleMatchInfo, MockFootballDataApi } from './helpers/mocks';

test.describe('Resumen matutino', () => {
  test('filtra solo los partidos del día (zona Argentina)', () => {
    const now = new Date('2026-06-15T11:00:00.000Z'); // 08:00 AR
    const matches = [
      createSampleMatchInfo({
        id: 1,
        startTime: new Date('2026-06-15T19:00:00.000Z'), // 16:00 AR
        homeTeamName: 'France',
        awayTeamName: 'Spain',
      }),
      createSampleMatchInfo({
        id: 2,
        startTime: new Date('2026-06-16T19:00:00.000Z'),
        homeTeamName: 'Brazil',
        awayTeamName: 'Germany',
      }),
    ];

    const todays = filterMatchesForToday(matches, now);

    expect(todays).toHaveLength(1);
    expect(todays[0].id).toBe(1);
  });

  test('traduce instancias del torneo', () => {
    expect(translateStage('SEMI_FINALS')).toBe('Semifinal');
    expect(translateStage('THIRD_PLACE')).toBe('Tercer Puesto');
    expect(translateStage('FINAL')).toBe('Final');
  });

  test('formatea asunto y HTML enriquecido en español con hora de Argentina', () => {
    // 19:30 UTC = 16:30 America/Argentina/Buenos_Aires
    const match = createSampleMatchInfo({
      startTime: new Date('2026-06-15T19:30:00.000Z'),
      homeTeamName: 'France',
      awayTeamName: 'Spain',
      stage: 'Final',
      venue: 'MetLife Stadium',
      refereeName: 'Pierluigi Collina',
      homeCrest: 'https://crests.example/france.svg',
      awayCrest: 'https://crests.example/spain.svg',
    });

    expect(getKickoffHourInArgentina(match.startTime)).toBe(16);
    expect(getKickoffTimeInArgentina(match.startTime)).toBe('16:30');
    expect(formatMorningSummarySubject(match)).toBe('⚽ Partido de hoy: Francia vs España');
    expect(formatMorningSummaryBody(match)).toContain(
      'El partido de hoy es Francia vs España y comienza a las 16 horas',
    );

    const html = formatMorningSummaryHtml(match);
    expect(html).toContain(`¡Hoy hay partido de la ${LEAGUE_NAME}!`);
    expect(html).toContain('Francia');
    expect(html).toContain('España');
    expect(html).toContain('https://crests.example/france.svg');
    expect(html).toContain('🏆 Instancia: Final');
    expect(html).toContain('🏟️ Estadio: MetLife Stadium');
    expect(html).toContain('⏱️ Horario: 16:30 hs (Hora Argentina)');
    expect(html).toContain('⚖️ Árbitro: Pierluigi Collina');
  });

  test('envía un email HTML por cada partido de hoy', async () => {
    const now = new Date('2026-06-15T11:00:00.000Z');
    const matches = [
      createSampleMatchInfo({
        id: 1,
        startTime: new Date('2026-06-15T19:00:00.000Z'),
        homeTeamName: 'France',
        awayTeamName: 'Spain',
        stage: 'Semifinal',
        venue: 'Soft Stadium',
        refereeName: 'Szymon Marciniak',
      }),
      createSampleMatchInfo({
        id: 2,
        startTime: new Date('2026-06-15T22:00:00.000Z'),
        homeTeamName: 'Brazil',
        awayTeamName: 'Germany',
      }),
    ];

    const emailService = new MockEmailService();
    const apiClient = new MockFootballDataApi(matches);

    const sent = await sendMorningMatchSummaries({
      apiClient,
      emailService,
      now: () => now,
    });

    expect(sent).toHaveLength(2);
    expect(emailService.sentEmails).toHaveLength(2);
    expect(emailService.sentEmails[0].subject).toBe('⚽ Partido de hoy: Francia vs España');
    expect(emailService.sentEmails[0].html).toContain(`¡Hoy hay partido de la ${LEAGUE_NAME}!`);
    expect(emailService.sentEmails[0].html).toContain('🏆 Instancia: Semifinal');
    expect(emailService.sentEmails[1].subject).toBe('⚽ Partido de hoy: Brasil vs Alemania');
  });

  test('no envía emails si no hay partidos hoy', async () => {
    const emailService = new MockEmailService();
    const apiClient = new MockFootballDataApi([
      createSampleMatchInfo({
        startTime: new Date('2026-06-20T19:00:00.000Z'),
      }),
    ]);

    const sent = await sendMorningMatchSummaries({
      apiClient,
      emailService,
      now: () => new Date('2026-06-15T11:00:00.000Z'),
    });

    expect(sent).toHaveLength(0);
    expect(emailService.sentEmails).toHaveLength(0);
  });
});
