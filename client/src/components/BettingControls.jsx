import { useEffect, useState } from 'react';
import { TH } from '../i18n/th.js';
import { sendAction } from '../socket.js';
import ActionTimer from './ActionTimer.jsx';

export default function BettingControls({ legalActions, pot, currentBet, timeLeftMs, totalTimeMs }) {
  const [raiseTo, setRaiseTo] = useState(legalActions?.minRaiseTo || 0);

  useEffect(() => {
    if (legalActions) setRaiseTo(legalActions.minRaiseTo);
  }, [legalActions?.minRaiseTo]);

  if (!legalActions) return null;

  const { canCheck, canCall, callAmount, canRaise, minRaiseTo, maxRaiseTo } = legalActions;

  const quickRaise = (target) => setRaiseTo(Math.round(Math.min(maxRaiseTo, Math.max(minRaiseTo, target))));

  return (
    <div className="betting-controls">
      <ActionTimer timeLeftMs={timeLeftMs} totalTimeMs={totalTimeMs} />
      {canRaise && (
        <div className="betting-controls__raise">
          <input
            type="range"
            min={minRaiseTo}
            max={maxRaiseTo}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
          />
          <div className="chip-row">
            <button className="chip-pill" onClick={() => quickRaise(pot * 0.5)}>
              {TH.table.halfPot}
            </button>
            <button className="chip-pill" onClick={() => quickRaise(pot)}>
              {TH.table.fullPot}
            </button>
            <button className="chip-pill" onClick={() => quickRaise(maxRaiseTo)}>
              {TH.table.allIn}
            </button>
          </div>
        </div>
      )}
      <div className="betting-controls__buttons">
        <button className="btn btn--danger" onClick={() => sendAction('fold')}>
          {TH.table.fold}
        </button>
        {canCheck && (
          <button className="btn" onClick={() => sendAction('check')}>
            {TH.table.check}
          </button>
        )}
        {canCall && (
          <button className="btn" onClick={() => sendAction('call')}>
            {TH.table.call(callAmount)}
          </button>
        )}
        {canRaise && (
          <button
            className="btn btn--primary"
            onClick={() => sendAction(currentBet > 0 ? 'raise' : 'bet', raiseTo)}
          >
            {raiseTo >= maxRaiseTo ? TH.table.allIn : `${TH.table.raiseTo} ${raiseTo}`}
          </button>
        )}
      </div>
    </div>
  );
}
