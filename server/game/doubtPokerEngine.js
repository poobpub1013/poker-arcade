import { EventEmitter } from 'node:events';
import { createShuffledDeck, shuffle } from './deck.js';
import { evaluateHand } from './handEvaluator.js';
import { calculatePots, splitPotAmount } from './pot.js';
import { decideBotAction } from './bots.js';
import { rankFromRealHand, compareClaims, isTruthful, isValidClaim } from './doubtPokerRankings.js';
import { decideDoubtPokerAnnouncement, decideDoubtPokerDoubt } from './doubtPokerBot.js';
import { ACTION_TIMEOUT_MS, BOT_MIN_DELAY_MS, BOT_MAX_DELAY_MS } from '../config.js';

const HAND_END_DELAY_MS = 5000;

// A bare 5-card-hand "variant" shape — reused only to satisfy handEvaluator.js
// / bots.js / equity.js's generic (holeCards, boardCards, holeCardsUsed)
// contract, not a real streets descriptor. board is always [] here.
const FIVE_CARD_VARIANT = {
  id: 'doubt-poker-hand',
  holeCards: 5,
  boardCards: 0,
  holeCardsUsed: null,
  bettingStructure: 'no-limit',
};

export class DoubtPokerActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DoubtPokerActionError';
  }
}

function nextSeatIndex(seats, fromIndex, predicate) {
  const n = seats.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n;
    if (predicate(seats[idx])) return idx;
  }
  return -1;
}

function canAct(seat) {
  return !seat.eliminated && !seat.folded && !seat.allIn && seat.chips > 0;
}

// Doubt Poker (Kakegurui) — 5-card draw + a single normal betting round, then
// survivors declare a hand ranking (honestly or as a bluff) and the table
// gets one round to pay-and-challenge any hidden declaration. See
// server/game/doubtPokerRankings.js for the claim model and the project plan
// for the full rules writeup. Mirrors GameEngine's public shape
// (startNextHand/handleAction/getLegalActions/getState/pause/resume/destroy,
// emits 'update') so it plugs into the existing room/socket plumbing
// unchanged. Phase-2 betting deliberately reuses GameEngine's exact seat
// field names (holeCards/committedStreet/committedTotal/dealtIn/folded/
// allIn) so bots.js's decideBotAction() and the client's BettingControls.jsx
// both work completely unmodified for this phase.
export class DoubtPokerEngine extends EventEmitter {
  constructor({ players, smallBlind, bigBlind }) {
    super();
    if (players.length < 2 || players.length > 6) {
      throw new Error('Doubt Poker เล่นได้ 2-6 คนเท่านั้น');
    }
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;

    this.seats = players.map((p, index) => ({
      seatIndex: index,
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: !!p.isBot,
      personality: p.personality || null,
      chips: p.chips,
      eliminated: false,
      dealtIn: false,
      folded: false,
      allIn: false,
      committedStreet: 0,
      committedTotal: 0,
      holeCards: [],
      hasDrawn: false,
      announcement: null,
      hasAnnounced: false,
      revealed: false,
      liar: false,
      hasDoubted: false,
    }));

    this.handNumber = 0;
    this.dealerSeatIndex = -1;
    this.phase = 'waiting'; // waiting | draw | betting | announce | doubt | showdown | handover | gameover
    this.deck = [];
    this._discardPile = [];
    this.currentBet = 0;
    this.minRaiseIncrement = bigBlind;
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.doubtCost = 0;
    this.doubtBonusPot = 0;
    this.winnerId = null;
    this.lastResult = null;
    this.paused = false;

    this._drawDeadlines = {};
    this._playersToAct = new Set();
    this._doubtQueue = [];
    this._doubtQueuePos = 0;
    this._timers = {};
    this._pending = {};

    this._watchdog = setInterval(() => this._checkWatchdog(), 5000);
  }

  destroy() {
    for (const kind of Object.keys(this._timers)) clearTimeout(this._timers[kind]);
    this._timers = {};
    this._pending = {};
    clearInterval(this._watchdog);
  }

  _checkWatchdog() {
    if (this.paused) return;
    if (this.phase === 'draw') {
      for (const seat of this.seats) {
        if (seat.dealtIn && !seat.hasDrawn && !this._timers[`draw-${seat.seatIndex}`]) this._armDrawTimer(seat.seatIndex);
      }
    } else if (['betting', 'announce', 'doubt'].includes(this.phase) && this.currentActorSeatIndex >= 0) {
      if (!this._timers.action) this._armActionTimer();
    }
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    for (const kind of Object.keys(this._timers)) clearTimeout(this._timers[kind]);
    this._timers = {};
    this._emitUpdate('paused');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    for (const [kind, fn] of Object.entries(this._pending)) {
      this._arm(kind, fn, this._delayFor(kind));
    }
    this._emitUpdate('resumed');
  }

  _delayFor(kind) {
    if (kind === 'nextHand') return HAND_END_DELAY_MS;
    const seatIndex = kind === 'action' ? this.currentActorSeatIndex : Number(kind.split('-')[1]);
    const seat = this.seats[seatIndex];
    if (!seat?.isBot) return ACTION_TIMEOUT_MS;

    const base = BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);

    // Betting: same human pacing as GameEngine — snap the trivial spots,
    // genuinely think (occasionally tank) when a big bet lands on the bot.
    if (this.phase === 'betting' && kind === 'action') {
      const toCall = Math.max(0, this.currentBet - seat.committedStreet);
      if (toCall <= this.bigBlind) return 1100 + Math.random() * 1900;
      const pot = this.seats.reduce((sum, s) => sum + s.committedTotal, 0);
      const pressure = Math.min(1, toCall / Math.max(1, Math.min(pot, seat.chips)));
      let delay = base + pressure * 1800;
      if (pressure > 0.5 && Math.random() < 0.18) delay += 2000 + Math.random() * 2500;
      return delay;
    }

    // Announce/doubt are this game's "poker face" moments — composing a lie
    // or weighing an accusation deserves visibly more thought than a
    // mechanical fixed pause, so stretch the spread a little.
    if (this.phase === 'announce' || this.phase === 'doubt') {
      return base + Math.random() * 1600;
    }

    return base;
  }

  _arm(kind, fn, delay) {
    clearTimeout(this._timers[kind]);
    this._pending[kind] = fn;
    this._timers[kind] = setTimeout(() => {
      delete this._pending[kind];
      delete this._timers[kind];
      fn();
    }, delay);
  }

  _clear(kind) {
    clearTimeout(this._timers[kind]);
    delete this._timers[kind];
    delete this._pending[kind];
  }

  _emitUpdate(reason, extra = {}) {
    this.emit('update', { reason, ...extra });
  }

  activeSeats() {
    return this.seats.filter((s) => !s.eliminated);
  }

  seatById(id) {
    return this.seats.find((s) => s.id === id);
  }

  // ---- Hand lifecycle -----------------------------------------------------

  startNextHand() {
    const eligible = this.activeSeats();
    if (eligible.length < 2) {
      this.phase = 'gameover';
      this.winnerId = eligible[0]?.id ?? null;
      this._emitUpdate('game-over');
      return;
    }

    this.handNumber += 1;
    this.dealerSeatIndex =
      this.handNumber === 1
        ? this.seats.findIndex((s) => !s.eliminated)
        : nextSeatIndex(this.seats, this.dealerSeatIndex, (s) => !s.eliminated);

    for (const seat of this.seats) {
      if (seat.eliminated) {
        seat.dealtIn = false;
        seat.holeCards = [];
        continue;
      }
      seat.dealtIn = true;
      seat.folded = false;
      seat.allIn = false;
      seat.committedStreet = 0;
      seat.committedTotal = 0;
      seat.holeCards = [];
      seat.hasDrawn = false;
      seat.announcement = null;
      seat.hasAnnounced = false;
      seat.revealed = false;
      seat.liar = false;
      seat.hasDoubted = false;
      // Bot-only memory (bots.js): a bluff story lives for one hand at most.
      seat._bluff = false;
    }

    this.deck = createShuffledDeck();
    this._discardPile = [];
    this.lastResult = null;
    this.doubtCost = 0;
    this.doubtBonusPot = 0;

    for (const seat of this.seats) {
      if (!seat.dealtIn) continue;
      seat.holeCards = this.deck.splice(0, 5);
    }

    const activeCount = this.activeSeats().length;
    let sbSeatIndex;
    let bbSeatIndex;
    if (activeCount === 2) {
      sbSeatIndex = this.dealerSeatIndex;
      bbSeatIndex = nextSeatIndex(this.seats, this.dealerSeatIndex, (s) => !s.eliminated);
    } else {
      sbSeatIndex = nextSeatIndex(this.seats, this.dealerSeatIndex, (s) => !s.eliminated);
      bbSeatIndex = nextSeatIndex(this.seats, sbSeatIndex, (s) => !s.eliminated);
    }
    this.sbSeatIndex = sbSeatIndex;
    this.bbSeatIndex = bbSeatIndex;
    this._postBlind(sbSeatIndex, this.smallBlind);
    this._postBlind(bbSeatIndex, this.bigBlind);

    this.phase = 'draw';
    for (const seat of this.seats) {
      if (seat.dealtIn) this._armDrawTimer(seat.seatIndex);
    }
    this._emitUpdate('hand-start');
  }

  _postBlind(seatIndex, amount) {
    const seat = this.seats[seatIndex];
    const posted = Math.min(amount, seat.chips);
    seat.chips -= posted;
    seat.committedStreet += posted;
    seat.committedTotal += posted;
    if (seat.chips === 0) seat.allIn = true;
  }

  // ---- Draw phase (fully secret — no reveal of any kind, unlike Choice Poker) --

  _armDrawTimer(seatIndex) {
    const kind = `draw-${seatIndex}`;
    this._clear(kind);
    this._drawDeadlines[seatIndex] = Date.now() + ACTION_TIMEOUT_MS;
    this._arm(
      kind,
      () => {
        if (this.seats[seatIndex].isBot) this._performBotDraw(seatIndex);
        else this._applyDraw(seatIndex, []);
      },
      this._delayFor(kind)
    );
  }

  _performBotDraw(seatIndex) {
    const seat = this.seats[seatIndex];
    if (!seat || seat.hasDrawn) return;
    try {
      const evaluated = evaluateHand(seat.holeCards, [], FIVE_CARD_VARIANT);
      const rankTier = evaluated.hand.rank;
      // Keep pairs-or-better cards, discard the rest; stand pat on trips+.
      const discard = rankTier >= 4 ? [] : this._weakDiscardIndices(seat.holeCards);
      this._applyDraw(seatIndex, discard);
    } catch {
      this._applyDraw(seatIndex, []);
    }
  }

  _weakDiscardIndices(hand) {
    const counts = new Map();
    for (const c of hand) counts.set(c[0], (counts.get(c[0]) || 0) + 1);
    const paired = new Set([...counts.entries()].filter(([, n]) => n >= 2).map(([r]) => r));
    return hand.map((c, i) => (paired.has(c[0]) ? -1 : i)).filter((i) => i >= 0);
  }

  handleDraw(playerId, discardIndices) {
    const seat = this.seatById(playerId);
    if (!seat) throw new DoubtPokerActionError('ไม่พบผู้เล่นนี้ที่โต๊ะ');
    if (this.phase !== 'draw' || !seat.dealtIn || seat.hasDrawn) {
      throw new DoubtPokerActionError('ยังไม่ถึงตาแลกไพ่ของคุณ');
    }
    this._clear(`draw-${seat.seatIndex}`);
    this._applyDraw(seat.seatIndex, discardIndices);
  }

  _applyDraw(seatIndex, discardIndices) {
    const seat = this.seats[seatIndex];
    if (!seat || seat.hasDrawn) return;

    const indices = Array.isArray(discardIndices) ? [...new Set(discardIndices)] : [];
    const validIndices = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < seat.holeCards.length);
    if (validIndices.length !== indices.length) {
      throw new DoubtPokerActionError('ตำแหน่งไพ่ที่เลือกทิ้งไม่ถูกต้อง');
    }

    for (const i of validIndices) {
      this._discardPile.push(seat.holeCards[i]);
      // With enough players discarding heavily (up to 6*5=30 replacements
      // against a stock of only 22 left after dealing), the deck can run
      // dry mid-draw — deck.shift() would then silently hand back
      // `undefined`, which Card.jsx renders as a face-down card. Standard
      // 5-card-draw ruling: reshuffle the discards-so-far back into the
      // stock and keep going.
      if (this.deck.length === 0) this._reshuffleDiscardPile();
      seat.holeCards[i] = this.deck.shift();
    }
    seat.hasDrawn = true;
    delete this._drawDeadlines[seatIndex];

    this._emitUpdate('drew', { seatId: seat.id });

    if (this.seats.filter((s) => s.dealtIn).every((s) => s.hasDrawn)) this._startBettingRound();
  }

  _reshuffleDiscardPile() {
    this.deck = shuffle(this._discardPile);
    this._discardPile = [];
  }

  // ---- Betting round (single street, mirrors engine.js's preflop logic) ---

  _startBettingRound() {
    this.phase = 'betting';
    this.currentBet = this.bigBlind;
    this.minRaiseIncrement = this.bigBlind;

    this._playersToAct = new Set(this.seats.filter((s) => canAct(s)).map((s) => s.seatIndex));
    if (this._playersToAct.size === 0) return this._closeBettingRound();

    const activeCount = this.activeSeats().length;
    const firstActorSeatIndex =
      activeCount === 2 ? this.sbSeatIndex : nextSeatIndex(this.seats, this.bbSeatIndex, canAct);
    this.currentActorSeatIndex = this._playersToAct.has(firstActorSeatIndex)
      ? firstActorSeatIndex
      : nextSeatIndex(this.seats, firstActorSeatIndex, (s) => this._playersToAct.has(s.seatIndex));

    this._armActionTimer();
    this._emitUpdate('betting-start');
  }

  _armActionTimer() {
    this._clear('action');
    const actor = this.seats[this.currentActorSeatIndex];
    this.actionDeadline = Date.now() + ACTION_TIMEOUT_MS;
    if (actor.isBot) {
      this._arm('action', () => this._performBotAction(), this._delayFor('action'));
    } else {
      this._arm('action', () => this._handleTimeout(), ACTION_TIMEOUT_MS);
    }
  }

  _handleTimeout() {
    if (this.phase === 'announce') return this._applyAnnounce(this.currentActorSeatIndex, this._safeAnnouncement(this.currentActorSeatIndex));
    if (this.phase === 'doubt') return this._applyDoubtTurn(this.currentActorSeatIndex, null);
    const seat = this.seats[this.currentActorSeatIndex];
    if (seat.committedStreet === this.currentBet) this._applyBettingAction(seat.seatIndex, 'check');
    else this._applyBettingAction(seat.seatIndex, 'fold');
  }

  _performBotAction() {
    if (this.phase === 'announce') return this._performBotAnnounce();
    if (this.phase === 'doubt') return this._performBotDoubtTurn();

    const seat = this.seats[this.currentActorSeatIndex];
    if (!seat || !seat.isBot) return;
    try {
      const decision = decideBotAction({
        seat,
        seats: this.seats,
        board: [],
        currentBet: this.currentBet,
        variant: FIVE_CARD_VARIANT,
        bigBlind: this.bigBlind,
        getRaiseBounds: (idx) => this._getBotRaiseBounds(idx, seat.personality),
        personality: seat.personality,
      });
      const final = this._avoidSelfShove(seat, decision);
      this._applyBettingAction(seat.seatIndex, final.action, final.amount);
    } catch {
      try {
        const toCall = this.currentBet - seat.committedStreet;
        this._applyBettingAction(seat.seatIndex, toCall > 0 ? 'fold' : 'check');
      } catch {
        // watchdog will recover
      }
    }
  }

  getLegalActions(playerId) {
    const seat = this.seatById(playerId);
    if (!seat) return null;

    if (this.phase === 'draw') {
      if (!seat.dealtIn || seat.hasDrawn) return null;
      return {
        phase: 'draw',
        timeLeft: this._drawDeadlines[seat.seatIndex]
          ? Math.max(0, this._drawDeadlines[seat.seatIndex] - Date.now())
          : null,
      };
    }

    if (this.phase === 'betting') {
      if (seat.seatIndex !== this.currentActorSeatIndex) return null;
      const toCall = this.currentBet - seat.committedStreet;
      const bounds = this._getRaiseBounds(seat.seatIndex);
      return {
        phase: 'betting',
        canCheck: toCall <= 0,
        canCall: toCall > 0,
        callAmount: Math.max(0, Math.min(toCall, seat.chips)),
        canRaise: bounds.max > this.currentBet && seat.chips > Math.max(0, toCall),
        minRaiseTo: bounds.min,
        maxRaiseTo: bounds.max,
        timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null,
      };
    }

    if (this.phase === 'announce') {
      if (seat.seatIndex !== this.currentActorSeatIndex) return null;
      return { phase: 'announce', timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null };
    }

    if (this.phase === 'doubt') {
      if (seat.seatIndex !== this.currentActorSeatIndex) return null;
      const targets = this.seats
        .filter((s) => s.dealtIn && !s.folded && !s.revealed && s.seatIndex !== seat.seatIndex)
        .map((s) => s.id);
      return {
        phase: 'doubt',
        doubtCost: this.doubtCost,
        canAffordDoubt: seat.chips >= this.doubtCost,
        targets,
        timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null,
      };
    }

    return null;
  }

  _getRaiseBounds(seatIndex) {
    const seat = this.seats[seatIndex];
    const stackTotal = seat.chips + seat.committedStreet;
    return {
      min: Math.min(this.currentBet + this.minRaiseIncrement, stackTotal),
      max: stackTotal,
    };
  }

  // Only used for sizing a *bot's own* raise/bet — humans always see the
  // true bounds from _getRaiseBounds via getLegalActions. bots.js's generic
  // raiseOrBet() has a "don't leave an awkward small stack behind, just
  // shove" rule that makes sense in Hold'em/PLO (a stub stack is dead
  // weight there) but is exactly wrong here: doubtCost equals the round's
  // final currentBet, so that "awkward" leftover is precisely what a bot
  // needs to still afford a Doubt once betting closes. Softening the max a
  // bot sizes against makes that shove-conversion top out at a reserve
  // instead of the full stack. Aggressive/gambler personalities keep a
  // thinner reserve than cautious ones, for variety.
  _getBotRaiseBounds(seatIndex, personality) {
    const trueBounds = this._getRaiseBounds(seatIndex);
    const seat = this.seats[seatIndex];
    const stackTotal = seat.chips + seat.committedStreet;
    const aggression = personality?.aggression ?? 0.5;
    const reserveFrac = 0.08 + (1 - aggression) * 0.17;
    const reserve = Math.max(this.bigBlind * 3, Math.round(stackTotal * reserveFrac));
    const softMax = Math.max(trueBounds.min, stackTotal - reserve);

    // The self-reserve above only protects THIS bot's own doubtCost
    // affordability. But everything here happens in one single betting
    // round (no further streets to spread value-betting across the way
    // Hold'em/PLO does), and doubtCost is set table-wide to whatever this
    // round's final bet turns out to be — so a raise that's perfectly
    // sized off this bot's own stack can still price every OTHER survivor
    // out of ever affording to challenge a bluff, especially once a couple
    // of raises have chained together. If the shortest opponent still in
    // the hand calls a bet of X, they're left with (their stack − X); for
    // them to also be able to pay a doubtCost of X afterward needs
    // X <= stack / 2, with a little headroom below that so a call doesn't
    // leave them razor-thin even when the doubt then succeeds.
    const opponents = this.seats.filter((s) => s.dealtIn && !s.folded && s.seatIndex !== seatIndex);
    const shortestOpponentStack = opponents.length
      ? Math.min(...opponents.map((s) => s.chips + s.committedStreet))
      : stackTotal;
    const affordabilityCeiling = Math.max(trueBounds.min, Math.round(shortestOpponentStack * 0.4));

    return { min: trueBounds.min, max: Math.min(trueBounds.max, softMax, affordabilityCeiling) };
  }

  // _getBotRaiseBounds softens the *ceiling* a bot sizes its own raise
  // against, but can't always keep the reserve intact by itself: no-limit
  // betting lets minRaiseIncrement balloon after a few raises in the same
  // round, so by a bot's second or third decision on one street, even the
  // legally-required *minimum* raise can already exceed its reserve budget.
  // This is the backstop for that case — if the only way to raise/bet would
  // gut the reserve anyway, call (or check) instead of shoving voluntarily.
  // Being priced in all-in on someone ELSE's big bet is untouched (and
  // unavoidable) — this only stops bots from choosing to shove themselves.
  _avoidSelfShove(seat, decision) {
    if (decision.action !== 'raise' && decision.action !== 'bet') return decision;
    const stackTotal = seat.chips + seat.committedStreet;
    const reserve = Math.max(this.bigBlind * 3, Math.round(stackTotal * 0.08));
    if (stackTotal - decision.amount >= reserve) return decision;
    const toCall = this.currentBet - seat.committedStreet;
    return toCall > 0 ? { action: 'call' } : { action: 'check' };
  }

  // Forcibly removes a seat mid-hand, regardless of turn/phase — used when a
  // multiplayer player's disconnect grace period expires. Draw is per-seat
  // (not turn-based), so it just applies the same stand-pat default a human
  // draw-timeout already uses. Betting has the same _applyBettingAction
  // pivot-off-currentActorSeatIndex hazard as GameEngine (only safe to call
  // when the forfeited seat IS the current actor), so it gets the identical
  // current-actor/not-current-actor split. Announce/doubt are only resolved
  // here if it's currently their turn — `folded` (set unconditionally before
  // any dispatch) is enough for _advanceAnnounceQueue/_advanceDoubtQueue's
  // skip conditions to carry a not-yet-reached queued seat the rest of the
  // way on their own.
  forfeitSeat(playerId) {
    const seat = this.seatById(playerId);
    if (!seat || seat.eliminated) return;

    const wasDrawing = this.phase === 'draw' && seat.dealtIn && !seat.hasDrawn;
    const wasCurrentBettor = this.phase === 'betting' && seat.seatIndex === this.currentActorSeatIndex;
    const wasOwedBet = this.phase === 'betting' && this._playersToAct.has(seat.seatIndex);
    const wasCurrentAnnouncer = this.phase === 'announce' && seat.seatIndex === this.currentActorSeatIndex;
    const wasCurrentDoubter = this.phase === 'doubt' && seat.seatIndex === this.currentActorSeatIndex;

    // Set terminal state FIRST, before any cascade runs, so that if this
    // forfeit brings the hand down to its last live seat, the resulting
    // _finishHand-style gameover check (reached synchronously below) sees it
    // immediately instead of only catching up on the next hand transition.
    if (seat.dealtIn) seat.folded = true;
    seat.chips = 0;
    seat.eliminated = true;

    if (wasDrawing) {
      this._clear(`draw-${seat.seatIndex}`);
      this._applyDraw(seat.seatIndex, []);
    } else if (wasCurrentBettor) {
      this._clear('action');
      this._applyBettingAction(seat.seatIndex, 'fold');
    } else if (wasOwedBet) {
      this._playersToAct.delete(seat.seatIndex);
      if (this._playersToAct.size === 0) this._closeBettingRound();
    } else if (wasCurrentAnnouncer) {
      this._clear('action');
      this._advanceAnnounceQueue();
    } else if (wasCurrentDoubter) {
      this._clear('action');
      this._applyDoubtTurn(seat.seatIndex, null);
    }

    this._emitUpdate('seat-forfeited', { seatId: seat.id });
  }

  // `action`/`amount` are interpreted per phase — see getLegalActions for
  // what's legal when. All routed through this single method so the
  // client's existing `game:action` socket event covers every phase.
  handleAction(playerId, action, amount) {
    const seat = this.seatById(playerId);
    if (!seat) throw new DoubtPokerActionError('ไม่พบผู้เล่นนี้ที่โต๊ะ');

    if (this.phase === 'draw') {
      if (action !== 'draw') throw new DoubtPokerActionError('ต้องแลกไพ่ก่อน');
      return this.handleDraw(playerId, amount);
    }

    if (this.phase === 'announce') {
      if (seat.seatIndex !== this.currentActorSeatIndex) throw new DoubtPokerActionError('ยังไม่ถึงตาของคุณ');
      if (!isValidClaim(amount)) throw new DoubtPokerActionError('คำประกาศไม่ถูกต้อง');
      this._clear('action');
      return this._applyAnnounce(seat.seatIndex, amount);
    }

    if (this.phase === 'doubt') {
      if (seat.seatIndex !== this.currentActorSeatIndex) throw new DoubtPokerActionError('ยังไม่ถึงตาของคุณ');
      this._clear('action');
      if (action === 'pass') return this._applyDoubtTurn(seat.seatIndex, null);
      if (action === 'doubt') return this._applyDoubtTurn(seat.seatIndex, amount);
      throw new DoubtPokerActionError('ไม่รู้จักการกระทำนี้');
    }

    if (this.phase !== 'betting' || seat.seatIndex !== this.currentActorSeatIndex) {
      throw new DoubtPokerActionError('ยังไม่ถึงตาของคุณ');
    }
    this._clear('action');
    this._applyBettingAction(seat.seatIndex, action, amount);
  }

  _applyBettingAction(seatIndex, action, amount) {
    const seat = this.seats[seatIndex];
    const toCall = this.currentBet - seat.committedStreet;

    if (action === 'fold') {
      seat.folded = true;
      this._playersToAct.delete(seatIndex);
    } else if (action === 'check') {
      if (toCall > 0) throw new DoubtPokerActionError('ยังมีเงินเดิมพันที่ต้องตาม ไม่สามารถ check ได้');
      this._playersToAct.delete(seatIndex);
    } else if (action === 'call') {
      const callAmount = Math.max(0, Math.min(toCall, seat.chips));
      seat.chips -= callAmount;
      seat.committedStreet += callAmount;
      seat.committedTotal += callAmount;
      if (seat.chips === 0) seat.allIn = true;
      this._playersToAct.delete(seatIndex);
    } else if (action === 'raise' || action === 'bet' || action === 'allin') {
      const stackTotal = seat.chips + seat.committedStreet;
      const bounds = this._getRaiseBounds(seatIndex);
      let target = action === 'allin' ? stackTotal : Number(amount);
      if (!Number.isFinite(target)) throw new DoubtPokerActionError('จำนวนเดิมพันไม่ถูกต้อง');
      target = Math.round(target);
      if (target > stackTotal) throw new DoubtPokerActionError('เดิมพันเกินจำนวนชิพที่มี');
      if (target < bounds.min && target < stackTotal) throw new DoubtPokerActionError(`ต้องเรซอย่างน้อย ${bounds.min}`);
      if (target <= this.currentBet) throw new DoubtPokerActionError('จำนวนเรซต้องมากกว่าเดิมพันปัจจุบัน');

      const increment = target - this.currentBet;
      const additionalChips = target - seat.committedStreet;
      seat.chips -= additionalChips;
      seat.committedTotal += additionalChips;
      seat.committedStreet = target;
      if (seat.chips === 0) seat.allIn = true;
      this.currentBet = target;
      if (increment > this.minRaiseIncrement) this.minRaiseIncrement = increment;

      this._playersToAct = new Set(
        this.seats.filter((s) => canAct(s) && s.seatIndex !== seatIndex).map((s) => s.seatIndex)
      );
    } else {
      throw new DoubtPokerActionError('ไม่รู้จักการกระทำนี้');
    }

    if (this._playersToAct.size === 0) {
      this._closeBettingRound();
    } else {
      this.currentActorSeatIndex = nextSeatIndex(this.seats, this.currentActorSeatIndex, (s) =>
        this._playersToAct.has(s.seatIndex)
      );
      this._armActionTimer();
    }

    this._emitUpdate('action', { seatId: seat.id, action });
  }

  _closeBettingRound() {
    this._refundUncalledBet();

    const stillIn = this.seats.filter((s) => s.dealtIn && !s.folded);
    if (stillIn.length === 1) return this._endHandUncontested(stillIn[0]);

    this.doubtCost = this.currentBet;
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this._startAnnouncePhase();
  }

  _refundUncalledBet() {
    const contributors = this.seats
      .filter((s) => s.dealtIn && s.committedStreet > 0)
      .sort((a, b) => b.committedStreet - a.committedStreet);
    if (contributors.length === 0) return;
    const top = contributors[0];
    const second = contributors[1]?.committedStreet ?? 0;
    const excess = top.committedStreet - second;
    if (excess > 0) {
      top.chips += excess;
      top.committedStreet -= excess;
      top.committedTotal -= excess;
      top.allIn = top.chips === 0;
    }
    // doubtCost is set to this.currentBet right after this call — it must
    // track what was actually matched, not the raiser's pre-refund target.
    // Otherwise a lone overbet/shove nobody could fully call still prices
    // the whole table's Doubt out of reach even though that uncalled excess
    // was just handed straight back to the raiser above.
    this.currentBet = top.committedStreet;
  }

  // ---- Announce phase -------------------------------------------------------

  _startAnnouncePhase() {
    this.phase = 'announce';
    const survivors = this.seats.filter((s) => s.dealtIn && !s.folded);
    this._announceQueue = [];
    let cursor = this.dealerSeatIndex;
    for (let i = 0; i < survivors.length; i++) {
      cursor = nextSeatIndex(this.seats, cursor, (s) => survivors.includes(s));
      this._announceQueue.push(cursor);
    }
    this._announceQueuePos = 0;
    this.currentActorSeatIndex = this._announceQueue[0];
    this._armActionTimer();
    this._emitUpdate('announce-start');
  }

  _safeAnnouncement(seatIndex) {
    const seat = this.seats[seatIndex];
    const evaluated = evaluateHand(seat.holeCards, [], FIVE_CARD_VARIANT);
    return rankFromRealHand(evaluated);
  }

  _performBotAnnounce() {
    const seatIndex = this.currentActorSeatIndex;
    const seat = this.seats[seatIndex];
    if (!seat || !seat.isBot) return;
    try {
      const claim = decideDoubtPokerAnnouncement({
        hand: seat.holeCards,
        personality: seat.personality,
      });
      this._applyAnnounce(seatIndex, claim);
    } catch {
      this._applyAnnounce(seatIndex, this._safeAnnouncement(seatIndex));
    }
  }

  _applyAnnounce(seatIndex, claim) {
    const seat = this.seats[seatIndex];
    seat.announcement = claim;
    seat.hasAnnounced = true;
    this._emitUpdate('announced', { seatId: seat.id });
    this._advanceAnnounceQueue();
  }

  // A seat's position in the announce queue is done being waited on either
  // because it announced normally, or because forfeitSeat() folded it out
  // mid-queue (disconnect grace period expired) before its turn arrived.
  _announceSeatResolved(seat) {
    return seat.hasAnnounced || seat.folded;
  }

  _advanceAnnounceQueue() {
    this._announceQueuePos += 1;
    while (
      this._announceQueuePos < this._announceQueue.length &&
      this._announceSeatResolved(this.seats[this._announceQueue[this._announceQueuePos]])
    ) {
      this._announceQueuePos += 1;
    }
    if (this._announceQueuePos >= this._announceQueue.length) {
      this._startDoubtPhase();
    } else {
      this.currentActorSeatIndex = this._announceQueue[this._announceQueuePos];
      this._armActionTimer();
      // Unlike _advanceDoubtQueue (which emits 'doubt-turn' after moving to
      // the next actor), this branch previously emitted nothing once the
      // actor advanced — the only broadcast was the 'announced' event above,
      // which still carries the *previous* actor. The next player's client
      // never got a fresh game:state/game:yourTurn until some unrelated
      // event happened to fire (e.g. pause/resume), which is exactly the
      // "nothing shows up until I pause and resume" bug report.
      this._emitUpdate('announce-turn');
    }
  }

  // ---- Doubt phase ----------------------------------------------------------

  _startDoubtPhase() {
    this.phase = 'doubt';
    const survivors = this.seats.filter((s) => s.dealtIn && !s.folded);
    this._doubtQueue = [];
    let cursor = this.dealerSeatIndex;
    if (survivors.some((s) => s.seatIndex === this.dealerSeatIndex)) {
      this._doubtQueue.push(this.dealerSeatIndex);
    } else {
      cursor = nextSeatIndex(this.seats, this.dealerSeatIndex, (s) => survivors.includes(s));
      this._doubtQueue.push(cursor);
    }
    for (let i = 1; i < survivors.length; i++) {
      cursor = nextSeatIndex(this.seats, cursor, (s) => survivors.includes(s));
      this._doubtQueue.push(cursor);
    }
    this._doubtQueuePos = 0;
    this._advanceDoubtQueue(true);
  }

  // Skips seats already eliminated (caught lying), already-resolved seats
  // (hasDoubted), or seats forfeitSeat() folded out mid-queue (disconnect
  // grace period expired before their turn arrived) — advances to the next
  // live actor, or ends the phase.
  _advanceDoubtQueue(isFirstCall = false) {
    while (this._doubtQueuePos < this._doubtQueue.length) {
      const seatIndex = this._doubtQueue[this._doubtQueuePos];
      const seat = this.seats[seatIndex];
      if (seat.liar || seat.hasDoubted || seat.folded) {
        this._doubtQueuePos += 1;
        continue;
      }
      this.currentActorSeatIndex = seatIndex;
      this._armActionTimer();
      if (!isFirstCall) this._emitUpdate('doubt-turn');
      else this._emitUpdate('doubt-start');
      return;
    }
    this._runShowdown();
  }

  _performBotDoubtTurn() {
    const seatIndex = this.currentActorSeatIndex;
    const seat = this.seats[seatIndex];
    if (!seat || !seat.isBot) return;
    try {
      const targets = this.seats.filter((s) => s.dealtIn && !s.folded && !s.revealed && s.seatIndex !== seatIndex);
      const decision = decideDoubtPokerDoubt({
        seat,
        targets,
        doubtCost: this.doubtCost,
        pot: this._currentPotEstimate(),
        personality: seat.personality,
      });
      this._applyDoubtTurn(seatIndex, decision.targetId ?? null);
    } catch {
      this._applyDoubtTurn(seatIndex, null);
    }
  }

  _currentPotEstimate() {
    return this.seats.reduce((sum, s) => sum + s.committedTotal, 0) + this.doubtBonusPot;
  }

  _applyDoubtTurn(seatIndex, targetId) {
    const seat = this.seats[seatIndex];
    seat.hasDoubted = true;

    if (targetId == null) {
      this._emitUpdate('doubt-pass', { seatId: seat.id });
      this._doubtQueuePos += 1;
      return this._advanceDoubtQueue();
    }

    const target = this.seatById(targetId);
    if (!target || !target.dealtIn || target.folded || target.revealed || target.seatIndex === seatIndex) {
      throw new DoubtPokerActionError('เป้าหมาย Doubt ไม่ถูกต้อง');
    }
    if (seat.chips < this.doubtCost) {
      throw new DoubtPokerActionError('ชิพไม่พอสำหรับสั่ง Doubt');
    }

    seat.chips -= this.doubtCost;
    this.doubtBonusPot += this.doubtCost;

    const evaluated = evaluateHand(target.holeCards, [], FIVE_CARD_VARIANT);
    const truthful = isTruthful(target.announcement, evaluated);
    target.revealed = true;
    target.liar = !truthful;

    this._emitUpdate('doubt-resolved', {
      seatId: seat.id,
      targetId: target.id,
      truthful,
    });

    this._doubtQueuePos += 1;
    this._advanceDoubtQueue();
  }

  // ---- Showdown -------------------------------------------------------------

  _endHandUncontested(winnerSeat) {
    const totalPot = this.seats.filter((s) => s.dealtIn).reduce((sum, s) => sum + s.committedTotal, 0);
    winnerSeat.chips += totalPot;
    this.phase = 'showdown';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.lastResult = { type: 'uncontested', winnerId: winnerSeat.id, amount: totalPot };
    this._emitUpdate('hand-won-uncontested');
    this._finishHand();
  }

  _runShowdown() {
    this.phase = 'showdown';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;

    const contenders = this.seats.filter((s) => s.dealtIn && !s.folded);
    const effectiveById = new Map();
    for (const seat of contenders) {
      effectiveById.set(
        seat.id,
        seat.revealed ? rankFromRealHand(evaluateHand(seat.holeCards, [], FIVE_CARD_VARIANT)) : seat.announcement
      );
    }

    // Every dealt-in seat's contribution counts toward the pot — including
    // players who folded during betting — not just the contenders still
    // eligible to win it. calculatePots already handles "contributed but
    // ineligible" correctly via its own `folded` flag (that's exactly how
    // Hold'em's side pots work); only scoping this to `contenders` would
    // silently drop a folded player's chips out of the pot entirely.
    const potsInput = this.seats
      .filter((s) => s.dealtIn)
      .map((s) => ({ id: s.id, committedTotal: s.committedTotal, folded: s.folded || s.liar }));
    const pots = calculatePots(potsInput);
    if (pots.length > 0) pots[pots.length - 1].amount += this.doubtBonusPot;
    else if (this.doubtBonusPot > 0) {
      // No committed money at all is essentially impossible (blinds always
      // post), but guard anyway so a bonus pot is never silently dropped.
      pots.push({ amount: this.doubtBonusPot, eligiblePlayerIds: contenders.filter((s) => !s.liar).map((s) => s.id) });
    }

    const orderFromDealer = this._seatOrderFromDealer();
    const potResults = [];
    for (const pot of pots) {
      const winners = this._determineClaimWinners(effectiveById, pot.eligiblePlayerIds);
      const shares = splitPotAmount(pot.amount, winners, orderFromDealer);
      for (const [id, amt] of shares) this.seatById(id).chips += amt;
      potResults.push({ amount: pot.amount, winners });
    }

    this.lastResult = {
      type: 'showdown',
      reveals: contenders.map((s) => ({
        seatId: s.id,
        holeCards: s.holeCards,
        announcement: s.announcement,
        liar: s.liar,
        revealed: s.revealed,
      })),
      pots: potResults,
    };

    this._emitUpdate('showdown');
    this._finishHand();
  }

  _determineClaimWinners(effectiveById, eligiblePlayerIds) {
    let best = null;
    let winners = [];
    for (const id of eligiblePlayerIds) {
      const claim = effectiveById.get(id);
      if (!claim) continue;
      if (!best || compareClaims(claim, best) > 0) {
        best = claim;
        winners = [id];
      } else if (compareClaims(claim, best) === 0) {
        winners.push(id);
      }
    }
    return winners;
  }

  _seatOrderFromDealer() {
    const order = [];
    let cursor = this.dealerSeatIndex;
    for (let i = 0; i < this.seats.length; i++) {
      cursor = nextSeatIndex(this.seats, cursor, () => true);
      order.push(this.seats[cursor].id);
    }
    return order;
  }

  _finishHand() {
    for (const seat of this.seats) {
      if (!seat.eliminated && seat.dealtIn && seat.chips <= 0) seat.eliminated = true;
    }
    const remaining = this.activeSeats();
    if (remaining.length <= 1) {
      this.phase = 'gameover';
      this.winnerId = remaining[0]?.id ?? null;
      this._emitUpdate('game-over');
      return;
    }
    this.phase = 'handover';
    this._emitUpdate('hand-over');
    this._arm('nextHand', () => this.startNextHand(), this._delayFor('nextHand'));
  }

  // ---- State snapshot -------------------------------------------------------

  getState() {
    return {
      variantId: 'doubt-poker',
      phase: this.phase,
      handNumber: this.handNumber,
      dealerSeatIndex: this.dealerSeatIndex,
      currentActorSeatId: this.currentActorSeatIndex >= 0 ? this.seats[this.currentActorSeatIndex]?.id : null,
      actionDeadline: this.actionDeadline,
      // Draw phase has no single current actor (every dealt-in seat draws
      // independently), so unlike betting/announce/doubt there's no one
      // shared deadline — each seat that hasn't drawn yet gets its own.
      // Keyed by seat id so doubtPokerStateView.js can hand each viewer just
      // their own draw deadline as `actionDeadline`, letting the client use
      // one uniform field regardless of phase.
      drawDeadlines: Object.fromEntries(
        Object.entries(this._drawDeadlines).map(([seatIndex, deadline]) => [this.seats[Number(seatIndex)].id, deadline])
      ),
      currentBet: this.currentBet,
      minRaiseIncrement: this.minRaiseIncrement,
      doubtCost: this.doubtCost,
      paused: this.paused,
      winnerId: this.winnerId,
      lastResult: this.lastResult,
      pot: this._currentPotEstimate(),
      // Seating order starting just after the dealer, dealt-in seats only —
      // lets the client draw a "who's up next" list for the draw/betting/
      // doubt phases without duplicating the engine's turn-order logic.
      playOrder: this._seatOrderFromDealer().filter((id) => this.seatById(id).dealtIn),
      seats: this.seats.map((s) => ({
        seatIndex: s.seatIndex,
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isBot: s.isBot,
        chips: s.chips,
        eliminated: s.eliminated,
        dealtIn: s.dealtIn,
        folded: s.folded,
        allIn: s.allIn,
        committedStreet: s.committedStreet,
        committedTotal: s.committedTotal,
        holeCards: s.holeCards,
        hasDrawn: s.hasDrawn,
        announcement: s.announcement,
        hasAnnounced: s.hasAnnounced,
        revealed: s.revealed,
        liar: s.liar,
        isDealer: s.seatIndex === this.dealerSeatIndex,
        isSB: s.seatIndex === this.sbSeatIndex,
        isBB: s.seatIndex === this.bbSeatIndex,
      })),
    };
  }
}
