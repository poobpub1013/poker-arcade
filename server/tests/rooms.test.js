import { describe, it, expect, afterEach } from 'vitest';
import { RoomManager } from '../rooms.js';
import { GameEngine } from '../game/engine.js';
import { ChoicePokerEngine } from '../game/choicePokerEngine.js';
import { DoubtPokerEngine } from '../game/doubtPokerEngine.js';

describe('RoomManager — multiplayer lobby', () => {
  let manager;
  afterEach(() => {
    if (manager) for (const code of [...manager.rooms.keys()]) manager.closeRoom(code);
  });

  function freshManager() {
    manager = new RoomManager();
    return manager;
  }

  it('createLobbyRoom creates a lobby-status multiplayer room with the host as sole member', () => {
    const m = freshManager();
    const { code, playerId, token } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });

    const room = m.getRoom(code);
    expect(room.mode).toBe('multiplayer');
    expect(room.status).toBe('lobby');
    expect(room.hostId).toBe(playerId);
    expect(room.members.size).toBe(1);
    expect(room.members.get(playerId).token).toBe(token);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('joinRoom adds a new member and rejects a full or already-started room', () => {
    const m = freshManager();
    const { code } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 2,
      startingChips: 1000,
    });

    const joined = m.joinRoom(code, { name: 'Joiner', avatar: null });
    expect(joined.playerId).toBeTruthy();
    expect(m.getRoom(code).members.size).toBe(2);

    // Room is now full (maxPlayers=2).
    expect(() => m.joinRoom(code, { name: 'Third', avatar: null })).toThrow();

    expect(() => m.joinRoom('9999', { name: 'X', avatar: null })).toThrow();
  });

  it('joinRoom rejects once the game has started', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });
    m.joinRoom(code, { name: 'P2', avatar: null });
    m.startLobbyGame(code, playerId);

    expect(() => m.joinRoom(code, { name: 'Late', avatar: null })).toThrow();
  });

  it('addBotToLobby is host-only', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 3,
      startingChips: 1000,
    });
    const { playerId: joinerId } = m.joinRoom(code, { name: 'Joiner', avatar: null });

    expect(() => m.addBotToLobby(code, joinerId)).toThrow(); // not host
    m.addBotToLobby(code, playerId); // host can
    expect(m.getRoom(code).members.size).toBe(3);
  });

  it('addBotToLobby fills an open seat and rejects once full', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 3,
      startingChips: 1000,
    });
    m.addBotToLobby(code, playerId);
    expect(m.getRoom(code).members.size).toBe(2);
    m.addBotToLobby(code, playerId);
    expect(m.getRoom(code).members.size).toBe(3);
    expect(() => m.addBotToLobby(code, playerId)).toThrow(); // full now
  });

  it('addBotToLobby refills a seat after a non-last bot is kicked', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });
    m.addBotToLobby(code, playerId);
    m.addBotToLobby(code, playerId);
    m.addBotToLobby(code, playerId);
    expect(m.getRoom(code).members.size).toBe(4);

    // Kick the FIRST bot: surviving bot ids are sparse (1, 2), so a naive
    // "next id = bot count" collides with the live bot-2 and Map.set would
    // silently overwrite it instead of adding a member.
    const firstBotId = [...m.getRoom(code).members.values()].find((mem) => mem.isBot).id;
    m.kickMember(code, playerId, firstBotId);
    expect(m.getRoom(code).members.size).toBe(3);

    m.addBotToLobby(code, playerId);
    expect(m.getRoom(code).members.size).toBe(4);

    // All bots must remain distinct personalities (distinct ids/names).
    const bots = [...m.getRoom(code).members.values()].filter((mem) => mem.isBot);
    expect(new Set(bots.map((b) => b.id)).size).toBe(3);
    expect(new Set(bots.map((b) => b.name)).size).toBe(3);
  });

  it('updateLobbyConfig rejects for a fixed-size variant (Choice Poker)', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'choice-poker',
      maxPlayers: 2,
      startingChips: 1000,
    });
    expect(m.getRoom(code).maxPlayers).toBe(2);
    expect(() => m.updateLobbyConfig(code, playerId, { maxPlayers: 3 })).toThrow();
  });

  it('updateLobbyConfig rejects going below current membership or above the variant cap', () => {
    const m = freshManager();
    const { code, playerId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'doubt-poker',
      maxPlayers: 6,
      startingChips: 1000,
    });
    m.joinRoom(code, { name: 'P2', avatar: null });
    m.joinRoom(code, { name: 'P3', avatar: null });

    expect(() => m.updateLobbyConfig(code, playerId, { maxPlayers: 2 })).toThrow(); // below current 3 members
    expect(() => m.updateLobbyConfig(code, playerId, { maxPlayers: 7 })).toThrow(); // doubt-poker caps at 6
    m.updateLobbyConfig(code, playerId, { maxPlayers: 4 });
    expect(m.getRoom(code).maxPlayers).toBe(4);
  });

  it('removeMember reassigns the host when the host leaves, and closes the room once no humans remain', () => {
    const m = freshManager();
    const { code, playerId: hostId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });
    const { playerId: p2Id } = m.joinRoom(code, { name: 'P2', avatar: null });

    m.removeMember(code, hostId);
    expect(m.getRoom(code).hostId).toBe(p2Id);
    expect(m.getRoom(code).members.size).toBe(1);

    m.removeMember(code, p2Id);
    expect(m.getRoom(code)).toBeUndefined(); // room closed, no humans left
  });

  it('startLobbyGame is host-only, validates capacity, and instantiates the right engine per variant', () => {
    const m = freshManager();

    // Hold'em: needs >= MIN_PLAYERS (2).
    {
      const { code, playerId } = m.createLobbyRoom({
        hostPlayer: { name: 'Host', avatar: null },
        variantId: 'texas-holdem',
        maxPlayers: 4,
        startingChips: 1000,
      });
      expect(() => m.startLobbyGame(code, playerId)).toThrow(); // only 1 member so far
      m.joinRoom(code, { name: 'P2', avatar: null });
      m.startLobbyGame(code, playerId);
      const room = m.getRoom(code);
      expect(room.status).toBe('playing');
      expect(room.engine).toBeInstanceOf(GameEngine);
    }

    // Choice Poker: fixed at exactly 2.
    {
      const { code, playerId } = m.createLobbyRoom({
        hostPlayer: { name: 'Host', avatar: null },
        variantId: 'choice-poker',
        maxPlayers: 2,
        startingChips: 1000,
      });
      expect(() => m.startLobbyGame(code, playerId)).toThrow(); // needs exactly 2, has 1
      m.joinRoom(code, { name: 'P2', avatar: null });
      m.startLobbyGame(code, playerId);
      expect(m.getRoom(code).engine).toBeInstanceOf(ChoicePokerEngine);
    }

    // Doubt Poker: 2-6.
    {
      const { code, playerId } = m.createLobbyRoom({
        hostPlayer: { name: 'Host', avatar: null },
        variantId: 'doubt-poker',
        maxPlayers: 6,
        startingChips: 1000,
      });
      m.joinRoom(code, { name: 'P2', avatar: null });
      m.startLobbyGame(code, playerId);
      expect(m.getRoom(code).engine).toBeInstanceOf(DoubtPokerEngine);
    }

    // Non-host cannot start.
    {
      const { code, playerId } = m.createLobbyRoom({
        hostPlayer: { name: 'Host', avatar: null },
        variantId: 'texas-holdem',
        maxPlayers: 4,
        startingChips: 1000,
      });
      const { playerId: joinerId } = m.joinRoom(code, { name: 'P2', avatar: null });
      expect(() => m.startLobbyGame(code, joinerId)).toThrow();
    }
  });

  it('kickMember is host-only, cannot target self, and removes bots or fellow humans from the lobby', () => {
    const m = freshManager();
    const { code, playerId: hostId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });
    const { playerId: p2Id } = m.joinRoom(code, { name: 'P2', avatar: null });
    m.addBotToLobby(code, hostId);
    expect(m.getRoom(code).members.size).toBe(3);

    expect(() => m.kickMember(code, p2Id, hostId)).toThrow(); // non-host can't kick
    expect(() => m.kickMember(code, hostId, hostId)).toThrow(); // can't kick self

    const botId = [...m.getRoom(code).members.values()].find((mem) => mem.isBot).id;
    m.kickMember(code, hostId, botId);
    expect(m.getRoom(code).members.size).toBe(2);
    expect(m.getRoom(code).members.has(botId)).toBe(false);

    m.kickMember(code, hostId, p2Id);
    expect(m.getRoom(code).members.size).toBe(1);
    expect(m.getRoom(code).members.has(p2Id)).toBe(false);
  });

  it('startRematch tears down the old engine and deals a fresh match with reset chips into the same room', () => {
    const m = freshManager();
    const { code, playerId: hostId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'choice-poker',
      maxPlayers: 2,
      startingChips: 500,
    });
    m.joinRoom(code, { name: 'P2', avatar: null });
    m.startLobbyGame(code, hostId);

    const room = m.getRoom(code);
    const firstEngine = room.engine;
    // Simulate the match having ended (one seat felted) without needing a
    // full hand-by-hand simulation.
    room.engine.seats[0].chips = 0;
    room.engine.seats[1].chips = 1000;

    m.startRematch(code);

    expect(room.engine).not.toBe(firstEngine); // old engine replaced, not mutated
    expect(room.engine.seats.every((s) => s.chips === 500)).toBe(true); // reset to startingChips
    expect(room.status).toBe('playing');
  });

  it('startRematch refuses to restart below the variant minimum player count (e.g. everyone else left during the rematch wait)', () => {
    const m = freshManager();
    const { code, playerId: hostId } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'choice-poker', // fixed at exactly 2
      maxPlayers: 2,
      startingChips: 500,
    });
    const { playerId: p2Id } = m.joinRoom(code, { name: 'P2', avatar: null });
    m.startLobbyGame(code, hostId);

    // Simulate the other player having left during a post-gameover rematch
    // wait, leaving the room below Choice Poker's required exactly-2.
    m.removeMember(code, p2Id);

    expect(() => m.startRematch(code)).toThrow();
  });

  it('rejoin identity: a member looked up by id requires the matching token to be meaningful (spoofing check happens at the socket layer, but the id/token pair itself must be unique and stable)', () => {
    const m = freshManager();
    const { code, playerId, token } = m.createLobbyRoom({
      hostPlayer: { name: 'Host', avatar: null },
      variantId: 'texas-holdem',
      maxPlayers: 4,
      startingChips: 1000,
    });
    const { playerId: p2Id, token: p2Token } = m.joinRoom(code, { name: 'P2', avatar: null });

    expect(playerId).not.toBe(p2Id);
    expect(token).not.toBe(p2Token);
    const room = m.getRoom(code);
    expect(room.members.get(playerId).token).toBe(token);
    expect(room.members.get(p2Id).token).toBe(p2Token);
  });
});
