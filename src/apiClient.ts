import { ApiCache } from './apiCache';
import { httpFetch } from './httpFetch';
import { withRetry } from './retry';
import { translateGroup, translateStage, translateTeamName } from './utils/translations';
import { ARGENTINA_TIMEZONE, formatCalendarDate, isSameCalendarDay } from './utils/timezone';
import type {
  FootballDataApi,
  FootballMatch,
  MatchDuration,
  MatchInfo,
  MatchStatus,
  MatchWinner,
  Referee,
  Team,
} from './types';

export const ESPN_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard';

/** Días hacia adelante que consultamos en el scoreboard (ESPN devuelve un día por request). */
const SCOREBOARD_LOOKAHEAD_DAYS = 21;

const UPCOMING_STATUSES = new Set(['SCHEDULED', 'TIMED']);

const SCOREBOARD_CACHE_TTL_MS = 60_000;
const MATCH_CACHE_TTL_MS = 30_000;

export interface FootballDataClientOptions {
  fetchFn?: typeof fetch;
  /** Override para tests; por defecto SCOREBOARD_LOOKAHEAD_DAYS. */
  scoreboardLookaheadDays?: number;
}

export interface EspnScoreboardResponse {
  events?: EspnEvent[];
}

export interface EspnLineScore {
  value?: number | string;
  displayValue?: string;
}

export interface EspnCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  winner?: boolean;
  score?: string;
  /** Marcador por tiempo; el índice 0 es el primer tiempo cuando está presente. */
  linescores?: EspnLineScore[];
  team: {
    id?: string;
    displayName: string;
    shortDisplayName?: string;
    abbreviation?: string;
    logo?: string;
  };
}

export interface EspnEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  status: {
    type: {
      name?: string;
      state?: string;
      completed?: boolean;
      description?: string;
      detail?: string;
    };
  };
  season?: {
    type?: number;
    slug?: string;
  };
  competitions: Array<{
    competitors: EspnCompetitor[];
    venue?: {
      fullName?: string;
    };
    attendance?: number;
  }>;
}

export function buildScoreboardUrl(calendarDate?: string): string {
  if (!calendarDate) {
    return ESPN_SCOREBOARD_URL;
  }
  return `${ESPN_SCOREBOARD_URL}?dates=${calendarDate}`;
}

function toEspnCalendarDate(date: Date, timeZone: string = ARGENTINA_TIMEZONE): string {
  return formatCalendarDate(date, timeZone).replace(/-/g, '');
}

function addCalendarDays(date: Date, days: number, timeZone: string = ARGENTINA_TIMEZONE): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  // Normalizar al mediodía UTC para evitar saltos de día al formatear en Argentina.
  const calendar = formatCalendarDate(next, timeZone);
  return new Date(`${calendar}T12:00:00.000Z`);
}

function parseNumericId(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseScore(score: string | number | undefined): number | null {
  if (score === undefined || score === '') {
    return null;
  }
  const parsed = Number(score);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLineScore(lineScore: EspnLineScore | undefined): number | null {
  if (!lineScore) {
    return null;
  }
  return parseScore(lineScore.displayValue ?? lineScore.value);
}

/**
 * ESPN no siempre expone el entretiempo en el scoreboard.
 * Si hay linescores, el índice 0 es el 1.er tiempo.
 * En descanso (PAUSED) el score actual es el del entretiempo.
 */
export function resolveHalfTimeScore(
  home: EspnCompetitor,
  away: EspnCompetitor,
  status: MatchStatus,
  homeScore: number | null,
  awayScore: number | null,
): { homeTeam: number | null; awayTeam: number | null } {
  const fromLinesHome = parseLineScore(home.linescores?.[0]);
  const fromLinesAway = parseLineScore(away.linescores?.[0]);
  if (fromLinesHome !== null || fromLinesAway !== null) {
    return { homeTeam: fromLinesHome, awayTeam: fromLinesAway };
  }

  if (status === 'PAUSED') {
    return { homeTeam: homeScore, awayTeam: awayScore };
  }

  return { homeTeam: null, awayTeam: null };
}

export function mapEspnStatusToMatchStatus(event: EspnEvent): MatchStatus {
  const name = event.status.type.name?.toUpperCase() ?? '';

  if (name === 'STATUS_FINAL' || event.status.type.completed) {
    return 'FINISHED';
  }
  if (name === 'STATUS_IN_PROGRESS') {
    return 'IN_PLAY';
  }
  if (name === 'STATUS_SCHEDULED') {
    return 'SCHEDULED';
  }

  const state = event.status.type.state?.toLowerCase() ?? '';
  if (state === 'post' || name.includes('FINAL')) {
    return 'FINISHED';
  }
  if (name.includes('HALFTIME')) {
    return 'PAUSED';
  }
  if (state === 'in' || name.includes('IN_PROGRESS')) {
    return 'IN_PLAY';
  }
  if (name.includes('POSTPONED')) {
    return 'POSTPONED';
  }
  if (name.includes('CANCELED') || name.includes('CANCELLED')) {
    return 'CANCELLED';
  }
  if (name.includes('SUSPENDED')) {
    return 'SUSPENDED';
  }
  if (state === 'pre' || name.includes('SCHEDULED')) {
    return 'SCHEDULED';
  }

  return 'SCHEDULED';
}

function mapEspnWinner(
  home: EspnCompetitor,
  away: EspnCompetitor,
  status: MatchStatus,
): MatchWinner {
  if (home.winner === true) {
    return 'HOME_TEAM';
  }
  if (away.winner === true) {
    return 'AWAY_TEAM';
  }

  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  if (status === 'FINISHED' && homeScore !== null && homeScore === awayScore) {
    return 'DRAW';
  }

  return null;
}

export function mapEspnEventToMatch(event: EspnEvent): FootballMatch {
  const competition = event.competitions[0];
  if (!competition) {
    throw new Error(`Evento ESPN ${event.id} sin competitions`);
  }

  const home = competition.competitors.find((competitor) => competitor.homeAway === 'home');
  const away = competition.competitors.find((competitor) => competitor.homeAway === 'away');
  if (!home || !away) {
    throw new Error(`Evento ESPN ${event.id} sin equipos local/visitante`);
  }

  const status = mapEspnStatusToMatchStatus(event);
  const homeScore = parseScore(home.score);
  const awayScore = parseScore(away.score);
  const halfTime = resolveHalfTimeScore(home, away, status, homeScore, awayScore);

  return {
    id: parseNumericId(event.id),
    utcDate: event.date,
    status,
    stage: event.season?.slug ?? null,
    venue: competition.venue?.fullName ?? null,
    minute: null,
    attendance: competition.attendance ?? null,
    homeTeam: {
      id: parseNumericId(home.team.id ?? home.id),
      name: home.team.displayName,
      shortName: home.team.shortDisplayName,
      tla: home.team.abbreviation,
      crest: home.team.logo ?? null,
    },
    awayTeam: {
      id: parseNumericId(away.team.id ?? away.id),
      name: away.team.displayName,
      shortName: away.team.shortDisplayName,
      tla: away.team.abbreviation,
      crest: away.team.logo ?? null,
    },
    competition: {
      id: 1,
      name: 'Liga Profesional Argentina',
      code: 'ARG.1',
    },
    score: {
      winner: mapEspnWinner(home, away, status),
      duration: 'REGULAR',
      fullTime: {
        homeTeam: homeScore,
        awayTeam: awayScore,
      },
      halfTime,
    },
    goals: [],
    bookings: [],
    substitutions: [],
  };
}

export function mapEspnEvents(events: EspnEvent[]): FootballMatch[] {
  return events.flatMap((event) => {
    try {
      return [mapEspnEventToMatch(event)];
    } catch (error) {
      console.warn(`[espn] Se omitió el evento ${event.id}:`, error);
      return [];
    }
  });
}

function dedupeMatchesById(matches: FootballMatch[]): FootballMatch[] {
  const byId = new Map<number, FootballMatch>();
  for (const match of matches) {
    byId.set(match.id, match);
  }
  return Array.from(byId.values());
}

export function getTeamDisplayName(team: Team): string {
  const rawName = team.name ?? team.shortName ?? team.tla ?? 'Por definir';
  return translateTeamName(rawName);
}

export function extractRefereeName(referees: Referee[] | undefined): string {
  if (!referees || referees.length === 0) {
    return 'Por confirmar';
  }

  const mainReferee =
    referees.find((referee) => referee.type?.toUpperCase() === 'REFEREE') ?? referees[0];

  const name = mainReferee.name?.trim();
  return name && name.length > 0 ? name : 'Por confirmar';
}

export function extractVenue(venue: string | null | undefined): string {
  const trimmed = venue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Estadio por confirmar';
}

export function filterUpcomingMatches(
  matches: FootballMatch[],
  now: Date = new Date(),
): FootballMatch[] {
  const nowMs = now.getTime();

  return matches
    .filter((match) => UPCOMING_STATUSES.has(match.status))
    .filter((match) => new Date(match.utcDate).getTime() > nowMs)
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
}

export function filterMatchesByCalendarDay(
  matches: FootballMatch[],
  day: Date,
  timeZone: string = ARGENTINA_TIMEZONE,
): FootballMatch[] {
  return matches
    .filter((match) => UPCOMING_STATUSES.has(match.status))
    .filter((match) => isSameCalendarDay(new Date(match.utcDate), day, timeZone))
    .sort((a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime());
}

export function describeMatchWinner(match: FootballMatch): string {
  const homeName = getTeamDisplayName(match.homeTeam);
  const awayName = getTeamDisplayName(match.awayTeam);
  const score = match.score?.fullTime;
  const homeGoals = score?.homeTeam ?? 0;
  const awayGoals = score?.awayTeam ?? 0;
  const scoreLine = `${homeName} ${homeGoals} - ${awayGoals} ${awayName}`;

  const winner = match.score?.winner;
  if (winner === 'HOME_TEAM') {
    return `Resultado: ${scoreLine}. Ganó ${homeName}.`;
  }
  if (winner === 'AWAY_TEAM') {
    return `Resultado: ${scoreLine}. Ganó ${awayName}.`;
  }
  if (winner === 'DRAW') {
    return `Resultado: ${scoreLine}. Empate.`;
  }

  return `Resultado: ${scoreLine}.`;
}

export class FootballDataClient implements FootballDataApi {
  private readonly fetchFn: typeof fetch;
  private readonly scoreboardLookaheadDays: number;
  private readonly scoreboardCache = new ApiCache<FootballMatch[]>();
  private readonly matchCache = new ApiCache<FootballMatch>();

  constructor(options: FootballDataClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? httpFetch;
    this.scoreboardLookaheadDays = options.scoreboardLookaheadDays ?? SCOREBOARD_LOOKAHEAD_DAYS;
  }

  async getUpcomingMatches(): Promise<MatchInfo[]> {
    const matches = await this.fetchScoreboard();
    const upcoming = filterUpcomingMatches(matches);
    console.log(`[espn] Próximos partidos encontrados: ${upcoming.length}`);
    return upcoming.map((match) => this.toMatchInfo(match));
  }

  async getTodaysMatches(now: Date = new Date()): Promise<MatchInfo[]> {
    const matches = await this.fetchScoreboard();
    const today = filterMatchesByCalendarDay(matches, now);
    console.log(`[espn] Partidos de hoy: ${today.length}`);
    return today.map((match) => this.toMatchInfo(match));
  }

  async getNextMatch(): Promise<MatchInfo | null> {
    const upcoming = await this.getUpcomingMatches();
    return upcoming[0] ?? null;
  }

  async getMatchById(matchId: number): Promise<FootballMatch> {
    const cacheKey = `match-${matchId}`;
    const cached = this.matchCache.get(cacheKey);
    if (cached) {
      console.log(`[espn] Partido ${matchId} servido desde caché`);
      return cached;
    }

    const match = await withRetry(async () => {
      const matches = await this.fetchScoreboard(true);
      const found = matches.find((candidate) => candidate.id === matchId);
      if (!found) {
        throw new Error(`Partido ${matchId} no encontrado en el scoreboard de ESPN`);
      }
      return found;
    });

    this.matchCache.set(cacheKey, match, MATCH_CACHE_TTL_MS);
    console.log(`[espn] Partido ${matchId} obtenido: ${foundSummary(match)}`);
    return match;
  }

  clearCache(): void {
    this.scoreboardCache.clear();
    this.matchCache.clear();
    console.log('[espn] Caché limpiada');
  }

  toMatchInfo(match: FootballMatch): MatchInfo {
    return {
      id: match.id,
      startTime: new Date(match.utcDate),
      homeTeamName: getTeamDisplayName(match.homeTeam),
      awayTeamName: getTeamDisplayName(match.awayTeam),
      homeTeamId: match.homeTeam.id,
      awayTeamId: match.awayTeam.id,
      status: match.status,
      stage: translateStage(match.stage),
      venue: extractVenue(match.venue),
      refereeName: extractRefereeName(match.referees),
      homeCrest: match.homeTeam.crest ?? null,
      awayCrest: match.awayTeam.crest ?? null,
      matchday: match.matchday ?? null,
      group: translateGroup(match.group),
      halfTimeHome: match.score?.halfTime?.homeTeam ?? null,
      halfTimeAway: match.score?.halfTime?.awayTeam ?? null,
      duration: (match.score?.duration as MatchDuration) ?? 'REGULAR',
      goals: match.goals ?? [],
      bookings: match.bookings ?? [],
      substitutions: match.substitutions ?? [],
      minute: match.minute ?? null,
      attendance: match.attendance ?? null,
      fullTimeHome: match.score?.fullTime?.homeTeam ?? null,
      fullTimeAway: match.score?.fullTime?.awayTeam ?? null,
    };
  }

  private async fetchScoreboard(forceRefresh = false): Promise<FootballMatch[]> {
    const cacheKey = 'espn-arg1-scoreboard';
    const cached = forceRefresh ? null : this.scoreboardCache.get(cacheKey);
    if (cached) {
      console.log(`[espn] Scoreboard servido desde caché (${cached.length} partidos)`);
      return cached;
    }

    try {
      const matches = await withRetry(async () => this.fetchScoreboardWindow());
      this.scoreboardCache.set(cacheKey, matches, SCOREBOARD_CACHE_TTL_MS);
      console.log(
        `[espn] Scoreboard actualizado: ${matches.length} partido(s) en ventana de ${this.scoreboardLookaheadDays} día(s)`,
      );
      return matches;
    } catch (error) {
      console.error('[espn] Error al consultar el scoreboard:', error);
      throw error;
    }
  }

  private async fetchScoreboardWindow(): Promise<FootballMatch[]> {
    const today = new Date();
    const calendarDates: string[] = [];

    for (let offset = 0; offset < this.scoreboardLookaheadDays; offset += 1) {
      calendarDates.push(toEspnCalendarDate(addCalendarDays(today, offset)));
    }

    console.log(
      `[espn] Consultando scoreboard para ${calendarDates.length} fecha(s): ${calendarDates[0]} … ${calendarDates.at(-1)}`,
    );

    const batches = await Promise.all(
      calendarDates.map(async (calendarDate) => this.fetchScoreboardForDate(calendarDate)),
    );

    return dedupeMatchesById(batches.flat());
  }

  private async fetchScoreboardForDate(calendarDate: string): Promise<FootballMatch[]> {
    const url = buildScoreboardUrl(calendarDate);
    console.log(`[espn] GET ${url}`);

    const response = await this.fetchFn(url);
    if (!response.ok) {
      throw new Error(
        `Error al consultar ESPN (${response.status}) para ${calendarDate}: ${await response.text()}`,
      );
    }

    const data = (await response.json()) as EspnScoreboardResponse;
    const eventCount = data.events?.length ?? 0;
    const matches = mapEspnEvents(data.events ?? []);
    console.log(`[espn] ${calendarDate}: ${eventCount} evento(s) → ${matches.length} partido(s)`);
    return matches;
  }
}

function foundSummary(match: FootballMatch): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name} [${match.status}]`;
}
