import { createDeck, shuffle } from './deck.js';

// pokersolver denotes a joker as value 'O' with any suit char — see the
// 'joker' ruleset in pokersolver.js. The suit char is arbitrary since a
// joker has no real suit; 'j' is just a readable placeholder.
export const JOKER_CARD = 'Oj';

export function createDeckWithJoker() {
  return [...createDeck(), JOKER_CARD];
}

export function createShuffledDeckWithJoker() {
  return shuffle(createDeckWithJoker());
}
