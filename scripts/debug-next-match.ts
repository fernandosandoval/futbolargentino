import {
  buildScoreboardUrl,
  FootballDataClient,
  mapEspnEvents,
  type EspnScoreboardResponse,
} from '../src/apiClient';
import { LEAGUE_NAME } from '../src/constants/branding';
import { httpFetch } from '../src/httpFetch';
import { formatCuantoFalta } from '../src/utils/time';

function formatMatchLine(match: {
  id: number;
  utcDate: string;
  status: string;
  homeTeam: { name: string };
  awayTeam: { name: string };
  score?: { fullTime?: { homeTeam: number | null; awayTeam: number | null } };
}): string {
  const homeScore = match.score?.fullTime?.homeTeam;
  const awayScore = match.score?.fullTime?.awayTeam;
  const score =
    homeScore !== null &&
    homeScore !== undefined &&
    awayScore !== null &&
    awayScore !== undefined
      ? ` (${homeScore}-${awayScore})`
      : '';

  return [
    match.utcDate,
    `[${match.status}]`,
    `${match.homeTeam.name} vs ${match.awayTeam.name}${score}`,
    `(id: ${match.id})`,
  ].join(' ');
}

async function fetchRawScoreboard(date?: string): Promise<{
  url: string;
  status: number;
  eventCount: number;
  matches: ReturnType<typeof mapEspnEvents>;
}> {
  const url = buildScoreboardUrl(date);
  const response = await httpFetch(url);

  if (!response.ok) {
    throw new Error(`Error al consultar ESPN (${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as EspnScoreboardResponse;
  const matches = mapEspnEvents(data.events ?? []);

  return {
    url,
    status: response.status,
    eventCount: data.events?.length ?? 0,
    matches,
  };
}

function printSection(title: string): void {
  console.log(`\n--- ${title}`);
}

async function main(): Promise<void> {
  const dateArg = process.argv[2];

  console.log(`Diagnóstico ESPN - ${LEAGUE_NAME}`);
  if (dateArg) {
    console.log(`Fecha solicitada (YYYYMMDD): ${dateArg}`);
  }

  printSection('Scoreboard crudo');
  const raw = await fetchRawScoreboard(dateArg);
  console.log('URL:', raw.url);
  console.log('HTTP', raw.status, '| eventos ESPN:', raw.eventCount, '| partidos mapeados:', raw.matches.length);

  if (raw.matches.length === 0) {
    console.log('Sin partidos en el scoreboard.');
  } else {
    for (const match of raw.matches) {
      console.log(formatMatchLine(match));
    }
  }

  const byStatus = raw.matches.reduce<Record<string, number>>((acc, match) => {
    acc[match.status] = (acc[match.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log('Por estado:', byStatus);

  const apiClient = new FootballDataClient();

  printSection('Próximos partidos (cliente)');
  const upcoming = await apiClient.getUpcomingMatches();
  if (upcoming.length === 0) {
    console.log('Ninguno.');
  } else {
    for (const match of upcoming.slice(0, 10)) {
      console.log(
        match.startTime.toISOString(),
        `${match.homeTeamName} vs ${match.awayTeamName}`,
        `(id: ${match.id})`,
      );
    }
    if (upcoming.length > 10) {
      console.log(`... y ${upcoming.length - 10} más`);
    }
  }

  printSection('Partidos de hoy (cliente)');
  const today = await apiClient.getTodaysMatches();
  if (today.length === 0) {
    console.log('Ninguno.');
  } else {
    for (const match of today) {
      console.log(
        match.startTime.toISOString(),
        `${match.homeTeamName} vs ${match.awayTeamName}`,
        `[${match.status}]`,
      );
    }
  }

  printSection('Próximo partido (cliente)');
  const next = await apiClient.getNextMatch();
  if (!next) {
    console.log(`No hay próximos partidos programados en la ${LEAGUE_NAME}.`);
    return;
  }

  console.log(
    next.startTime.toISOString(),
    `${next.homeTeamName} vs ${next.awayTeamName}`,
    `(id: ${next.id}, estado: ${next.status})`,
  );
  console.log(formatCuantoFalta(next.homeTeamName, next.awayTeamName, next.startTime));
}

main().catch((error) => {
  console.error('Error en diagnóstico:', error);
  process.exit(1);
});
