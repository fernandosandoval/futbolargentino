import { FootballDataClient } from './apiClient';
import { LEAGUE_NAME } from './constants/branding';
import { formatCuantoFalta } from './utils/time';

async function main(): Promise<void> {
  const apiClient = new FootballDataClient();

  const nextMatch = await apiClient.getNextMatch();

  if (!nextMatch) {
    console.log(`No hay próximos partidos programados en la ${LEAGUE_NAME}.`);
    process.exit(0);
  }
  console.log(
    formatCuantoFalta(nextMatch.homeTeamName, nextMatch.awayTeamName, nextMatch.startTime),
  );
}

main().catch((error) => {
  console.error('Error al consultar el próximo partido:', error);
  process.exit(1);
});
