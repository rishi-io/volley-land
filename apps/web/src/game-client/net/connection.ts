import {
  type ClientToServerEvents,
  type CommandAck,
  GAME_SOCKET_PATH,
  type MatchSetup,
  type MatchSetupMessage,
  PROTOCOL_VERSION,
  type ServerToClientEvents,
  type SettingChange,
  type StateSnapshot,
  type WeaponIdDto,
} from '@volleyland/contracts';
import { type Socket, io } from 'socket.io-client';
import { ServerClock, SnapshotBuffer } from './snapshot-buffer';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ServerEvent = keyof ServerToClientEvents;
/** Events a session subscribes to; the connection itself consumes setups and snapshots. */
type MatchEvent = Exclude<ServerEvent, 'match.setup' | 'state.snapshot'>;
type MessageOf<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];
/** Socket.IO's typed overloads cannot follow a generic event name; `on` subscribes through this view. */
interface UntypedSocket {
  on(event: string, listener: (message: never) => void): unknown;
  off(event: string, listener: (message: never) => void): unknown;
}

/** The match this connection is playing in. matchId and setup change when the server starts a new match. */
export interface JoinedMatch {
  playerId: string;
  matchId: string;
  setup: MatchSetup;
}

/**
 * How the setup reached the client: on join, with a new match (the server replaced it after an
 * admin change; everything restarts), or as an update to the running match (presentation only).
 */
export type SetupChange = 'joined' | 'new-match' | 'updated';

/** `changes` lists the admin changes that led to a new or updated setup (empty on join). */
type SetupListener = (joined: JoinedMatch, change: SetupChange, changes: SettingChange[]) => void;

/**
 * The client end of /ws, and only that: envelopes and sequences every command, keeps track of the
 * match it is in, buffers snapshots, tracks the server clock and measures input round-trip time.
 * It knows nothing about the scene or the HUD; GameSession turns its events into game state.
 */
export class GameConnection {
  readonly snapshots = new SnapshotBuffer();
  readonly clock = new ServerClock();
  private readonly socket: GameSocket;
  private current: JoinedMatch | null = null;
  private seq = 0;
  private readonly inputSentAt = new Map<number, number>();
  private readonly setupListeners = new Set<SetupListener>();
  /** Called with each RTT sample (ms), measured from send to the snapshot acknowledging it. */
  onRttSample: ((ms: number) => void) | null = null;
  /** Called with each snapshot's approximate JSON size in bytes. */
  onSnapshotSize: ((bytes: number) => void) | null = null;

  constructor(url: string) {
    this.socket = io(url, { path: GAME_SOCKET_PATH, transports: ['websocket'], autoConnect: false });
    this.socket.on('state.snapshot', (snapshot) => this.isCurrent(snapshot) && this.handleSnapshot(snapshot));
    this.socket.on('match.setup', (message) => this.handleSetup(message));
  }

  get joined(): JoinedMatch | null {
    return this.current;
  }

  async join(roomCode: string): Promise<JoinedMatch> {
    if (!this.socket.connected) {
      this.socket.connect();
      await new Promise<void>((resolve, reject) => {
        this.socket.once('connect', () => resolve());
        this.socket.once('connect_error', (error) => reject(error));
      });
    }
    const ack = await this.socket.timeout(5000).emitWithAck('room.join', {
      v: PROTOCOL_VERSION,
      matchId: null,
      msgId: crypto.randomUUID(),
      seq: this.seq++,
      roomCode,
    });
    if (!ack.ok) throw new Error(ack.message);
    this.current = { playerId: ack.playerId, matchId: ack.matchId, setup: ack.setup };
    this.publishSetup('joined', []);
    return this.current;
  }

  /** Be told whenever the match setup arrives or changes. Returns the unsubscribe function. */
  onSetup(listener: SetupListener): () => void {
    this.setupListeners.add(listener);
    return () => this.setupListeners.delete(listener);
  }

  /**
   * Subscribe to a server event for the current match. Events from a match this connection has
   * left are dropped here, so handlers never see them. Returns the unsubscribe function.
   */
  on<E extends MatchEvent>(event: E, handler: (message: MessageOf<E>) => void): () => void {
    const listener = (message: MessageOf<E>) => {
      if (this.isCurrent(message)) handler(message);
    };
    const socket = this.socket as unknown as UntypedSocket;
    socket.on(event, listener);
    return () => socket.off(event, listener);
  }

  onDisconnect(handler: () => void): () => void {
    this.socket.on('disconnect', handler);
    return () => this.socket.off('disconnect', handler);
  }

  /** Send one input step; returns its sequence number for prediction. */
  sendInput(moveX: number, moveZ: number, yaw: number): number {
    const seq = this.seq++;
    this.inputSentAt.set(seq, performance.now());
    this.socket.emit('player.input', { ...this.envelope(seq), moveX, moveZ, yaw });
    return seq;
  }

  throwProjectile(yaw: number, pitch: number): Promise<CommandAck> {
    return this.socket.timeout(3000).emitWithAck('projectile.request', { ...this.envelope(this.seq++), yaw, pitch });
  }

  selectWeapon(weapon: WeaponIdDto): Promise<CommandAck> {
    return this.socket.timeout(3000).emitWithAck('weapon.select', { ...this.envelope(this.seq++), weapon });
  }

  answer(encounterId: string, optionId: string): Promise<CommandAck> {
    return this.socket.timeout(3000).emitWithAck('question.answer', { ...this.envelope(this.seq++), encounterId, optionId });
  }

  close(): void {
    this.setupListeners.clear();
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private envelope(seq: number) {
    return { v: PROTOCOL_VERSION, matchId: this.current!.matchId, msgId: crypto.randomUUID(), seq };
  }

  private isCurrent(message: { matchId: string }): boolean {
    return message.matchId === this.current?.matchId;
  }

  private handleSetup(message: MatchSetupMessage): void {
    if (!this.current) return;
    const newMatch = message.matchId !== this.current.matchId;
    this.current = { ...this.current, matchId: message.matchId, setup: message.setup };
    if (newMatch) {
      // Ticks restart with the new match, and inputs sent to the old one will never be acknowledged.
      this.snapshots.clear();
      this.inputSentAt.clear();
    }
    this.publishSetup(newMatch ? 'new-match' : 'updated', message.changes);
  }

  private publishSetup(change: SetupChange, changes: SettingChange[]): void {
    for (const listener of this.setupListeners) listener(this.current!, change, changes);
  }

  private handleSnapshot(snapshot: StateSnapshot): void {
    this.snapshots.push(snapshot);
    this.clock.observe(snapshot.serverTime, Date.now());
    this.onSnapshotSize?.(JSON.stringify(snapshot).length);

    const me = snapshot.players.find((p) => p.id === this.current!.playerId);
    if (!me) return;
    const sentAt = this.inputSentAt.get(me.lastInputSeq);
    if (sentAt !== undefined) this.onRttSample?.(performance.now() - sentAt);
    for (const seq of this.inputSentAt.keys()) if (seq <= me.lastInputSeq) this.inputSentAt.delete(seq);
  }
}
