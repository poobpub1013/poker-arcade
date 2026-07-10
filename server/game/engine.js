import { EventEmitter } from 'node:events';
import { createShuffledDeck } from './deck.js';
import { evaluateHand, determineWinners } from './handEvaluator.js';
import { calculatePots, splitPotAmount } from './pot.js';
import { decideBotAction } from './bots.js';
import { ACTION_TIMEOUT_MS, BOT_MIN_DELAY_MS, BOT_MAX_DELAY_MS, nextBlindLevel } from '../config.js';

const HAND_END_DELAY_MS = 5000;
const STREET_REVEAL_DELAY_MS = 1100;

export class GameActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GameActionError';
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

function inHand(seat) {
  return !seat.eliminated && seat.dealtIn;
}

// GameEngine runs one table's entire lifecycle across many hands. It is fully
// server-authoritative: clients only ever send an action and receive filtered
// state back. Works identically whether every seat is a bot or a human.
export class GameEngine extends EventEmitter {
  constructor({ variant, players, smallBlind, bigBlind, blindIncreaseHands = 0 }) {
    super();
    this.variant = variant;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.blindIncreaseHands = blindIncreaseHands > 0 ? Math.round(blindIncreaseHands) : 0;
    this.blindLevel = 1;

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
    }));

    this.handNumber = 0;
    this.dealerSeatIndex = -1;
    this.phase = 'waiting'; // waiting | betting | revealing | showdown | handover | gameover
    this.street = null;
    this.board = [];
    this.currentBet = 0;
    this.minRaiseIncrement = bigBlind;
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.winnerId = null;
    this.lastResult = null; // populated at handover with showdown/uncontested info
    this.paused = false;

    this._playersToAct = new Set();
    this._timers = {};
    this._pending = {};

    // Belt-and-suspenders: if something ever leaves the table waiting on an
    // actor with no timer scheduled (a bug we don't yet know about, a missed
    // edge case, anything), this notices within a few seconds and re-arms
    // the action clock itself instead of the table staying stuck forever.
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
    if (this.phase !== 'betting') return;
    if (this.currentActorSeatIndex < 0) return;
    if (this._timers.action || this._timers.bot) return;
    this._armActionTimer();
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
      this._arm(kind, fn, kind === 'action' ? ACTION_TIMEOUT_MS : this._delayFor(kind));
    }
    this._emitUpdate('resumed');
  }

  _delayFor(kind) {
    if (kind === 'bot') return BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
    if (kind === 'reveal') return STREET_REVEAL_DELAY_MS;
    if (kind === 'nextHand') return HAND_END_DELAY_MS;
    return 800;
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
    if (
      this.blindIncreaseHands > 0 &&
      this.handNumber > 1 &&
      (this.handNumber - 1) % this.blindIncreaseHands === 0
    ) {
      const next = nextBlindLevel(this.smallBlind, this.bigBlind);
      this.smallBlind = next.smallBlind;
      this.bigBlind = next.bigBlind;
      this.blindLevel += 1;
    }
    this.dealerSeatIndex =
      this.handNumber === 1
        ? this.seats.findIndex((s) => !s.eliminated)
        : nextSeatIndex(this.seats, this.dealerSeatIndex, (s) => !s.eliminated);

    for (const seat of this.seats) {
      if (seat.eliminated) continue;
      seat.dealtIn = true;
      seat.folded = false;
      seat.allIn = false;
      seat.committedStreet = 0;
      seat.committedTotal = 0;
      seat.holeCards = [];
    }
    for (const seat of this.seats) {
      // Clears the busted-out hand from the table once play moves on — kept
      // through this hand's own showdown reveal (still useful there), gone
      // from the next hand onward instead of lingering on an idle seat.
      if (seat.eliminated) {
        seat.dealtIn = false;
        seat.holeCards = [];
        seat.allIn = false;
        seat.folded = false;
        seat.committedStreet = 0;
        seat.committedTotal = 0;
      }
    }

    this.deck = createShuffledDeck();
    this.board = [];
    this.street = null;
    this.lastResult = null;

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

    this._dealHoleCards();

    this.phase = 'betting';
    this.currentBet = this.bigBlind;
    this.minRaiseIncrement = this.bigBlind;
    this._startBettingRound('preflop', {
      firstActorSeatIndex:
        activeCount === 2
          ? sbSeatIndex
          : nextSeatIndex(this.seats, bbSeatIndex, canAct),
      resetStreetCommitments: false,
    });

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

  _dealHoleCards() {
    // Deal starting from the seat left of the dealer, in table order.
    const dealOrder = [];
    let cursor = this.dealerSeatIndex;
    for (let i = 0; i < this.seats.length; i++) {
      cursor = nextSeatIndex(this.seats, cursor, () => true);
      dealOrder.push(cursor);
    }
    for (const seatIdx of dealOrder) {
      const seat = this.seats[seatIdx];
      if (!seat.dealtIn) continue;
      seat.holeCards = this.deck.splice(0, this.variant.holeCards);
    }
  }

  // ---- Betting rounds ------------------------------------------------------

  _startBettingRound(streetName, { firstActorSeatIndex, resetStreetCommitments }) {
    this.street = streetName;
    if (resetStreetCommitments) {
      for (const seat of this.seats) {
        if (!seat.dealtIn) continue;
        seat.committedStreet = 0;
      }
      this.currentBet = 0;
      this.minRaiseIncrement = this.bigBlind;
    }
    this.lastAggressorSeatIndex = streetName === 'preflop' ? this.bbSeatIndex : null;

    this._playersToAct = new Set(
      this.seats.filter((s) => canAct(s)).map((s) => s.seatIndex)
    );

    if (this._playersToAct.size === 0) {
      return this._closeBettingRound();
    }

    this.currentActorSeatIndex = this._playersToAct.has(firstActorSeatIndex)
      ? firstActorSeatIndex
      : nextSeatIndex(this.seats, firstActorSeatIndex, (s) => this._playersToAct.has(s.seatIndex));

    this._armActionTimer();
  }

  _armActionTimer() {
    this._clear('action');
    this.actionDeadline = Date.now() + ACTION_TIMEOUT_MS;
    const actor = this.seats[this.currentActorSeatIndex];
    if (actor.isBot) {
      this._clear('bot');
      this._arm('bot', () => this._performBotAction(), this._delayFor('bot'));
    } else {
      this._arm('action', () => this._handleTimeout(), ACTION_TIMEOUT_MS);
    }
  }

  _handleTimeout() {
    const seat = this.seats[this.currentActorSeatIndex];
    if (!seat) return;
    if (seat.committedStreet === this.currentBet) {
      this._applyAction(seat.seatIndex, 'check');
    } else {
      this._applyAction(seat.seatIndex, 'fold');
    }
  }

  _performBotAction() {
    const seat = this.seats[this.currentActorSeatIndex];
    if (!seat || !seat.isBot) return;
    try {
      const decision = decideBotAction({
        seat,
        seats: this.seats,
        board: this.board,
        currentBet: this.currentBet,
        minRaiseIncrement: this.minRaiseIncrement,
        variant: this.variant,
        street: this.street,
        bigBlind: this.bigBlind,
        getRaiseBounds: (idx) => this._getRaiseBounds(idx),
        personality: seat.personality,
      });
      this._applyAction(seat.seatIndex, decision.action, decision.amount);
    } catch {
      // A bot's decision must never be able to stall or crash the table —
      // fall back to the safest legal action (fold, or check when free).
      try {
        const toCall = this.currentBet - seat.committedStreet;
        this._applyAction(seat.seatIndex, toCall > 0 ? 'fold' : 'check');
      } catch {
        // Leave it to the watchdog to recover if even the fallback fails.
      }
    }
  }

  getLegalActions(playerId) {
    const seat = this.seatById(playerId);
    if (!seat || seat.seatIndex !== this.currentActorSeatIndex || this.phase !== 'betting') {
      return null;
    }
    const toCall = this.currentBet - seat.committedStreet;
    const bounds = this._getRaiseBounds(seat.seatIndex);
    return {
      canCheck: toCall <= 0,
      canCall: toCall > 0,
      callAmount: Math.max(0, Math.min(toCall, seat.chips)),
      canRaise: bounds.max > this.currentBet && seat.chips > Math.max(0, toCall),
      minRaiseTo: bounds.min,
      maxRaiseTo: bounds.max,
      timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null,
    };
  }

  _getRaiseBounds(seatIndex) {
    const seat = this.seats[seatIndex];
    const stackTotal = seat.chips + seat.committedStreet;
    if (this.variant.bettingStructure === 'pot-limit') {
      const callAmount = Math.max(0, Math.min(this.currentBet - seat.committedStreet, seat.chips));
      const potTotal = this.seats.reduce((sum, s) => sum + s.committedTotal, 0);
      const maxRaiseIncrement = potTotal + callAmount;
      const max = Math.min(this.currentBet + maxRaiseIncrement, stackTotal);
      const min = Math.min(this.currentBet + this.minRaiseIncrement, stackTotal);
      return { min, max };
    }
    return {
      min: Math.min(this.currentBet + this.minRaiseIncrement, stackTotal),
      max: stackTotal,
    };
  }

  // Forcibly removes a seat mid-hand, regardless of whose turn it is — used
  // when a multiplayer player's disconnect grace period expires. _applyAction
  // always pivots the "who's next" computation off `this.currentActorSeatIndex`,
  // not the seat parameter it's given, so it's only safe to call when the
  // forfeited seat IS the current actor; otherwise doing so would silently
  // skip the real current actor's turn. The two phases below split on exactly
  // that distinction. `chips`/`eliminated` are set FIRST, before either
  // branch runs, so that if this forfeit brings activeSeats() down to 1,
  // _finishHand's gameover check (triggered synchronously via the fold
  // cascade below) sees it immediately instead of only catching up on the
  // next natural hand transition. `folded` is deliberately NOT touched
  // outside the betting phase — an in-flight showdown already scopes
  // contenders by `dealtIn && !folded`, so a player who disconnected right
  // as their winning hand was about to be scored still gets paid.
  forfeitSeat(playerId) {
    const seat = this.seatById(playerId);
    if (!seat || seat.eliminated) return;

    const wasCurrentActor = this.phase === 'betting' && seat.seatIndex === this.currentActorSeatIndex;
    const wasOwedAction = this.phase === 'betting' && this._playersToAct.has(seat.seatIndex);

    seat.chips = 0;
    seat.eliminated = true;

    if (wasCurrentActor) {
      this._clear('action');
      this._clear('bot');
      this._applyAction(seat.seatIndex, 'fold');
    } else if (wasOwedAction) {
      seat.folded = true;
      this._playersToAct.delete(seat.seatIndex);
      if (this._playersToAct.size === 0) this._closeBettingRound();
    }

    this._emitUpdate('seat-forfeited', { seatId: seat.id });
  }

  // Applies a validated action. `amount` is the TOTAL committedStreet target
  // for 'raise' (i.e. "raise to X"); ignored for fold/check/call.
  handleAction(playerId, action, amount) {
    const seat = this.seatById(playerId);
    if (!seat) throw new GameActionError('ไม่พบผู้เล่นนี้ที่โต๊ะ');
    if (this.phase !== 'betting' || seat.seatIndex !== this.currentActorSeatIndex) {
      throw new GameActionError('ยังไม่ถึงตาของคุณ');
    }
    this._clear('action');
    this._clear('bot');
    this._applyAction(seat.seatIndex, action, amount);
  }

  _applyAction(seatIndex, action, amount) {
    const seat = this.seats[seatIndex];
    const toCall = this.currentBet - seat.committedStreet;

    if (action === 'fold') {
      seat.folded = true;
      this._playersToAct.delete(seatIndex);
    } else if (action === 'check') {
      if (toCall > 0) throw new GameActionError('ยังมีเงินเดิมพันที่ต้องตาม ไม่สามารถ check ได้');
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
      if (!Number.isFinite(target)) throw new GameActionError('จำนวนเดิมพันไม่ถูกต้อง');
      target = Math.round(target);
      if (target > stackTotal) throw new GameActionError('เดิมพันเกินจำนวนชิพที่มี');
      if (target < bounds.min && target < stackTotal) {
        throw new GameActionError(`ต้องเรซอย่างน้อย ${bounds.min}`);
      }
      if (target <= this.currentBet) throw new GameActionError('จำนวนเรซต้องมากกว่าเดิมพันปัจจุบัน');

      const increment = target - this.currentBet;
      const additionalChips = target - seat.committedStreet;
      seat.chips -= additionalChips;
      seat.committedTotal += additionalChips;
      seat.committedStreet = target;
      if (seat.chips === 0) seat.allIn = true;
      this.currentBet = target;
      if (increment > this.minRaiseIncrement) this.minRaiseIncrement = increment;
      this.lastAggressorSeatIndex = seatIndex;

      this._playersToAct = new Set(
        this.seats.filter((s) => canAct(s) && s.seatIndex !== seatIndex).map((s) => s.seatIndex)
      );
    } else {
      throw new GameActionError('ไม่รู้จักการกระทำนี้');
    }

    // Advance state fully before emitting — listeners call getState()
    // synchronously off this event, so emitting first would broadcast the
    // stale pre-advance actor instead of whoever should act next.
    if (this._playersToAct.size === 0) {
      this._closeBettingRound();
    } else {
      this.currentActorSeatIndex = nextSeatIndex(
        this.seats,
        this.currentActorSeatIndex,
        (s) => this._playersToAct.has(s.seatIndex)
      );
      this._armActionTimer();
    }

    this._emitUpdate('action', { seatId: seat.id, action });
  }

  _closeBettingRound() {
    this._refundUncalledBet();

    const stillIn = this.seats.filter((s) => s.dealtIn && !s.folded);
    if (stillIn.length === 1) {
      return this._endHandUncontested(stillIn[0]);
    }

    const canStillBet = stillIn.filter((s) => !s.allIn);
    const currentStreetIdx = this.variant.streets.findIndex((s) => s.name === this.street);
    const isLastStreet = currentStreetIdx === this.variant.streets.length - 1;

    if (canStillBet.length <= 1) {
      return this._autoRunRemainingStreets(currentStreetIdx);
    }
    if (isLastStreet) {
      return this._runShowdown();
    }
    const nextStreet = this.variant.streets[currentStreetIdx + 1];
    this.board.push(...this.deck.splice(0, nextStreet.dealToBoard));
    this._startBettingRound(nextStreet.name, {
      firstActorSeatIndex: nextSeatIndex(this.seats, this.dealerSeatIndex, canAct),
      resetStreetCommitments: true,
    });
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
  }

  _autoRunRemainingStreets(fromStreetIdx) {
    this.phase = 'revealing';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this._emitUpdate('revealing');
    let idx = fromStreetIdx + 1;
    const dealOne = () => {
      if (idx >= this.variant.streets.length) {
        return this._runShowdown();
      }
      const s = this.variant.streets[idx];
      this.street = s.name;
      this.board.push(...this.deck.splice(0, s.dealToBoard));
      idx += 1;
      this._emitUpdate('board-dealt');
      this._arm('reveal', dealOne, this._delayFor('reveal'));
    };
    dealOne();
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

  _runShowdown() {
    this.phase = 'showdown';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;

    const contenders = this.seats.filter((s) => s.dealtIn && !s.folded);
    const resultsById = new Map();
    for (const seat of contenders) {
      resultsById.set(seat.id, evaluateHand(seat.holeCards, this.board, this.variant));
    }

    const potsInput = this.seats
      .filter((s) => s.dealtIn)
      .map((s) => ({ id: s.id, committedTotal: s.committedTotal, folded: s.folded }));
    const pots = calculatePots(potsInput);
    const orderFromDealer = this._seatOrderFromDealer();

    const potResults = [];
    for (const pot of pots) {
      const winners = determineWinners(resultsById, pot.eligiblePlayerIds);
      const shareMap = splitPotAmount(pot.amount, winners, orderFromDealer);
      for (const [id, amt] of shareMap) {
        this.seatById(id).chips += amt;
      }
      potResults.push({
        amount: pot.amount,
        winners,
        description: resultsById.get(winners[0])?.description ?? '',
      });
    }

    // Best hand first, so a glance at the top row tells you where you stand.
    const rankedContenders = [...contenders].sort((a, b) =>
      resultsById.get(a.id).hand.compare(resultsById.get(b.id).hand)
    );

    this.lastResult = {
      type: 'showdown',
      reveals: rankedContenders.map((s) => ({
        seatId: s.id,
        holeCards: s.holeCards,
        description: resultsById.get(s.id)?.description ?? '',
      })),
      pots: potResults,
    };

    this._emitUpdate('showdown');
    this._finishHand();
  }

  _endHandUncontested(winnerSeat) {
    const totalPot = this.seats
      .filter((s) => s.dealtIn)
      .reduce((sum, s) => sum + s.committedTotal, 0);
    winnerSeat.chips += totalPot;

    this.phase = 'showdown';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.lastResult = {
      type: 'uncontested',
      winnerId: winnerSeat.id,
      amount: totalPot,
    };
    this._emitUpdate('hand-won-uncontested');
    this._finishHand();
  }

  _finishHand() {
    for (const seat of this.seats) {
      if (!seat.eliminated && seat.dealtIn && seat.chips <= 0) {
        seat.eliminated = true;
      }
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
      phase: this.phase,
      street: this.street,
      board: [...this.board],
      variantId: this.variant.id,
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      blindLevel: this.blindLevel,
      handsUntilBlindIncrease:
        this.blindIncreaseHands > 0
          ? this.blindIncreaseHands - ((this.handNumber - 1) % this.blindIncreaseHands)
          : null,
      dealerSeatIndex: this.dealerSeatIndex,
      currentActorSeatId: this.currentActorSeatIndex >= 0 ? this.seats[this.currentActorSeatIndex]?.id : null,
      actionDeadline: this.actionDeadline,
      currentBet: this.currentBet,
      minRaiseIncrement: this.minRaiseIncrement,
      paused: this.paused,
      winnerId: this.winnerId,
      lastResult: this.lastResult,
      pot: this.seats.reduce((sum, s) => sum + s.committedTotal, 0),
      // Seating order starting just after the dealer, dealt-in seats only —
      // lets the client draw a "who's up next" list without duplicating the
      // engine's turn-order logic (same field Doubt Poker exposes).
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
        isDealer: s.seatIndex === this.dealerSeatIndex,
        isSB: s.seatIndex === this.sbSeatIndex,
        isBB: s.seatIndex === this.bbSeatIndex,
      })),
    };
  }
}
