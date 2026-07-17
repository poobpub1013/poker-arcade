import { EventEmitter } from 'node:events';
import { createShuffledDeckWithJoker } from './choicePokerDeck.js';
import { evaluateChoiceHand, compareByDirection } from './choicePokerHandEvaluator.js';
import { splitPotAmount } from './pot.js';
import { decideChoicePokerDraw, decideChoicePokerBet, decideChoicePokerDirection } from './choicePokerBot.js';
import { ACTION_TIMEOUT_MS, BOT_MIN_DELAY_MS, BOT_MAX_DELAY_MS } from '../config.js';

const HAND_END_DELAY_MS = 5000;

export class ChoicePokerActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChoicePokerActionError';
  }
}

// Choice Poker (Kakegurui) — heads-up five-card draw. No fold/call: only
// bet/raise/stand, winner-take-all on an uneven pot, and whoever bet more
// picks whether standard hand rankings apply normally or in reverse. See
// server/game/choicePokerHandEvaluator.js for the hand ranking/comparison
// and the project plan for the full rules writeup. Mirrors GameEngine's
// public shape (startNextHand/handleAction/getLegalActions/getState/
// pause/resume/destroy, emits 'update') so it plugs into the existing
// room/socket plumbing in rooms.js and socket/handlers.js unchanged.
export class ChoicePokerEngine extends EventEmitter {
  constructor({ players }) {
    super();
    if (players.length !== 2) throw new Error('Choice Poker ต้องมีผู้เล่น 2 คนเท่านั้น');

    // Reference stack size for the short-stack push/fold adjustment in
    // choicePokerBot.js — how "short" a stack is only means something
    // relative to where the match started.
    this.startingChips = Math.max(...players.map((p) => p.chips));

    this.seats = players.map((p, index) => ({
      seatIndex: index,
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isBot: !!p.isBot,
      personality: p.personality || null,
      chips: p.chips,
      hand: [],
      hasDrawn: false,
      drawnIndices: new Set(), // positions replaced this hand — only these are ever shown to the opponent
      betThisHand: 0,
    }));

    this.handNumber = 0;
    this.firstBettorSeatIndex = -1;
    this.phase = 'waiting'; // waiting | draw | betting | choice | showdown | handover | gameover
    this.deck = [];
    this.currentBet = 0;
    this.currentBettorSeatIndex = -1; // holds the highest bet — gets the choice if the war ends now
    this.currentActorSeatIndex = -1; // whose turn (betting/choice phases only)
    this.actionDeadline = null;
    this.chosenDirection = null;
    this.lastResult = null;
    this.gameWinnerId = null;
    this.paused = false;

    this._drawDeadlines = {};
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
        if (!seat.hasDrawn && !this._timers[`draw-${seat.seatIndex}`]) this._armDrawTimer(seat.seatIndex);
      }
    } else if ((this.phase === 'betting' || this.phase === 'choice') && this.currentActorSeatIndex >= 0) {
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
      // Timers restart in full on resume — refresh the advertised deadlines
      // to match, or clients keep counting from the pre-pause timestamp.
      if (kind === 'action') this.actionDeadline = Date.now() + ACTION_TIMEOUT_MS;
      if (kind.startsWith('draw-')) {
        this._drawDeadlines[Number(kind.slice('draw-'.length))] = Date.now() + ACTION_TIMEOUT_MS;
      }
    }
    this._emitUpdate('resumed');
  }

  _delayFor(kind) {
    if (kind === 'nextHand') return HAND_END_DELAY_MS;
    const seatIndex = kind === 'action' ? this.currentActorSeatIndex : Number(kind.split('-')[1]);
    const seat = this.seats[seatIndex];
    if (seat?.isBot) return BOT_MIN_DELAY_MS + Math.random() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS);
    return ACTION_TIMEOUT_MS;
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

  seatById(id) {
    return this.seats.find((s) => s.id === id);
  }

  // Used when a multiplayer player's disconnect grace period expires.
  // Choice Poker is always exactly heads-up and has no fold action at all —
  // unlike GameEngine/DoubtPokerEngine there's no "remove one seat, keep
  // going with the rest" to fall back on, since removing either of the only
  // two seats leaves nobody to play against. Simplest correct behavior: end
  // the game immediately and award the remaining seat the win by forfeit,
  // without trying to resolve whatever hand was mid-flight (its pot/bet
  // bookkeeping doesn't need reconciling for a game-over screen).
  forfeitSeat(playerId) {
    const seat = this.seatById(playerId);
    if (!seat || this.phase === 'gameover') return;

    for (const kind of Object.keys(this._timers)) clearTimeout(this._timers[kind]);
    this._timers = {};
    this._pending = {};
    this.phase = 'gameover';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.gameWinnerId = this.seats.find((s) => s.id !== playerId)?.id ?? null;
    this._emitUpdate('seat-forfeited', { seatId: seat.id });
  }

  // Only the cards a seat drew as replacements are ever visible to the
  // opponent (matching the manga rule — kept cards stay secret for bluffing
  // and probability reasoning). Used both for the human-facing state view
  // and to feed the bot AI the same restricted view a human would see, so
  // the bot can't unfairly "peek" at the opponent's kept cards either.
  _maskedHandFor(seatIndex) {
    const seat = this.seats[seatIndex];
    return seat.hand.map((c, i) => (seat.drawnIndices.has(i) ? c : null));
  }

  // ---- Hand lifecycle -----------------------------------------------------

  startNextHand() {
    if (this.seats.some((s) => s.chips <= 0)) {
      const winner = this.seats.find((s) => s.chips > 0);
      this.phase = 'gameover';
      this.gameWinnerId = winner?.id ?? null;
      this._emitUpdate('game-over');
      return;
    }

    this.handNumber += 1;
    this.firstBettorSeatIndex = this.handNumber === 1 ? 0 : 1 - this.firstBettorSeatIndex;

    this.deck = createShuffledDeckWithJoker();
    for (const seat of this.seats) {
      seat.hand = this.deck.splice(0, 5);
      seat.hasDrawn = false;
      seat.drawnIndices = new Set();
      seat.betThisHand = 0;
    }

    this.phase = 'draw';
    this.currentBet = 0;
    this.currentBettorSeatIndex = -1;
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;
    this.chosenDirection = null;
    this.lastResult = null;

    for (const seat of this.seats) this._armDrawTimer(seat.seatIndex);
    this._emitUpdate('hand-start');
  }

  _armDrawTimer(seatIndex) {
    const kind = `draw-${seatIndex}`;
    this._clear(kind);
    this._drawDeadlines[seatIndex] = Date.now() + ACTION_TIMEOUT_MS;
    this._arm(
      kind,
      () => {
        if (this.seats[seatIndex].isBot) this._performBotDraw(seatIndex);
        else this._applyDraw(seatIndex, []); // timeout / disconnected human: stand pat
      },
      this._delayFor(kind)
    );
  }

  _performBotDraw(seatIndex) {
    const seat = this.seats[seatIndex];
    if (!seat || seat.hasDrawn) return;
    try {
      const discardIndices = decideChoicePokerDraw(seat.hand, seat.personality);
      this._applyDraw(seatIndex, discardIndices);
    } catch {
      this._applyDraw(seatIndex, []);
    }
  }

  handleDraw(playerId, discardIndices) {
    const seat = this.seatById(playerId);
    if (!seat) throw new ChoicePokerActionError('ไม่พบผู้เล่นนี้ที่โต๊ะ');
    if (this.phase !== 'draw' || seat.hasDrawn) {
      throw new ChoicePokerActionError('ยังไม่ถึงตาแลกไพ่ของคุณ');
    }
    this._clear(`draw-${seat.seatIndex}`);
    this._applyDraw(seat.seatIndex, discardIndices);
  }

  _applyDraw(seatIndex, discardIndices) {
    const seat = this.seats[seatIndex];
    if (!seat || seat.hasDrawn) return;

    const indices = Array.isArray(discardIndices) ? [...new Set(discardIndices)] : [];
    const validIndices = indices.filter((i) => Number.isInteger(i) && i >= 0 && i < seat.hand.length);
    if (validIndices.length !== indices.length) {
      throw new ChoicePokerActionError('ตำแหน่งไพ่ที่เลือกทิ้งไม่ถูกต้อง');
    }

    for (const i of validIndices) {
      seat.hand[i] = this.deck.shift();
      seat.drawnIndices.add(i);
    }
    seat.hasDrawn = true;
    delete this._drawDeadlines[seatIndex];

    this._emitUpdate('drew', { seatId: seat.id });

    if (this.seats.every((s) => s.hasDrawn)) this._startBettingPhase();
  }

  // ---- Betting war ----------------------------------------------------------

  _startBettingPhase() {
    this.phase = 'betting';
    this.currentActorSeatIndex = this.firstBettorSeatIndex;
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
    if (this.phase === 'choice') return this._applyChoice(this.currentActorSeatIndex, 'stronger');
    // Betting phase: opening action defaults to a minimal bet (can't stand
    // with nothing on the table yet); responding to a bet defaults to Stand.
    if (this.currentBettorSeatIndex === -1) this._applyRaise(this.currentActorSeatIndex, 1);
    else this._applyStand(this.currentActorSeatIndex);
  }

  _performBotAction() {
    const seatIndex = this.currentActorSeatIndex;
    const seat = this.seats[seatIndex];
    if (!seat || !seat.isBot) return;
    const opponentKnownHand = this._maskedHandFor(1 - seatIndex);

    if (this.phase === 'choice') {
      try {
        const direction = decideChoicePokerDirection({ myHand: seat.hand, opponentKnownHand });
        this._applyChoice(seatIndex, direction);
      } catch {
        this._applyChoice(seatIndex, 'stronger');
      }
      return;
    }

    try {
      const opponent = this.seats[1 - seatIndex];
      const decision = decideChoicePokerBet({
        myHand: seat.hand,
        opponentKnownHand,
        currentBet: this.currentBet,
        isOpening: this.currentBettorSeatIndex === -1,
        myStackTotal: seat.chips + seat.betThisHand,
        opponentStackTotal: opponent.chips + opponent.betThisHand,
        personality: seat.personality,
        startingChips: this.startingChips,
      });
      if (decision.action === 'stand') this._applyStand(seatIndex);
      else this._applyRaise(seatIndex, decision.amount);
    } catch {
      if (this.currentBettorSeatIndex === -1) this._applyRaise(seatIndex, 1);
      else this._applyStand(seatIndex);
    }
  }

  getLegalActions(playerId) {
    const seat = this.seatById(playerId);
    if (!seat) return null;

    if (this.phase === 'draw') {
      if (seat.hasDrawn) return null;
      return {
        phase: 'draw',
        timeLeft: this._drawDeadlines[seat.seatIndex]
          ? Math.max(0, this._drawDeadlines[seat.seatIndex] - Date.now())
          : null,
      };
    }

    if (this.phase === 'betting') {
      if (seat.seatIndex !== this.currentActorSeatIndex) return null;
      const stackTotal = seat.chips + seat.betThisHand;
      const isOpening = this.currentBettorSeatIndex === -1;
      return {
        phase: 'betting',
        canStand: !isOpening,
        canRaise: stackTotal > this.currentBet,
        minRaiseTo: this.currentBet + 1,
        maxRaiseTo: stackTotal,
        currentBet: this.currentBet,
        timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null,
      };
    }

    if (this.phase === 'choice') {
      if (seat.seatIndex !== this.currentActorSeatIndex) return null;
      return {
        phase: 'choice',
        timeLeft: this.actionDeadline ? Math.max(0, this.actionDeadline - Date.now()) : null,
      };
    }

    return null;
  }

  // `action` is 'draw' (amount = discard indices), 'raise' (amount = total
  // commit), 'stand', or 'stronger'/'weaker' (choice phase) — interpreted per
  // phase, see getLegalActions for what's legal when. All routed through this
  // single method (rather than separate methods per phase) so the client's
  // existing single `game:action` socket event covers every phase unchanged.
  handleAction(playerId, action, amount) {
    const seat = this.seatById(playerId);
    if (!seat) throw new ChoicePokerActionError('ไม่พบผู้เล่นนี้ที่โต๊ะ');

    if (this.phase === 'draw') {
      if (action !== 'draw') throw new ChoicePokerActionError('ต้องแลกไพ่ก่อนถึงจะเดิมพันได้');
      return this.handleDraw(playerId, amount);
    }

    if (this.phase === 'choice') {
      if (seat.seatIndex !== this.currentActorSeatIndex) throw new ChoicePokerActionError('ยังไม่ถึงตาของคุณ');
      this._clear('action');
      return this._applyChoice(seat.seatIndex, action);
    }
    if (this.phase !== 'betting' || seat.seatIndex !== this.currentActorSeatIndex) {
      throw new ChoicePokerActionError('ยังไม่ถึงตาของคุณ');
    }
    this._clear('action');
    if (action === 'stand') this._applyStand(seat.seatIndex);
    else if (action === 'raise') this._applyRaise(seat.seatIndex, amount);
    else throw new ChoicePokerActionError('ไม่รู้จักการกระทำนี้');
  }

  _applyRaise(seatIndex, amount) {
    const seat = this.seats[seatIndex];
    const stackTotal = seat.chips + seat.betThisHand;
    let target = Number(amount);
    if (!Number.isFinite(target)) throw new ChoicePokerActionError('จำนวนเดิมพันไม่ถูกต้อง');
    target = Math.round(target);
    if (target <= this.currentBet) throw new ChoicePokerActionError('ต้องเดิมพันมากกว่าเดิมพันปัจจุบัน');
    if (target > stackTotal) throw new ChoicePokerActionError('เดิมพันเกินจำนวนชิพที่มี');

    const additional = target - seat.betThisHand;
    seat.chips -= additional;
    seat.betThisHand = target;
    this.currentBet = target;
    this.currentBettorSeatIndex = seatIndex;
    this.currentActorSeatIndex = 1 - seatIndex;

    this._emitUpdate('action', { seatId: seat.id, action: 'raise', amount: target });
    this._armActionTimer();
  }

  _applyStand(seatIndex) {
    const seat = this.seats[seatIndex];
    this._emitUpdate('action', { seatId: seat.id, action: 'stand' });
    this._startChoicePhase();
  }

  // ---- Choice + showdown ------------------------------------------------

  _startChoicePhase() {
    this.phase = 'choice';
    this.currentActorSeatIndex = this.currentBettorSeatIndex;
    this._armActionTimer();
    this._emitUpdate('choice-pending');
  }

  _applyChoice(seatIndex, direction) {
    if (direction !== 'stronger' && direction !== 'weaker') {
      throw new ChoicePokerActionError('ต้องเลือก stronger หรือ weaker');
    }
    this.chosenDirection = direction;
    this._runShowdown();
  }

  _runShowdown() {
    this.phase = 'showdown';
    this.currentActorSeatIndex = -1;
    this.actionDeadline = null;

    const [seatA, seatB] = this.seats;
    const resultA = evaluateChoiceHand(seatA.hand);
    const resultB = evaluateChoiceHand(seatB.hand);
    const outcome = compareByDirection(resultA, resultB, this.chosenDirection);
    const totalPot = seatA.betThisHand + seatB.betThisHand;

    let winnerIds;
    if (outcome === 'tie') {
      winnerIds = [seatA.id, seatB.id];
      const orderFromDealer = [this.currentBettorSeatIndex === seatA.seatIndex ? seatA.id : seatB.id, ...winnerIds].filter(
        (id, i, arr) => arr.indexOf(id) === i
      );
      const shares = splitPotAmount(totalPot, winnerIds, orderFromDealer);
      for (const [id, amt] of shares) this.seatById(id).chips += amt;
    } else {
      const winnerSeat = outcome === 'a' ? seatA : seatB;
      winnerIds = [winnerSeat.id];
      winnerSeat.chips += totalPot;
    }

    this.lastResult = {
      type: 'showdown',
      direction: this.chosenDirection,
      potAmount: totalPot,
      winnerIds,
      reveals: [
        { seatId: seatA.id, hand: seatA.hand, name: resultA.name, description: resultA.description },
        { seatId: seatB.id, hand: seatB.hand, name: resultB.name, description: resultB.description },
      ],
    };

    this._emitUpdate('showdown');
    this._finishHand();
  }

  _finishHand() {
    if (this.seats.some((s) => s.chips <= 0)) {
      const winner = this.seats.find((s) => s.chips > 0);
      this.phase = 'gameover';
      this.gameWinnerId = winner?.id ?? null;
      this._emitUpdate('game-over');
      return;
    }
    this.phase = 'handover';
    this._emitUpdate('hand-over');
    this._arm('nextHand', () => this.startNextHand(), this._delayFor('nextHand'));
  }

  // ---- State snapshot -----------------------------------------------------

  getState() {
    return {
      variantId: 'choice-poker',
      phase: this.phase,
      handNumber: this.handNumber,
      currentActorSeatId: this.currentActorSeatIndex >= 0 ? this.seats[this.currentActorSeatIndex]?.id : null,
      currentBettorSeatId: this.currentBettorSeatIndex >= 0 ? this.seats[this.currentBettorSeatIndex]?.id : null,
      actionDeadline: this.actionDeadline,
      // Draw phase has no single "current actor" (both seats can be drawing
      // at once), so unlike betting/choice there's no one shared deadline —
      // each seat that hasn't drawn yet gets its own. Keyed by seat id so
      // choicePokerStateView.js can hand each viewer just their own draw
      // deadline as `actionDeadline`, letting the client use one uniform
      // field regardless of phase.
      drawDeadlines: Object.fromEntries(
        Object.entries(this._drawDeadlines).map(([seatIndex, deadline]) => [this.seats[Number(seatIndex)].id, deadline])
      ),
      currentBet: this.currentBet,
      chosenDirection: this.chosenDirection,
      paused: this.paused,
      gameWinnerId: this.gameWinnerId,
      lastResult: this.lastResult,
      pot: this.seats.reduce((sum, s) => sum + s.betThisHand, 0),
      seats: this.seats.map((s) => ({
        seatIndex: s.seatIndex,
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isBot: s.isBot,
        chips: s.chips,
        hand: s.hand,
        hasDrawn: s.hasDrawn,
        drawnIndices: [...s.drawnIndices],
        betThisHand: s.betThisHand,
        isFirstBettor: s.seatIndex === this.firstBettorSeatIndex,
      })),
    };
  }
}
