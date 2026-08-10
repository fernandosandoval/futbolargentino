import { describeMatchWinner } from './apiClient';
import { LEAGUE_NAME } from './constants/branding';
import { JobStore, type PersistedJob } from './jobStore';
import { LiveMatchTracker } from './liveTracker';
import {
  computeNotificationTimes,
  emailSubjects,
  formatMatchSummary,
  isFutureDate,
} from './utils/time';
import { translateTeamName } from './utils/translations';
import {
  oneHourBeforeHtml,
  kickoffHtml,
  matchResultHtml,
} from './utils/emailTemplates';
import type {
  EmailService,
  FootballDataApi,
  MatchInfo,
  ScheduleJob,
  SchedulerAdapter,
} from './types';

export interface MatchSchedulerOptions {
  apiClient: FootballDataApi;
  emailService: EmailService;
  scheduler: SchedulerAdapter;
  jobStore?: JobStore;
  matchDurationMinutes?: number;
  oneHourBeforeMinutes?: number;
  liveTrackingPollIntervalMs?: number;
  now?: () => Date;
}

export class MatchScheduler {
  private readonly apiClient: FootballDataApi;
  private readonly emailService: EmailService;
  private readonly scheduler: SchedulerAdapter;
  private readonly jobStore: JobStore | null;
  private readonly matchDurationMinutes: number;
  private readonly oneHourBeforeMinutes: number;
  private readonly liveTrackingPollIntervalMs: number;
  private readonly now: () => Date;
  private activeJobs: ScheduleJob[] = [];
  private scheduledMatchIds: number[] = [];
  private liveTrackers: Map<number, LiveMatchTracker> = new Map();

  constructor(options: MatchSchedulerOptions) {
    this.apiClient = options.apiClient;
    this.emailService = options.emailService;
    this.scheduler = options.scheduler;
    this.jobStore = options.jobStore ?? null;
    this.matchDurationMinutes = options.matchDurationMinutes ?? 115;
    this.oneHourBeforeMinutes = options.oneHourBeforeMinutes ?? 60;
    this.liveTrackingPollIntervalMs = options.liveTrackingPollIntervalMs ?? 60_000;
    this.now = options.now ?? (() => new Date());
  }

  async initialize(): Promise<MatchInfo[]> {
    await this.reconcileMissedJobs();

    const matches = await this.apiClient.getUpcomingMatches();
    if (matches.length === 0) {
      console.log(`[scheduler] No hay próximos partidos programados en la ${LEAGUE_NAME}.`);
      return [];
    }

    console.log(`[scheduler] Programando notificaciones para ${matches.length} partido(s).`);
    this.scheduleAllMatches(matches);
    return matches;
  }

  private async reconcileMissedJobs(): Promise<void> {
    if (!this.jobStore) return;

    const missedJobs = this.jobStore.getMissedJobs();
    if (missedJobs.length === 0) return;

    console.log(`[scheduler] Reconciliando ${missedJobs.length} job(s) perdido(s)...`);

    for (const job of missedJobs) {
      if (job.type === 'match-end-check') {
        console.log(`[scheduler] Job perdido ${job.id}: verificando resultado del partido ${job.matchId}`);
        try {
          await this.checkMatchResultAndNotify(job.matchId);
        } catch (error) {
          console.error(`[scheduler] Error al reconciliar job ${job.id}:`, error);
        }
      } else if (job.type === 'one-hour-before' || job.type === 'kickoff') {
        const scheduledAt = new Date(job.scheduledAt);
        const elapsed = Date.now() - scheduledAt.getTime();
        if (elapsed < 30 * 60 * 1000) {
          console.log(`[scheduler] Job perdido ${job.id}: hace < 30 min, enviando notificación`);
          try {
            const match = await this.apiClient.getMatchById(job.matchId);
            const matchInfo = this.apiClient.toMatchInfo(match);
            if (job.type === 'one-hour-before') {
              await this.sendOneHourBeforeEmail(matchInfo);
            } else {
              await this.sendKickoffEmail(matchInfo);
            }
          } catch (error) {
            console.error(`[scheduler] Error al reconciliar job ${job.id}:`, error);
          }
        } else {
          console.log(`[scheduler] Job perdido ${job.id}: demasiado tiempo transcurrido, omitiendo`);
          this.jobStore.markSkipped(job.id);
        }
      }
    }
  }

  scheduleAllMatches(matches: MatchInfo[]): void {
    this.clearScheduledJobs();
    this.scheduledMatchIds = matches.map((match) => match.id);

    for (const match of matches) {
      this.scheduleNotificationsForMatch(match);
    }
  }

  scheduleNotificationsForMatch(match: MatchInfo): void {
    const now = this.now();
    const times = computeNotificationTimes(
      match.startTime,
      this.matchDurationMinutes,
      this.oneHourBeforeMinutes,
    );
    const subjects = emailSubjects(match);

    console.log(`[scheduler] Partido: ${formatMatchSummary(match)}`);

    if (isFutureDate(times.oneHourBefore, now)) {
      this.scheduleJob(
        match,
        'one-hour-before',
        times.oneHourBefore,
        `one-hour-before-${match.id}`,
        async () => {
          await this.sendOneHourBeforeEmail(match, subjects.oneHourBefore);
        },
      );
    } else {
      console.log(`[scheduler] Match ${match.id}: notificación de 1 hora omitida (ya pasó).`);
    }

    if (isFutureDate(times.kickoff, now)) {
      this.scheduleJob(
        match,
        'kickoff',
        times.kickoff,
        `kickoff-${match.id}`,
        async () => {
          await this.sendKickoffEmail(match, subjects.kickoff);
          this.startLiveTracking(match);
        },
      );
    } else if (match.status === 'IN_PLAY' || match.status === 'PAUSED') {
      console.log(`[scheduler] Match ${match.id}: partido en curso, iniciando live tracking`);
      this.startLiveTracking(match);
    } else {
      console.log(`[scheduler] Match ${match.id}: kickoff omitido (ya pasó).`);
    }

    if (isFutureDate(times.estimatedEnd, now)) {
      this.scheduleJob(
        match,
        'match-end-check',
        times.estimatedEnd,
        `match-end-check-${match.id}`,
        async () => {
          await this.checkMatchResultAndNotify(match);
        },
      );
    } else if (match.status !== 'FINISHED' && match.status !== 'AWARDED') {
      console.log(`[scheduler] Match ${match.id}: fin estimado ya pasó; se verifica de inmediato.`);
      void this.checkMatchResultAndNotify(match);
    }
  }

  private scheduleJob(
    match: MatchInfo,
    jobType: PersistedJob['type'],
    scheduledAt: Date,
    jobName: string,
    handler: () => Promise<void>,
  ): void {
    if (this.jobStore) {
      const job: PersistedJob = {
        id: jobName,
        matchId: match.id,
        type: jobType,
        scheduledAt: scheduledAt.toISOString(),
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      this.jobStore.saveJob(job);
    }

    this.activeJobs.push(
      this.scheduler.scheduleAt(scheduledAt, jobName, async () => {
        await handler();
        if (this.jobStore) {
          this.jobStore.markSent(jobName);
        }
      }),
    );
  }

  private startLiveTracking(match: MatchInfo): void {
    if (this.liveTrackers.has(match.id)) {
      return;
    }

    const tracker = new LiveMatchTracker({
      apiClient: this.apiClient,
      emailService: this.emailService,
      match,
      pollIntervalMs: this.liveTrackingPollIntervalMs,
    });

    this.liveTrackers.set(match.id, tracker);
    tracker.start();
  }

  /** @deprecated Preferí scheduleNotificationsForMatch; se mantiene por compatibilidad en tests. */
  scheduleNotifications(match: MatchInfo): void {
    this.clearScheduledJobs();
    this.scheduledMatchIds = [match.id];
    this.scheduleNotificationsForMatch(match);
  }

  async sendOneHourBeforeEmail(match: MatchInfo, subject?: string): Promise<void> {
    const emailSubject = subject ?? emailSubjects(match).oneHourBefore;
    const body = `Falta 1 hora para el partido entre ${translateTeamName(match.homeTeamName)} y ${translateTeamName(match.awayTeamName)}.`;
    const html = oneHourBeforeHtml(match);
    await this.emailService.send(emailSubject, body, { html });
    console.log(`[scheduler] Email enviado (1h): ${emailSubject}`);
  }

  async sendKickoffEmail(match: MatchInfo, subject?: string): Promise<void> {
    const emailSubject = subject ?? emailSubjects(match).kickoff;
    const body = `Comenzó el partido entre ${translateTeamName(match.homeTeamName)} y ${translateTeamName(match.awayTeamName)}.`;
    const html = kickoffHtml(match);
    await this.emailService.send(emailSubject, body, { html });
    console.log(`[scheduler] Email enviado (inicio): ${emailSubject}`);
  }

  async checkMatchResultAndNotify(matchInfo: MatchInfo | number): Promise<void> {
    const matchId = typeof matchInfo === 'number' ? matchInfo : matchInfo.id;
    const fallbackNames =
      typeof matchInfo === 'number'
        ? null
        : { home: matchInfo.homeTeamName, away: matchInfo.awayTeamName };

    const match = await this.apiClient.getMatchById(matchId);

    if (match.status !== 'FINISHED' && match.status !== 'AWARDED') {
      console.log(
        `[scheduler] El partido ${matchId} aún no finalizó (estado: ${match.status}). No se envía email de resultado.`,
      );
      return;
    }

    const homeName = getTeamNameFromFinished(match.homeTeam.name, fallbackNames?.home);
    const awayName = getTeamNameFromFinished(match.awayTeam.name, fallbackNames?.away);
    const subject = `Terminó el partido: ${homeName} vs ${awayName}`;
    const body = describeMatchWinner(match);

    const matchInfoForEmail = this.apiClient.toMatchInfo(match);
    const html = matchResultHtml(matchInfoForEmail, body);

    await this.emailService.send(subject, body, { html });
    console.log(`[scheduler] Email enviado (fin): ${subject}`);
  }

  clearScheduledJobs(): void {
    for (const job of this.activeJobs) {
      job.cancel();
    }
    this.activeJobs = [];
    this.scheduledMatchIds = [];
  }

  stopAllLiveTrackers(): void {
    for (const tracker of this.liveTrackers.values()) {
      tracker.stop();
    }
    this.liveTrackers.clear();
  }

  getScheduledMatchIds(): number[] {
    return [...this.scheduledMatchIds];
  }
}

function getTeamNameFromFinished(
  apiName: string | null | undefined,
  fallback?: string,
): string {
  if (typeof apiName === 'string' && apiName.length > 0) {
    return translateTeamName(apiName);
  }
  return translateTeamName(fallback ?? 'Por definir');
}
