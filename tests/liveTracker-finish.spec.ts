import { test, expect } from '@playwright/test';
import { LiveMatchTracker } from '../src/liveTracker';
import { MockEmailService } from '../src/emailService';
import { createSampleMatchInfo, createFinishedMatch, MockFootballDataApi } from './helpers/mocks';
import type { FootballMatch } from '../src/types';

test.describe('LiveMatchTracker - Email de resultado final', () => {
  test('envía email con el marcador correcto al finalizar el partido', async () => {
    const matchInfo = createSampleMatchInfo({
      id: 2001,
      homeTeamName: 'Argentina',
      awayTeamName: 'Inglaterra',
      status: 'IN_PLAY',
    });

    const finishedMatch = createFinishedMatch('HOME_TEAM', {
      matchId: 2001,
      homeTeamName: 'Argentina',
      awayTeamName: 'Inglaterra',
      homeGoals: 3,
      awayGoals: 1,
    });

    const apiClient = new MockFootballDataApi(matchInfo, new Map([[2001, finishedMatch]]));
    const emailService = new MockEmailService();

    const tracker = new LiveMatchTracker({
      apiClient,
      emailService,
      match: matchInfo,
      pollIntervalMs: 1000,
    });

    // Simular el poll manualmente (como lo hace start)
    await (tracker as any).poll();

    // Verificar que se envió el email
    expect(emailService.sentEmails.length).toBeGreaterThanOrEqual(1);

    const resultEmail = emailService.sentEmails.find((e) => e.subject.includes('Terminó'));
    expect(resultEmail).toBeDefined();

    // Verificar que el asunto tiene el marcador correcto: Argentina 3 - 1 Inglaterra
    expect(resultEmail!.subject).toBe('Terminó: Argentina 3 - 1 Inglaterra');

    // Verificar que el body también tiene el marcador correcto
    expect(resultEmail!.body).toContain('Argentina 3 - 1 Inglaterra');
    expect(resultEmail!.body).toContain('Ganó Argentina');

    // Verificar que el HTML tiene los goles correctos
    expect(resultEmail!.html).toContain('3');
    expect(resultEmail!.html).toContain('1');
  });

  test('envía email con empate cuando el partido termina igualado', async () => {
    const matchInfo = createSampleMatchInfo({
      id: 2002,
      homeTeamName: 'Brasil',
      awayTeamName: 'Alemania',
      status: 'IN_PLAY',
    });

    const finishedMatch = createFinishedMatch('DRAW', {
      matchId: 2002,
      homeTeamName: 'Brasil',
      awayTeamName: 'Alemania',
      homeGoals: 2,
      awayGoals: 2,
    });

    const apiClient = new MockFootballDataApi(matchInfo, new Map([[2002, finishedMatch]]));
    const emailService = new MockEmailService();

    const tracker = new LiveMatchTracker({
      apiClient,
      emailService,
      match: matchInfo,
      pollIntervalMs: 1000,
    });

    await (tracker as any).poll();

    const resultEmail = emailService.sentEmails.find((e) => e.subject.includes('Terminó'));
    expect(resultEmail).toBeDefined();
    expect(resultEmail!.subject).toBe('Terminó: Brasil 2 - 2 Alemania');
    expect(resultEmail!.body).toContain('Empate');
  });

  test('envía email con victoria del visitante', async () => {
    const matchInfo = createSampleMatchInfo({
      id: 2003,
      homeTeamName: 'Argentina',
      awayTeamName: 'Francia',
      status: 'IN_PLAY',
    });

    const finishedMatch = createFinishedMatch('AWAY_TEAM', {
      matchId: 2003,
      homeTeamName: 'Argentina',
      awayTeamName: 'Francia',
      homeGoals: 1,
      awayGoals: 2,
    });

    const apiClient = new MockFootballDataApi(matchInfo, new Map([[2003, finishedMatch]]));
    const emailService = new MockEmailService();

    const tracker = new LiveMatchTracker({
      apiClient,
      emailService,
      match: matchInfo,
      pollIntervalMs: 1000,
    });

    await (tracker as any).poll();

    const resultEmail = emailService.sentEmails.find((e) => e.subject.includes('Terminó'));
    expect(resultEmail).toBeDefined();
    expect(resultEmail!.subject).toBe('Terminó: Argentina 1 - 2 Francia');
    expect(resultEmail!.body).toContain('Ganó Francia');
  });

  test('envía email de descanso con el marcador actual si halfTime viene vacío', async () => {
    const matchInfo = createSampleMatchInfo({
      id: 2004,
      homeTeamName: 'River Plate',
      awayTeamName: 'Boca Juniors',
      status: 'IN_PLAY',
    });

    const pausedMatch: FootballMatch = {
      id: 2004,
      utcDate: '2026-06-15T18:00:00.000Z',
      status: 'PAUSED',
      homeTeam: { id: 16, name: 'River Plate' },
      awayTeam: { id: 5, name: 'Boca Juniors' },
      score: {
        winner: null,
        fullTime: { homeTeam: 2, awayTeam: 1 },
        halfTime: { homeTeam: null, awayTeam: null },
      },
    };

    const apiClient = new MockFootballDataApi(matchInfo, new Map([[2004, pausedMatch]]));
    const emailService = new MockEmailService();

    const tracker = new LiveMatchTracker({
      apiClient,
      emailService,
      match: matchInfo,
      pollIntervalMs: 1000,
    });

    await (tracker as any).poll();

    const halftimeEmail = emailService.sentEmails.find((e) => e.subject.includes('Descanso'));
    expect(halftimeEmail).toBeDefined();
    expect(halftimeEmail!.body).toContain('River Plate 2 - 1 Boca Juniors');
    expect(halftimeEmail!.html).toContain('2 - 1');
    expect(halftimeEmail!.html).not.toContain('>0 - 0<');
  });
});
