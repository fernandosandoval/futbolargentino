import { test, expect } from '@playwright/test';
import {
  ESPN_SCOREBOARD_URL,
  FootballDataClient,
  filterUpcomingMatches,
  getTeamDisplayName,
  mapEspnEventToMatch,
  mapEspnStatusToMatchStatus,
  type EspnEvent,
} from '../src/apiClient';
import type { FootballMatch } from '../src/types';

function createEspnEvent(overrides: Partial<EspnEvent> = {}): EspnEvent {
  return {
    id: '401234567',
    date: '2099-08-10T22:00:00Z',
    status: {
      type: {
        name: 'STATUS_SCHEDULED',
        state: 'pre',
        completed: false,
      },
    },
    season: { slug: 'regular-season' },
    competitions: [
      {
        venue: { fullName: 'El Monumental' },
        competitors: [
          {
            id: '16',
            homeAway: 'home',
            team: {
              id: '16',
              displayName: 'River Plate',
              abbreviation: 'RIV',
              logo: 'https://example.com/river.png',
            },
          },
          {
            id: '5',
            homeAway: 'away',
            team: {
              id: '5',
              displayName: 'Boca Juniors',
              abbreviation: 'BOC',
              logo: 'https://example.com/boca.png',
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

test.describe('Cliente público de ESPN', () => {
  test('devuelve todos los partidos SCHEDULED/TIMED ordenados por fecha', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    const matches: FootballMatch[] = [
      {
        id: 2,
        utcDate: '2026-06-16T18:00:00.000Z',
        status: 'SCHEDULED',
        homeTeam: { id: 10, name: 'Brasil' },
        awayTeam: { id: 11, name: 'Francia' },
      },
      {
        id: 1,
        utcDate: '2026-06-15T18:00:00.000Z',
        status: 'TIMED',
        homeTeam: { id: 1, name: 'Argentina' },
        awayTeam: { id: 2, name: 'México' },
      },
      {
        id: 3,
        utcDate: '2026-06-09T18:00:00.000Z',
        status: 'SCHEDULED',
        homeTeam: { id: 3, name: 'España' },
        awayTeam: { id: 4, name: 'Alemania' },
      },
      {
        id: 4,
        utcDate: '2026-06-17T18:00:00.000Z',
        status: 'FINISHED',
        homeTeam: { id: 5, name: 'Italia' },
        awayTeam: { id: 6, name: 'Uruguay' },
      },
    ];

    const upcoming = filterUpcomingMatches(matches, now);

    expect(upcoming.map((match) => match.id)).toEqual([1, 2]);
  });

  test('usa un nombre alternativo cuando el equipo no tiene name', () => {
    const rival = { id: 99, name: null, shortName: 'TBD' };

    expect(getTeamDisplayName(rival)).toBe('TBD');
  });

  test('mapea un evento ESPN al modelo interno', () => {
    const match = mapEspnEventToMatch(createEspnEvent());

    expect(match.id).toBe(401234567);
    expect(match.utcDate).toBe('2099-08-10T22:00:00Z');
    expect(match.status).toBe('SCHEDULED');
    expect(match.homeTeam.name).toBe('River Plate');
    expect(match.awayTeam.name).toBe('Boca Juniors');
    expect(match.homeTeam.crest).toBe('https://example.com/river.png');
    expect(match.venue).toBe('El Monumental');
  });

  test('normaliza estados programado, en juego y finalizado', () => {
    expect(mapEspnStatusToMatchStatus(createEspnEvent())).toBe('SCHEDULED');
    expect(
      mapEspnStatusToMatchStatus(
        createEspnEvent({
          status: { type: { name: 'STATUS_IN_PROGRESS', state: 'in' } },
        }),
      ),
    ).toBe('IN_PLAY');
    expect(
      mapEspnStatusToMatchStatus(
        createEspnEvent({
          status: {
            type: { name: 'STATUS_FINAL', state: 'post', completed: true },
          },
        }),
      ),
    ).toBe('FINISHED');
  });

  test('consulta ESPN sin headers de autenticación y devuelve próximos partidos', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({ events: [createEspnEvent()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new FootballDataClient({ fetchFn, scoreboardLookaheadDays: 1 });
    const matches = await client.getUpcomingMatches();

    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests.every((request) => request.url.startsWith(ESPN_SCOREBOARD_URL))).toBe(true);
    expect(requests.every((request) => request.init?.headers === undefined)).toBe(true);
    expect(matches).toHaveLength(1);
    expect(matches[0].homeTeamName).toBe('River Plate');
    expect(matches[0].awayTeamName).toBe('Boca Juniors');
  });
});
