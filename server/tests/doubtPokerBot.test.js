import { describe, it, expect } from 'vitest';
import { decideDoubtPokerDoubt } from '../game/doubtPokerBot.js';
import { effectivePersonality } from '../game/bots.js';
import { BOT_PERSONALITIES } from '../game/botProfiles.js';

describe('decideDoubtPokerDoubt — blocker card-counting', () => {
  it('always doubts a claim its own cards make impossible (holding 2 Kings vs claimed four Kings)', () => {
    // 4 - 2 held = 2 Kings left in play; four of a kind Kings cannot be
    // literally true. The blocker boost must dominate every random roll.
    for (let i = 0; i < 50; i++) {
      const decision = decideDoubtPokerDoubt({
        seat: { holeCards: ['KH', 'KS', '2C', '7D', '9H'], chips: 500 },
        targets: [{ id: 'liar-1', announcement: { type: 'fourOfAKind', rank: 'K' }, drawnCount: 1 }],
        doubtCost: 10,
        pot: 100,
        personality: BOT_PERSONALITIES.careful, // least doubt-prone: strictest test
      });
      expect(decision.targetId).toBe('liar-1');
    }
  });

  it('never doubts a modest unblocked claim (one pair of 2s, no 2 in own hand)', () => {
    // Base suspicion for onePair is tiny and there is no blocker/draw
    // evidence — even the widest random roll stays under the threshold.
    for (let i = 0; i < 50; i++) {
      const decision = decideDoubtPokerDoubt({
        seat: { holeCards: ['KH', 'QS', '7C', '5D', '9H'], chips: 500 },
        targets: [{ id: 'honest-1', announcement: { type: 'onePair', rank: '2' }, drawnCount: 3 }],
        doubtCost: 10,
        pot: 100,
        personality: BOT_PERSONALITIES.sharp,
      });
      expect(decision.targetId).toBeNull();
    }
  });

  it('never doubts when it cannot afford the doubt cost, even against an impossible claim', () => {
    const decision = decideDoubtPokerDoubt({
      seat: { holeCards: ['KH', 'KS', '2C', '7D', '9H'], chips: 5 },
      targets: [{ id: 'liar-1', announcement: { type: 'fourOfAKind', rank: 'K' }, drawnCount: 0 }],
      doubtCost: 10,
      pot: 100,
      personality: BOT_PERSONALITIES.aggressive,
    });
    expect(decision.targetId).toBeNull();
  });
});

describe('effectivePersonality — tilt adjustment', () => {
  it('returns the personality untouched when the seat is not tilted', () => {
    const p = BOT_PERSONALITIES.calm;
    expect(effectivePersonality({ _tiltHands: 0 }, p)).toBe(p);
    expect(effectivePersonality({}, p)).toBe(p);
  });

  it('runs hotter while tilted without mutating the base personality', () => {
    const p = BOT_PERSONALITIES.calm;
    const tilted = effectivePersonality({ _tiltHands: 2 }, p);
    expect(tilted.aggression).toBeGreaterThan(p.aggression);
    expect(tilted.looseness).toBeGreaterThan(p.looseness);
    expect(tilted.bluffFreq).toBeGreaterThan(p.bluffFreq);
    // Traits stay in sane bounds and the shared template is never mutated.
    expect(tilted.aggression).toBeLessThanOrEqual(1);
    expect(BOT_PERSONALITIES.calm.aggression).toBe(0.35);
  });
});
