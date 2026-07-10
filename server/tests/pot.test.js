import { describe, it, expect } from 'vitest';
import { calculatePots, splitPotAmount } from '../game/pot.js';

describe('calculatePots', () => {
  it('creates a single main pot when all players commit the same amount', () => {
    const players = [
      { id: 'a', committedTotal: 100, folded: false },
      { id: 'b', committedTotal: 100, folded: false },
      { id: 'c', committedTotal: 100, folded: false },
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('creates a side pot when one player is all-in for less than the others', () => {
    // a all-in for 50, b and c both put in 200
    const players = [
      { id: 'a', committedTotal: 50, folded: false },
      { id: 'b', committedTotal: 200, folded: false },
      { id: 'c', committedTotal: 200, folded: false },
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 150, eligiblePlayerIds: ['a', 'b', 'c'] });
    expect(pots[1].amount).toBe(300);
    expect(pots[1].eligiblePlayerIds.sort()).toEqual(['b', 'c']);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(450);
  });

  it('creates multiple side pots with three different all-in levels', () => {
    const players = [
      { id: 'a', committedTotal: 20, folded: false },
      { id: 'b', committedTotal: 60, folded: false },
      { id: 'c', committedTotal: 100, folded: false },
      { id: 'd', committedTotal: 100, folded: false },
    ];
    const pots = calculatePots(players);
    // level 20: (20-0)*4 = 80, eligible all 4
    // level 60: (60-20)*3 = 120, eligible b,c,d
    // level 100: (100-60)*2 = 80, eligible c,d
    expect(pots).toEqual([
      { amount: 80, eligiblePlayerIds: ['a', 'b', 'c', 'd'] },
      { amount: 120, eligiblePlayerIds: ['b', 'c', 'd'] },
      { amount: 80, eligiblePlayerIds: ['c', 'd'] },
    ]);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(20 + 60 + 100 + 100);
  });

  it('excludes folded players from eligibility but keeps their chips in the pot', () => {
    const players = [
      { id: 'a', committedTotal: 100, folded: true },
      { id: 'b', committedTotal: 100, folded: false },
      { id: 'c', committedTotal: 100, folded: false },
    ];
    const pots = calculatePots(players);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(pots[0].eligiblePlayerIds.sort()).toEqual(['b', 'c']);
  });

  it('handles a folded all-in player creating a pot layer that folded players cannot win', () => {
    // a folds after committing 30, b all-in for 80, c calls 80
    const players = [
      { id: 'a', committedTotal: 30, folded: true },
      { id: 'b', committedTotal: 80, folded: false },
      { id: 'c', committedTotal: 80, folded: false },
    ];
    const pots = calculatePots(players);
    // level 30: (30-0)*3=90 eligible b,c (a folded)
    // level 80: (80-30)*2=100 eligible b,c
    expect(pots).toEqual([
      { amount: 90, eligiblePlayerIds: ['b', 'c'] },
      { amount: 100, eligiblePlayerIds: ['b', 'c'] },
    ]);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(190);
  });

  it('gives everything to the sole remaining player when everyone else folded', () => {
    const players = [
      { id: 'a', committedTotal: 150, folded: false },
      { id: 'b', committedTotal: 100, folded: true },
      { id: 'c', committedTotal: 50, folded: true },
    ];
    const pots = calculatePots(players);
    const total = pots.reduce((sum, p) => sum + p.amount, 0);
    expect(total).toBe(300);
    for (const pot of pots) {
      expect(pot.eligiblePlayerIds).toEqual(['a']);
    }
  });
});

describe('splitPotAmount', () => {
  it('splits evenly with no remainder', () => {
    const result = splitPotAmount(100, ['a', 'b'], ['a', 'b']);
    expect(result.get('a')).toBe(50);
    expect(result.get('b')).toBe(50);
  });

  it('gives the odd chip to the winner closest to the left of the dealer', () => {
    // orderFromDealer represents seating order starting just after the dealer button
    const result = splitPotAmount(101, ['a', 'b'], ['b', 'a']);
    expect(result.get('b')).toBe(51);
    expect(result.get('a')).toBe(50);
  });

  it('distributes multiple remainder chips one at a time in order', () => {
    const result = splitPotAmount(103, ['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(result.get('a')).toBe(35);
    expect(result.get('b')).toBe(34);
    expect(result.get('c')).toBe(34);
  });
});
