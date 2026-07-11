import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import Card from '../components/Card.jsx';
import DefaultAvatar from '../components/DefaultAvatar.jsx';
import PauseMenu from '../components/PauseMenu.jsx';
import Chat from '../components/Chat.jsx';
import LeaveConfirm from '../components/LeaveConfirm.jsx';
import RematchOverlay from '../components/RematchOverlay.jsx';
import RulesHelp from '../components/RulesHelp.jsx';
import { TH } from '../i18n/th.js';
import { leaveGame, sendAction } from '../socket.js';

function PlayerRow({ seat, isOpponent, discardSelection, onToggleDiscard, canToggle }) {
  if (!seat) return null;
  const drawnSet = new Set(seat.drawnIndices || []);
  return (
    <div className={`choice-row ${isOpponent ? 'choice-row--opponent' : 'choice-row--you'}`}>
      <div className="choice-row__info">
        {seat.avatar ? (
          <img src={seat.avatar} alt={seat.name} className="choice-row__avatar" />
        ) : (
          <DefaultAvatar seed={seat.name} size={48} />
        )}
        <div className="choice-row__meta">
          <span className="seat__name">{seat.name}</span>
          <span>{seat.chips.toLocaleString()}</span>
        </div>
      </div>
      <div className="choice-row__hand">
        {seat.hand.map((c, i) => {
          const isNew = drawnSet.has(i);
          return (
            <div
              key={i}
              className={`choice-card-slot${isNew ? ' choice-card-slot--new' : ''}${
                canToggle && discardSelection?.has(i) ? ' choice-card-slot--discard' : ''
              }`}
              onClick={() => canToggle && onToggleDiscard(i)}
            >
              {isNew && <span className="choice-card-slot__tag">{TH.choicePoker.newCardTag}</span>}
              <Card code={c} size={isOpponent ? 'lg' : 'xl'} />
            </div>
          );
        })}
      </div>
      <div className="choice-row__bet">
        {seat.betThisHand > 0 && <span className="choice-row__bet-amount">{seat.betThisHand.toLocaleString()}</span>}
      </div>
    </div>
  );
}

function ChoiceShowdownOverlay({ result, seats }) {
  if (!result) return null;
  const isTie = result.winnerIds.length > 1;
  return (
    <div className="showdown-overlay">
      <div className="modal-panel">
        <p style={{ margin: 0, fontWeight: 700 }}>{TH.choicePoker.directionLabel(result.direction)}</p>
        {result.reveals.map((r) => {
          const seat = seats.find((s) => s.id === r.seatId);
          return (
            <div key={r.seatId} className="showdown-row">
              <strong>{seat?.name}</strong>
              <div style={{ display: 'flex', gap: 4 }}>
                {r.hand.map((c, i) => (
                  <Card key={i} code={c} size="sm" />
                ))}
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{r.description}</span>
            </div>
          );
        })}
        {isTie ? (
          <p style={{ margin: 0 }}>{TH.choicePoker.tieSplit(result.potAmount)}</p>
        ) : (
          <p style={{ margin: 0 }}>
            {TH.choicePoker.potWon(seats.find((s) => s.id === result.winnerIds[0])?.name || '', result.potAmount)}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ChoicePokerTable() {
  const navigate = useNavigate();
  const gameState = useGameStore((s) => s.gameState);
  const legalActions = useGameStore((s) => s.legalActions);
  const roomMode = useGameStore((s) => s.roomMode);
  const [discardSelection, setDiscardSelection] = useState(new Set());
  const [raiseAmount, setRaiseAmount] = useState(0);

  useEffect(() => {
    setDiscardSelection(new Set());
  }, [gameState?.handNumber]);

  useEffect(() => {
    if (legalActions?.phase === 'betting') setRaiseAmount(legalActions.minRaiseTo);
  }, [legalActions?.minRaiseTo, legalActions?.phase]);

  if (!gameState) {
    return (
      <div className="screen">
        <p>{TH.common.loading}</p>
      </div>
    );
  }

  const me = gameState.seats.find((s) => s.id === gameState.you);
  const opponent = gameState.seats.find((s) => s.id !== gameState.you);
  const phase = gameState.phase;
  const showResult = gameState.lastResult && (phase === 'showdown' || phase === 'handover');
  const gameOver = phase === 'gameover';

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
  const confirmRaise = () => sendAction('raise', raiseAmount);
  const quickAdd = (delta) => {
    if (!legalActions || legalActions.phase !== 'betting') return;
    setRaiseAmount((prev) => Math.min(legalActions.maxRaiseTo, Math.max(legalActions.minRaiseTo, prev + delta)));
  };
  const stand = () => sendAction('stand');
  const chooseDirection = (direction) => sendAction(direction);

  return (
    <div className="table-screen choice-poker-screen">
      {roomMode === 'bot' && <PauseMenu paused={gameState.paused} />}
      {roomMode === 'multiplayer' && <LeaveConfirm />}
      {roomMode === 'multiplayer' && <Chat />}
      <RulesHelp variantId="choice-poker" />

      <div className="choice-board">
        <PlayerRow seat={opponent} isOpponent />

        <div className="choice-board__center">
          <span className="choice-vs">VS</span>
          <div className="choice-dashboard">
            <div className="choice-dashboard__stat">
              <span className="choice-dashboard__label">{TH.choicePoker.potLabel}</span>
              <span className="choice-dashboard__value choice-dashboard__value--gold">
                {gameState.pot.toLocaleString()}
              </span>
            </div>
            {(phase === 'betting' || phase === 'choice') && (
              <div className="choice-dashboard__stat">
                <span className="choice-dashboard__label">{TH.choicePoker.currentBetLabel}</span>
                <span className="choice-dashboard__value choice-dashboard__value--red">
                  {gameState.currentBet.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <PlayerRow
          seat={me}
          isOpponent={false}
          discardSelection={discardSelection}
          onToggleDiscard={toggleDiscard}
          canToggle={legalActions?.phase === 'draw'}
        />
      </div>

      {legalActions?.phase === 'draw' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.choicePoker.drawInstructions}</p>
          <div className="betting-controls__buttons">
            <button className="btn btn--primary" onClick={confirmDraw}>
              {TH.choicePoker.confirmDraw} ({TH.choicePoker.discardCount(discardSelection.size)})
            </button>
          </div>
        </div>
      )}
      {phase === 'draw' && !legalActions && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.choicePoker.waitingForOpponentDraw}</p>
        </div>
      )}

      {legalActions?.phase === 'betting' && (
        <div className="betting-controls">
          <div className="betting-controls__raise">
            <input
              type="range"
              min={legalActions.minRaiseTo}
              max={legalActions.maxRaiseTo}
              value={raiseAmount}
              onChange={(e) => setRaiseAmount(Number(e.target.value))}
            />
            <div className="chip-row">
              {[1, 5, 10, 100].map((delta) => (
                <button key={delta} className="chip-pill" onClick={() => quickAdd(delta)}>
                  +{delta}
                </button>
              ))}
            </div>
          </div>
          <div className="betting-controls__buttons">
            {legalActions.canStand && (
              <button className="btn btn--danger" onClick={stand}>
                {TH.choicePoker.stand}
              </button>
            )}
            {legalActions.canRaise && (
              <button className="btn btn--primary" onClick={confirmRaise}>
                {raiseAmount >= legalActions.maxRaiseTo ? TH.table.allIn : `${TH.choicePoker.raiseTo} ${raiseAmount}`}
              </button>
            )}
          </div>
        </div>
      )}
      {phase === 'betting' && !legalActions && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.choicePoker.waitingForOpponentBet}</p>
        </div>
      )}

      {legalActions?.phase === 'choice' && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.choicePoker.choiceTitle}</p>
          <div className="betting-controls__buttons">
            <button className="btn btn--primary" onClick={() => chooseDirection('stronger')}>
              {TH.choicePoker.chooseStronger}
            </button>
            <button className="btn btn--primary" onClick={() => chooseDirection('weaker')}>
              {TH.choicePoker.chooseWeaker}
            </button>
          </div>
        </div>
      )}
      {phase === 'choice' && !legalActions && (
        <div className="betting-controls">
          <p style={{ margin: 0 }}>{TH.choicePoker.waitingForOpponentChoice}</p>
        </div>
      )}

      {showResult && <ChoiceShowdownOverlay result={gameState.lastResult} seats={gameState.seats} />}

      {gameOver && roomMode === 'multiplayer' && (
        <RematchOverlay winnerName={gameState.seats.find((s) => s.id === gameState.gameWinnerId)?.name || ''} />
      )}
      {gameOver && roomMode !== 'multiplayer' && (
        <div className="gameover-overlay">
          <div className="modal-panel" style={{ textAlign: 'center' }}>
            <h2>{TH.table.gameOver}</h2>
            <p>{TH.choicePoker.gameWinnerIs(gameState.seats.find((s) => s.id === gameState.gameWinnerId)?.name || '')}</p>
            <button className="btn btn--primary" onClick={handleBackToHome}>
              {TH.table.backToHome}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
