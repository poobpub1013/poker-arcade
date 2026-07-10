import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { startBotGame } from '../socket.js';

function deriveBlinds(chips) {
  const bb = Math.max(10, Math.round(chips / 100 / 10) * 10);
  const sb = Math.max(5, Math.round(bb / 2 / 5) * 5);
  return { sb, bb };
}

const MIN_BLIND_INCREASE_HANDS = 5;
const MAX_BLIND_INCREASE_HANDS = 50;
const DEFAULT_BLIND_INCREASE_HANDS = 10;

export default function BotSetup() {
  const navigate = useNavigate();
  const selectedVariantId = useGameStore((s) => s.selectedVariantId);
  const setRoom = useGameStore((s) => s.setRoom);
  const isChoicePoker = selectedVariantId === 'choice-poker';
  const isDoubtPoker = selectedVariantId === 'doubt-poker';
  const playerCountMax = isDoubtPoker ? 6 : 9;
  const showBlindFields = !isChoicePoker;
  const showBlindEscalation = !isChoicePoker && !isDoubtPoker;
  const [numPlayers, setNumPlayers] = useState(6);
  const [startingChips, setStartingChips] = useState(1000);
  const [customBlinds, setCustomBlinds] = useState(false);
  const [bigBlind, setBigBlind] = useState(20);
  const [increasingBlinds, setIncreasingBlinds] = useState(false);
  const [blindIncreaseHands, setBlindIncreaseHands] = useState(DEFAULT_BLIND_INCREASE_HANDS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const autoBlinds = deriveBlinds(startingChips);
  const effectiveBb = customBlinds ? Math.max(10, bigBlind) : autoBlinds.bb;
  const effectiveSb = customBlinds ? Math.max(5, Math.round(effectiveBb / 2 / 5) * 5) : autoBlinds.sb;

  const handleToggleCustomBlinds = (checked) => {
    setCustomBlinds(checked);
    if (checked) setBigBlind(autoBlinds.bb);
  };

  const handleStart = async () => {
    setLoading(true);
    setError('');
    const result = await startBotGame({
      variantId: selectedVariantId,
      numPlayers: isChoicePoker ? 2 : Math.min(numPlayers, playerCountMax),
      startingChips,
      smallBlind: showBlindFields && customBlinds ? effectiveSb : undefined,
      bigBlind: showBlindFields && customBlinds ? effectiveBb : undefined,
      blindIncreaseHands: showBlindEscalation && increasingBlinds ? blindIncreaseHands : 0,
    });
    setLoading(false);
    if (result?.ok) {
      setRoom(result.code, 'bot');
      navigate('/table');
    } else {
      setError(result?.message || TH.common.error);
    }
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.botSetup.back}
        </button>
        <h1 className="screen__title">{TH.botSetup.title}</h1>
      </div>
      <div className="screen__body">
        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {!isChoicePoker && (
            <div className="field">
              <label>
                {TH.botSetup.numPlayers}: {Math.min(numPlayers, playerCountMax)}
              </label>
              <input
                type="range"
                min={2}
                max={playerCountMax}
                value={Math.min(numPlayers, playerCountMax)}
                onChange={(e) => setNumPlayers(Number(e.target.value))}
              />
            </div>
          )}
          <div className="field">
            <label>{TH.botSetup.startingChips}</label>
            <input
              type="number"
              min={100}
              step={100}
              value={startingChips}
              onChange={(e) => setStartingChips(Math.max(100, Number(e.target.value) || 0))}
            />
          </div>
          {showBlindFields && (
            <>
              <div className="field field--checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={customBlinds}
                    onChange={(e) => handleToggleCustomBlinds(e.target.checked)}
                  />
                  {TH.botSetup.customBlinds}
                </label>
              </div>
              {customBlinds ? (
                <div className="field">
                  <label>{TH.botSetup.bigBlindLabel}</label>
                  <input
                    type="number"
                    min={10}
                    step={10}
                    value={bigBlind}
                    onChange={(e) => setBigBlind(Math.max(10, Number(e.target.value) || 0))}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {TH.botSetup.smallBlindHint(effectiveSb)}
                  </span>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                  {TH.botSetup.blindsPreview(effectiveSb, effectiveBb)}
                </p>
              )}

              {showBlindEscalation && (
                <>
                  <div className="field field--checkbox">
                    <label>
                      <input
                        type="checkbox"
                        checked={increasingBlinds}
                        onChange={(e) => setIncreasingBlinds(e.target.checked)}
                      />
                      {TH.botSetup.increasingBlinds}
                    </label>
                  </div>
                  {increasingBlinds && (
                    <div className="field">
                      <label>
                        {TH.botSetup.blindIncreaseEvery}: {blindIncreaseHands}
                      </label>
                      <input
                        type="range"
                        min={MIN_BLIND_INCREASE_HANDS}
                        max={MAX_BLIND_INCREASE_HANDS}
                        step={5}
                        value={blindIncreaseHands}
                        onChange={(e) => setBlindIncreaseHands(Number(e.target.value))}
                      />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn btn--primary" disabled={loading} onClick={handleStart}>
          {loading ? TH.botSetup.starting : TH.botSetup.start}
        </button>
      </div>
    </div>
  );
}
