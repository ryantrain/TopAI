import HistoryPage from '../../page';

export default async function SavedRunPage({ params }) {
  const { sessionId, round } = await params;
  return <HistoryPage savedSessionId={sessionId} savedRound={round}/>;
}
