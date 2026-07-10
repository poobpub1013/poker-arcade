import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import Seat from '../components/Seat.jsx';
import Card from '../components/Card.jsx';
import PotDisplay from '../components/PotDisplay.jsx';
import BettingControls from '../components/BettingControls.jsx';
import PauseMenu from '../components/PauseMenu.jsx';
import Chat from '../components/Chat.jsx';
import LeaveConfirm from '../components/LeaveConfirm.jsx';
import RematchOverlay from '../components/RematchOverlay.jsx';
import TurnOrderPanel from '../components/TurnOrderPanel.jsx';
import { TH } from '../i18n/th.js';
import { leaveGame, sendAction } from '../socket.js';
import { playTimeWarningTick } from '../components/SoundManager.js';
import { sortedHand } from '../utils/cards.js';

const ACTION_TIMEOUT_MS = 35000;
const ACTION_WARNING_MS = 10000;

// Mirrors server/game/doubtPokerRankings.js's HAND_TYPES — duplicated here
// (not imported) since the client bundle doesn't share code with the server.
const HAND_TYPES = [
  'highCard',
  'onePair',
  'twoPair',
  'threeOfAKind',
  'straight',
  'flush',
  'fullHouse',
  'fourOfAKind',
  'straightFlush',
  'royalFlush',
];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

function seatPosition(index, total) {
  const angle = Math.PI / 2 - (index * (2 * Math.PI)) / total;
  const rx = 44;
  const ry = 40;
  const left = 50 + rx * Math.cos(angle);
  const top = 50 + ry * Math.sin(angle);
  return { left: `${left}%`, top: `${top}%` };
}

function claimLabel(claim) {
  if (!claim) return '';
  const type = TH.doubtPoker.handTypeLabels[claim.type] || claim.type;
  const rank = claim.rank ? TH.doubtPoker.rankLabels[claim.rank] || claim.rank : '';
  return rank ? `${type} ${rank}` : type;
}

function announcementBadge(seat) {
  if (seat.liar) return <span className="badge badge--liar">{TH.doubtPoker.liarTag}</span>;
  if (seat.revealed) return <span className="badge badge--honest">{TH.doubtPoker.honestTag}</span>;
  if (seat.hasAnnounced && seat.announcement) {
    return <span className="badge badge--announce">{claimLabel(seat.announcement)}</span>;
  }
  return null;
}

function DoubtShowdownOverlay({ result, seats }) {
  if (!result) return null;

  if (result.type === 'uncontested') {
    const winner = seats.find((s) => s.id === result.winnerId);
    return (
      <div className="showdown-overlay">
        <div className="modal-panel">
          <p>{TH.table.uncontestedWin(winner?.name || '', result.amount)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="showdown-overlay">
      <div className="modal-panel">
        {result.reveals.map((r) => {
          const seat = seats.find((s) => s.id === r.seatId);
          return (
            <div key={r.seatId} className="showdown-row">
              <strong>{seat?.name}</strong>
              {r.revealed && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {r.holeCards.map((c, i) => (
                    <Card key={i} code={c} size="sm" />
                  ))}
                </div>
              )}
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                {claimLabel(r.announcement)} —{' '}
                {r.liar ? TH.doubtPoker.liarTag : r.revealed ? TH.doubtPoker.honestTag : TH.doubtPoker.hiddenTag}
              </span>
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

export default function DoubtPokerTable() {
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const legalActions = useGameStore((s) => s.legalActions);
  const roomMode = useGameStore((s) => s.roomMode);
  const [now, setNow] = useState(Date.now());
  const [discardSelection, setDiscardSelection] = useState(new Set());
  const [announceType, setAnnounceType] = useState(null);
  const [announceRank, setAnnounceRank] = useState(null);
  const lastTickSecondRef = useRef(null);

  useEffect(() => {
    if (!gameState || !gameState.actionDeadline) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [gameState?.phase, gameState?.currentActorSeatId, gameState?.actionDeadline]);

  const timeLeftMs = gameState?.actionDeadline ? Math.max(0, gameState.actionDeadline - now) : null;
  // Betting, announce ("what am I going to lie about?"), and doubt are all
  // timed, currentActor-driven turns sharing the same 35s clock — the
  // warning countdown/tick should fire for all three, not just betting.
  const isMyTimedTurn =
    ['betting', 'announce', 'doubt'].includes(legalActions?.phase) && gameState?.currentActorSeatId === gameState?.you;

  useEffect(() => {
    if (!isMyTimedTurn || timeLeftMs === null) {
      lastTickSecondRef.current = null;
      return;
    }
    const secondsLeft = Math.ceil(timeLeftMs / 1000);
    if (secondsLeft <= ACTION_WARNING_MS / 1000 && secondsLeft !== lastTickSecondRef.current) {
      lastTickSecondRef.current = secondsLeft;
      if (secondsLeft > 0) playTimeWarningTick(secondsLeft);
    }
  }, [isMyTimedTurn, timeLeftMs]);

  useEffect(() => {
    setDiscardSelection(new Set());
  }, [gameState?.handNumber]);

  useEffect(() => {
    setAnnounceType(null);
    setAnnounceRank(null);
  }, [gameState?.phase, gameState?.handNumber]);

  const displaySeats = useMemo(() => {
    if (!gameState) return [];
    const seats = gameState.seats.map((s) =>
      s.id === gameState.you && s.holeCards?.length
        ? { ...s, holeCards: sortedHand(s.holeCards).map((c) => c.code) }
        : s
    );
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
  const me = gameState.seats.find((s) => s.id === gameState.you);
  const showResult = gameState.lastResult && (gameState.phase === 'showdown' || gameState.phase === 'handover');

  const handleBackToHome = () => {
    leaveGame();
    navigate('/');
  };

  const toggleDiscard = (index) => {
    setDiscardSelection((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const confirmDraw = () => sendAction('draw', [...discardSelection]);
  const confirmAnnounce = () =>
    sendAction('announce', { type: announceType, rank: announceType === 'royalFlush' ? null : announceRank });
  const doDoubt = (targetId) => sendAction('doubt', targetId);
  const doPass = () => sendAction('pass');

  return (
    <div className="table-screen doubt-poker-screen">
      {roomMode === 'bot' && <PauseMenu paused={gameState.paused} />}
      {roomMode === 'multiplayer' && <LeaveConfirm />}
      {roomMode === 'multiplayer' && <Chat />}

      <div className="top-hud">
        {['draw', 'betting', 'doubt'].includes(gameState.phase) && (
          <TurnOrderPanel
            order={gameState.playOrder}
            seats={gameState.seats}
            phase={gameState.phase}
            currentActorSeatId={gameState.currentActorSeatId}
          />
        )}
        {isMyTimedTurn && timeLeftMs !== null && timeLeftMs <= ACTION_WARNING_MS && (
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
            extraBadge={announcementBadge(seat)}
          />
        ))}

        <div className="table-center">
          <PotDisplay amount={gameState.pot} />
          {gameState.phase === 'doubt' && (
            <p className="doubt-cost-line">{TH.doubtPoker.doubtCostLabel(gameState.doubtCost)}</p>
          )}
        </div>
      </div>

      {legalActions?.phase === 'draw' && me && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.drawInstructions}</p>
          <div className="doubt-draw-hand">
            {sortedHand(me.holeCards).map(({ code, index }) => (
              <div
                key={index}
                className={`choice-card-slot${discardSelection.has(index) ? ' choice-card-slot--discard' : ''}`}
                onClick={() => toggleDiscard(index)}
              >
                <Card code={code} size="lg" />
              </div>
            ))}
          </div>
          <div className="betting-controls__buttons">
            <button className="btn btn--primary" onClick={confirmDraw}>
              {TH.doubtPoker.confirmDraw} ({TH.doubtPoker.discardCount(discardSelection.size)})
            </button>
          </div>
        </div>
      )}
      {gameState.phase === 'draw' && legalActions?.phase !== 'draw' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.waitingForOpponentDraw}</p>
        </div>
      )}

      {legalActions?.phase === 'betting' && (
        <BettingControls legalActions={legalActions} pot={gameState.pot} currentBet={gameState.currentBet} />
      )}
      {gameState.phase === 'betting' && legalActions?.phase !== 'betting' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.table.waitingForOthers}</p>
        </div>
      )}

      {legalActions?.phase === 'announce' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.announceTitle}</p>
          <div className="doubt-picker-row">
            {HAND_TYPES.map((t) => (
              <button
                key={t}
                className={`chip-pill${announceType === t ? ' chip-pill--active' : ''}`}
                onClick={() => setAnnounceType(t)}
              >
                {TH.doubtPoker.handTypeLabels[t]}
              </button>
            ))}
          </div>
          {announceType && announceType !== 'royalFlush' && (
            <div className="doubt-picker-row">
              {RANKS.map((r) => (
                <button
                  key={r}
                  className={`chip-pill${announceRank === r ? ' chip-pill--active' : ''}`}
                  onClick={() => setAnnounceRank(r)}
                >
                  {TH.doubtPoker.rankLabels[r]}
                </button>
              ))}
            </div>
          )}
          <div className="betting-controls__buttons">
            <button
              className="btn btn--primary"
              disabled={!announceType || (announceType !== 'royalFlush' && !announceRank)}
              onClick={confirmAnnounce}
            >
              {TH.doubtPoker.confirmAnnounce}
            </button>
          </div>
        </div>
      )}
      {gameState.phase === 'announce' && legalActions?.phase !== 'announce' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.waitingForOpponentAnnounce}</p>
        </div>
      )}

      {legalActions?.phase === 'doubt' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.doubtCostLabel(legalActions.doubtCost)}</p>
          <div className="betting-controls__buttons doubt-target-row">
            {legalActions.targets.map((targetId) => {
              const targetSeat = gameState.seats.find((s) => s.id === targetId);
              return (
                <button
                  key={targetId}
                  className="btn btn--danger"
                  disabled={!legalActions.canAffordDoubt}
                  onClick={() => doDoubt(targetId)}
                >
                  {TH.doubtPoker.doubtButton(targetSeat?.name || '')}
                </button>
              );
            })}
            <button className="btn" onClick={doPass}>
              {TH.doubtPoker.passButton}
            </button>
          </div>
        </div>
      )}
      {gameState.phase === 'doubt' && legalActions?.phase !== 'doubt' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.doubtPoker.waitingForOpponentDoubt}</p>
        </div>
      )}

      {showResult && <DoubtShowdownOverlay result={gameState.lastResult} seats={gameState.seats} />}

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
