import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import Seat from '../components/Seat.jsx';
import Card from '../components/Card.jsx';
import CommunityCards from '../components/CommunityCards.jsx';
import PotDisplay from '../components/PotDisplay.jsx';
import BettingControls from '../components/BettingControls.jsx';
import PauseMenu from '../components/PauseMenu.jsx';
import Chat from '../components/Chat.jsx';
import LeaveConfirm from '../components/LeaveConfirm.jsx';
import RematchOverlay from '../components/RematchOverlay.jsx';
import TurnOrderPanel from '../components/TurnOrderPanel.jsx';
import RulesHelp from '../components/RulesHelp.jsx';
import ChoicePokerTable from './ChoicePokerTable.jsx';
import DoubtPokerTable from './DoubtPokerTable.jsx';
import { TH } from '../i18n/th.js';
import { leaveGame } from '../socket.js';
import { playTimeWarningTick } from '../components/SoundManager.js';
import { sortedHand } from '../utils/cards.js';

const ACTION_TIMEOUT_MS = 35000;
const ACTION_WARNING_MS = 10000;

function seatPosition(index, total) {
  const angle = Math.PI / 2 - (index * (2 * Math.PI)) / total;
  const rx = 44;
  const ry = 40;
  const left = 50 + rx * Math.cos(angle);
  const top = 50 + ry * Math.sin(angle);
  return { left: `${left}%`, top: `${top}%` };
}

function ShowdownOverlay({ result, seats, board }) {
  if (!result) return null;

  if (result.type === 'uncontested') {
    const winner = seats.find((s) => s.id === result.winnerId);
    return (
      <div className="showdown-overlay">
        <div className="modal-panel">
          {board.length > 0 && <CommunityCards board={board} />}
          <p>{TH.table.uncontestedWin(winner?.name || '', result.amount)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="showdown-overlay">
      <div className="modal-panel">
        {board.length > 0 && <CommunityCards board={board} />}
        {result.reveals.map((r) => {
          const seat = seats.find((s) => s.id === r.seatId);
          return (
            <div key={r.seatId} className="showdown-row">
              <strong>{seat?.name}</strong>
              <div style={{ display: 'flex', gap: 4 }}>
                {r.holeCards.map((c, i) => (
                  <Card key={i} code={c} size="sm" />
                ))}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{r.description}</span>
            </div>
          );
        })}
        {result.pots.map((p, i) => (
          <p key={i} style={{ margin: 0 }}>
            Pot {i + 1}: {p.amount.toLocaleString()} →{' '}
            {p.winners.map((id) => seats.find((s) => s.id === id)?.name).join(', ')}
          </p>
        ))}
      </div>
    </div>
  );
}

// Choice Poker's rules (no streets/blinds, no fold/call, a draw phase, and
// reversible hand rankings) don't fit this component's shape at all, so it
// gets its own dedicated screen — this wrapper just routes to it before any
// of the Hold'em/PLO-specific hooks below ever run.
export default function Table() {
  const gameState = useGameStore((s) => s.gameState);
  if (gameState?.variantId === 'choice-poker') return <ChoicePokerTable />;
  if (gameState?.variantId === 'doubt-poker') return <DoubtPokerTable />;
  return <StreetsTable />;
}

function StreetsTable() {
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const legalActions = useGameStore((s) => s.legalActions);
  const roomMode = useGameStore((s) => s.roomMode);
  const [now, setNow] = useState(Date.now());
  const lastTickSecondRef = useRef(null);

  useEffect(() => {
    if (!gameState || gameState.phase !== 'betting' || !gameState.actionDeadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [gameState?.phase, gameState?.currentActorSeatId, gameState?.actionDeadline]);

  const timeLeftMs = gameState?.actionDeadline ? Math.max(0, gameState.actionDeadline - now) : null;
  const isMyTurn = gameState?.phase === 'betting' && gameState?.currentActorSeatId === gameState?.you;

  useEffect(() => {
    if (!isMyTurn || timeLeftMs === null) {
      lastTickSecondRef.current = null;
      return;
    }
    const secondsLeft = Math.ceil(timeLeftMs / 1000);
    if (secondsLeft <= ACTION_WARNING_MS / 1000 && secondsLeft !== lastTickSecondRef.current) {
      lastTickSecondRef.current = secondsLeft;
      if (secondsLeft > 0) playTimeWarningTick(secondsLeft);
    }
  }, [isMyTurn, timeLeftMs]);

  const displaySeats = useMemo(() => {
    if (!gameState) return [];
    // PLO's 4-card hand is much harder to scan unsorted — Hold'em's 2 cards
    // don't need it and some players use left/right as a mnemonic, so this
    // only applies to PLO.
    const seats =
      gameState.variantId === 'plo'
        ? gameState.seats.map((s) =>
            s.id === gameState.you && s.holeCards?.length
              ? { ...s, holeCards: sortedHand(s.holeCards).map((c) => c.code) }
              : s
          )
        : gameState.seats;
    const viewerIdx = seats.findIndex((s) => s.id === gameState.you);
    if (viewerIdx === -1) return seats;
    return [...seats.slice(viewerIdx), ...seats.slice(0, viewerIdx)];
  }, [gameState]);

  if (!gameState) {
    return (
      <div className="screen">
        <p>{TH.common.loading}</p>
      </div>
    );
  }

  const total = displaySeats.length;
  const showResult = gameState.lastResult && (gameState.phase === 'showdown' || gameState.phase === 'handover');

  const handleBackToHome = () => {
    leaveGame();
    navigate('/');
  };

  return (
    <div className="table-screen">
      {roomMode === 'bot' && <PauseMenu paused={gameState.paused} />}
      {roomMode === 'multiplayer' && <LeaveConfirm />}
      {roomMode === 'multiplayer' && <Chat />}
      <RulesHelp variantId={gameState.variantId} />

      <div className="top-hud">
        {gameState.bigBlind != null && (
          <div className="blind-info">
            <span>{TH.table.blindLevel(gameState.smallBlind, gameState.bigBlind)}</span>
            {gameState.handsUntilBlindIncrease != null && (
              <span className="blind-info__next">{TH.table.nextBlindIn(gameState.handsUntilBlindIncrease)}</span>
            )}
          </div>
        )}
        {gameState.phase === 'betting' && (
          <TurnOrderPanel
            order={gameState.playOrder}
            seats={gameState.seats}
            phase={gameState.phase}
            currentActorSeatId={gameState.currentActorSeatId}
          />
        )}
        {isMyTurn && timeLeftMs !== null && timeLeftMs <= ACTION_WARNING_MS && (
          <div className="turn-warning">{TH.table.timeRemaining(Math.ceil(timeLeftMs / 1000))}</div>
        )}
      </div>

      <div className="table-felt">
        {displaySeats.map((seat, i) => (
          <Seat
            key={seat.id}
            seat={seat}
            isActor={gameState.currentActorSeatId === seat.id}
            isYou={seat.id === gameState.you}
            timeLeftMs={gameState.currentActorSeatId === seat.id ? timeLeftMs : null}
            totalTimeMs={ACTION_TIMEOUT_MS}
            warningMs={ACTION_WARNING_MS}
            style={seatPosition(i, total)}
          />
        ))}

        <div className="table-center">
          <CommunityCards board={gameState.board} />
          <PotDisplay amount={gameState.pot} />
        </div>
      </div>

      {isMyTurn && (
        <BettingControls legalActions={legalActions} pot={gameState.pot} currentBet={gameState.currentBet} />
      )}

      {showResult && (
        <ShowdownOverlay result={gameState.lastResult} seats={gameState.seats} board={gameState.board} />
      )}

      {gameState.phase === 'gameover' && roomMode === 'multiplayer' && (
        <RematchOverlay winnerName={gameState.seats.find((s) => s.id === gameState.winnerId)?.name || ''} />
      )}
      {gameState.phase === 'gameover' && roomMode !== 'multiplayer' && (
        <div className="gameover-overlay">
          <div className="modal-panel" style={{ textAlign: 'center' }}>
            <h2>{TH.table.gameOver}</h2>
            <p>{TH.table.winnerIs(gameState.seats.find((s) => s.id === gameState.winnerId)?.name || '')}</p>
            <button className="btn btn--primary" onClick={handleBackToHome}>
              {TH.table.backToHome}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
