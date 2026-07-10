import { describe, it, expect } from 'vitest';
import { createBotOrder, createBotProfile } from '../game/botProfiles.js';

describe('createBotOrder / createBotProfile — randomized personality assignment', () => {
  it('createBotOrder returns a permutation of all 10 template indices', () => {
    const order = createBotOrder();
    expect(order).toHaveLength(10);
    expect(new Set(order).size).toBe(10); // no duplicates
    for (const i of order) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(10);
    }
  });

  it('createBotOrder is not always the same order (actually randomized)', () => {
    const orders = Array.from({ length: 30 }, () => createBotOrder().join(','));
    // Astronomically unlikely for all 30 independent shuffles of a 10-item
    // array to collapse onto a single ordering unless shuffle is broken.
    expect(new Set(orders).size).toBeGreaterThan(1);
  });

  it('createBotProfile draws distinct personalities for a room, following the given order, until it wraps', () => {
    const order = createBotOrder();
    const seenPersonalities = new Set();
    for (let count = 0; count < 10; count++) {
      const profile = createBotProfile(count, order);
      expect(profile.name).toBeTruthy();
      expect(profile.personality).toBeTruthy();
      seenPersonalities.add(profile.personality);
    }
    expect(seenPersonalities.size).toBe(10); // all distinct, no repeats within the room

    // 11th bot in the same room wraps back to the start of the same order
    // and gets a numeric suffix rather than colliding silently.
    const wrapped = createBotProfile(10, order);
    const first = createBotProfile(0, order);
    expect(wrapped.personality).toBe(first.personality);
    expect(wrapped.name).toBe(`${first.name} 2`);
  });

  it('two rooms can get different personality-to-slot assignments', () => {
    // Not a hard guarantee for any single pair, but across many independent
    // room pairs at least one should differ if randomization is real (this
    // is exactly the behavior that used to be impossible — slot 0 was
    // always the same template regardless of room).
    let sawDifference = false;
    for (let i = 0; i < 20; i++) {
      const firstBotA = createBotProfile(0, createBotOrder());
      const firstBotB = createBotProfile(0, createBotOrder());
      if (firstBotA.personality !== firstBotB.personality) {
        sawDifference = true;
        break;
      }
    }
    expect(sawDifference).toBe(true);
  });
});
