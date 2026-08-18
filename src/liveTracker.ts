import type { EmailService, FootballDataApi, MatchInfo, GoalEvent, BookingEvent } from './types';
import {
  goalNotificationHtml,
  halftimeHtml,
  matchResultHtml,
  redCardNotificationHtml,
} from './utils/emailTemplates';
import { describeMatchWinner } from './apiClient';

export interface LiveTrackerOptions {
  apiClient: FootballDataApi;
  emailService: EmailService;
  match: MatchInfo;
  pollIntervalMs?: number;
}

export class LiveMatchTracker {
  private readonly apiClient: FootballDataApi;
  private readonly emailService: EmailService;
  private readonly match: MatchInfo;
  private readonly pollIntervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastGoalCount = 0;
  private lastBookingCount = 0;
  private lastStatus: string;
  private halftimeEmailSent = false;
  private started = false;

  constructor(options: LiveTrackerOptions) {
    this.apiClient = options.apiClient;
    this.emailService = options.emailService;
    this.match = options.match;
    this.pollIntervalMs = options.pollIntervalMs ?? 60_000;
    this.lastStatus = options.match.status;
    this.lastGoalCount = options.match.goals.length;
    this.lastBookingCount = options.match.bookings.length;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    console.log(`[liveTracker] Iniciando tracking para partido ${this.match.id}`);

    this.intervalId = setInterval(() => {
      void this.poll().catch((error) => {
        console.error(`[liveTracker] Error en polling del partido ${this.match.id}:`, error);
      });
    }, this.pollIntervalMs);

    void this.poll().catch((error) => {
      console.error(`[liveTracker] Error en polling inicial del partido ${this.match.id}:`, error);
    });
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.started = false;
    console.log(`[liveTracker] Tracking detenido para partido ${this.match.id}`);
  }

  isRunning(): boolean {
    return this.started && this.intervalId !== null;
  }

  private async poll(): Promise<void> {
    const match = await this.apiClient.getMatchById(this.match.id);

    if (match.status !== this.lastStatus) {
      console.log(`[liveTracker] Status cambió: ${this.lastStatus} → ${match.status}`);
      await this.handleStatusChange(match.status);
      this.lastStatus = match.status;
    }

    const currentGoals = match.goals?.length ?? 0;
    if (currentGoals > this.lastGoalCount) {
      await this.handleNewGoals(match.goals ?? [], this.lastGoalCount);
      this.lastGoalCount = currentGoals;
    }

    const currentBookings = match.bookings?.length ?? 0;
    if (currentBookings > this.lastBookingCount) {
      await this.handleNewBookings(match.bookings ?? [], this.lastBookingCount);
      this.lastBookingCount = currentBookings;
    }

    if (match.status === 'FINISHED' || match.status === 'AWARDED') {
      await this.handleMatchFinished(match);
      this.stop();
    }
  }

  private async handleStatusChange(newStatus: string): Promise<void> {
    if (newStatus === 'PAUSED' && !this.halftimeEmailSent) {
      this.halftimeEmailSent = true;
      const match = await this.apiClient.getMatchById(this.match.id);
      // En descanso el marcador actual es el del entretiempo si ESPN no envía halfTime.
      const htHome =
        match.score?.halfTime?.homeTeam ??
        match.score?.fullTime?.homeTeam ??
        this.match.halfTimeHome ??
        0;
      const htAway =
        match.score?.halfTime?.awayTeam ??
        match.score?.fullTime?.awayTeam ??
        this.match.halfTimeAway ??
        0;
      const updatedMatch: MatchInfo = {
        ...this.match,
        status: match.status as MatchInfo['status'],
        halfTimeHome: htHome,
        halfTimeAway: htAway,
      };

      const home = match.homeTeam.name ?? this.match.homeTeamName;
      const away = match.awayTeam.name ?? this.match.awayTeamName;
      const subject = `Descanso: ${home} vs ${away}`;
      const html = halftimeHtml(updatedMatch);

      await this.emailService.send(subject, `Descanso: ${home} ${htHome} - ${htAway} ${away}`, { html });
      console.log(`[liveTracker] Email de descanso enviado para partido ${this.match.id}`);
    }
  }

  private async handleNewGoals(goals: GoalEvent[], fromIndex: number): Promise<void> {
    const newGoals = goals.slice(fromIndex);
    for (const goal of newGoals) {
      const scorer = goal.scorer.name;
      const team = goal.team.name;
      const subject = `¡Gol de ${team}! ${scorer}`;
      const html = goalNotificationHtml(this.match, goal);

      await this.emailService.send(subject, `¡Gol de ${team}! ${scorer} al ${goal.minute}'. ${this.match.homeTeamName} ${goal.score.home} - ${goal.score.away} ${this.match.awayTeamName}`, { html });
      console.log(`[liveTracker] Email de gol enviado: ${scorer} (${team})`);
    }
  }

  private async handleNewBookings(bookings: BookingEvent[], fromIndex: number): Promise<void> {
    const newBookings = bookings.slice(fromIndex);
    for (const booking of newBookings) {
      if (booking.card === 'RED' || booking.card === 'YELLOW_RED') {
        const player = booking.player.name;
        const team = booking.team.name;
        const subject = `🟥 Tarjeta roja: ${player}`;
        const html = redCardNotificationHtml(this.match, booking);

        await this.emailService.send(subject, `Tarjeta roja para ${player} (${team}) al ${booking.minute}'`, { html });
        console.log(`[liveTracker] Email de tarjeta roja enviado: ${player}`);
      }
    }
  }

  private async handleMatchFinished(match: { status: string; score?: { fullTime?: { homeTeam?: number | null; awayTeam?: number | null } } }): Promise<void> {
    const homeName = this.match.homeTeamName;
    const awayName = this.match.awayTeamName;

    // Obtener el match actualizado de la API para tener goles y marcador completos
    const freshMatch = await this.apiClient.getMatchById(this.match.id);
    const freshHome = freshMatch.score?.fullTime?.homeTeam ?? 0;
    const freshAway = freshMatch.score?.fullTime?.awayTeam ?? 0;

    const updatedMatch: MatchInfo = {
      ...this.match,
      status: freshMatch.status as MatchInfo['status'],
      goals: freshMatch.goals ?? [],
      bookings: freshMatch.bookings ?? [],
      substitutions: freshMatch.substitutions ?? [],
      halfTimeHome: freshMatch.score?.halfTime?.homeTeam ?? this.match.halfTimeHome,
      halfTimeAway: freshMatch.score?.halfTime?.awayTeam ?? this.match.halfTimeAway,
      fullTimeHome: freshHome,
      fullTimeAway: freshAway,
      duration: (freshMatch.score?.duration as MatchInfo['duration']) ?? this.match.duration,
      attendance: freshMatch.attendance ?? this.match.attendance,
    };

    const fakeMatch = {
      score: {
        fullTime: { homeTeam: freshHome, awayTeam: freshAway },
        winner: freshHome > freshAway ? 'HOME_TEAM' : freshAway > freshHome ? 'AWAY_TEAM' : 'DRAW',
      },
      homeTeam: { name: homeName },
      awayTeam: { name: awayName },
    } as Parameters<typeof describeMatchWinner>[0];

    const description = describeMatchWinner(fakeMatch);
    const subject = `Terminó: ${homeName} ${freshHome} - ${freshAway} ${awayName}`;
    const html = matchResultHtml(updatedMatch, description);

    await this.emailService.send(subject, description, { html });
    console.log(`[liveTracker] Email de resultado enviado para partido ${this.match.id}`);
  }
}
