import { randomInt } from 'node:crypto';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['c', 'd', 'h', 's'];

export function createDeck() {
  const cards = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) {
      cards.push(rank + suit);
    }
  }
  return cards;
}

// Fisher-Yates shuffle using crypto.randomInt for unbiased, unpredictable order.
export function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createShuffledDeck() {
  return shuffle(createDeck());
}
