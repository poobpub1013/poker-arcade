import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/useGameStore.js';
import { TH } from '../i18n/th.js';
import { createRoom } from '../socket.js';

function deriveBlinds(chips) {
  const bb = Math.max(10, Math.round(chips / 100 / 10) * 10);
  const sb = Math.max(5, Math.round(bb / 2 / 5) * 5);
  return { sb, bb };
}

const MIN_BLIND_INCREASE_HANDS = 5;
const MAX_BLIND_INCREASE_HANDS = 50;
const DEFAULT_BLIND_INCREASE_HANDS = 10;

export default function CreateRoom() {
  const navigate = useNavigate();
  const selectedVariantId = useGameStore((s) => s.selectedVariantId);
  const isChoicePoker = selectedVariantId === 'choice-poker';
  const isDoubtPoker = selectedVariantId === 'doubt-poker';
  const playerCountMax = isDoubtPoker ? 6 : 9;
  const showBlindFields = !isChoicePoker;
  const showBlindEscalation = !isChoicePoker && !isDoubtPoker;
  const [maxPlayers, setMaxPlayers] = useState(6);
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

  const handleCreate = async () => {
    setLoading(true);
    setError('');
    const result = await createRoom({
      variantId: selectedVariantId,
      maxPlayers: isChoicePoker ? 2 : Math.min(maxPlayers, playerCountMax),
      startingChips,
      smallBlind: showBlindFields && customBlinds ? effectiveSb : undefined,
      bigBlind: showBlindFields && customBlinds ? effectiveBb : undefined,
      blindIncreaseHands: showBlindEscalation && increasingBlinds ? blindIncreaseHands : 0,
    });
    setLoading(false);
    if (result?.ok) {
      navigate('/lobby');
    } else {
      setError(result?.message || TH.common.error);
    }
  };

  return (
    <div className="screen">
      <div className="screen__header">
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          ← {TH.createRoom.back}
        </button>
        <h1 className="screen__title">{TH.createRoom.title}</h1>
      </div>
      <div className="screen__body">
        <div className="card-panel" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {!isChoicePoker && (
            <div className="field">
              <label>
                {TH.createRoom.maxPlayers}: {Math.min(maxPlayers, playerCountMax)}
              </label>
              <input
                type="range"
                min={2}
                max={playerCountMax}
                value={Math.min(maxPlayers, playerCountMax)}
                onChange={(e) => setMaxPlayers(Number(e.target.value))}
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
        <button className="btn btn--primary" disabled={loading} onClick={handleCreate}>
          {loading ? TH.createRoom.creating : TH.createRoom.create}
        </button>
      </div>
    </div>
  );
}
