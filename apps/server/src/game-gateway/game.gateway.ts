import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ClientEvent,
  type ClientToServerEvents,
  type CommandAck,
  GAME_SOCKET_PATH,
  type RoomJoinAck,
  type ServerToClientEvents,
} from '@volleyland/contracts';
import { Server, Socket } from 'socket.io';
import { allowedOrigins } from '../config/server-config.js';
import type { Match } from '../match-simulation/match.js';
import { RoomRegistry } from '../match-simulation/room-registry.service.js';
import { CommandGuard } from './command-guard.js';

interface Session {
  guard: CommandGuard;
  playerId: string | null;
  roomCode: string | null;
}

type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
type Emit = (event: string, payload: unknown) => boolean;

const roomChannel = (code: string) => `room:${code}`;

/**
 * Socket.IO gateway on /ws: the transport adapter, and nothing more. Phase 0: clients join the dev
 * room by code (no authentication). Every command is rate-limited, version-checked,
 * schema-validated, match-checked and sequence-checked before it reaches the simulation. Server
 * events (match.setup included) come from the RoomRegistry through the sink registered here, which
 * maps rooms to Socket.IO channels and players to sockets.
 */
@WebSocketGateway({ path: GAME_SOCKET_PATH, serveClient: false, cors: { origin: allowedOrigins() } })
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(GameGateway.name);
  private readonly sessions = new Map<string, Session>();
  private readonly socketByPlayer = new Map<string, string>();

  @WebSocketServer()
  server!: GameServer;

  constructor(private readonly rooms: RoomRegistry) {}

  afterInit(): void {
    this.rooms.useSinkFactory((roomCode) => ({
      toRoom: (event, payload) => {
        (this.server.to(roomChannel(roomCode)).emit as Emit)(event, payload);
      },
      toPlayer: (playerId, event, payload) => {
        const socketId = this.socketByPlayer.get(playerId);
        if (socketId) (this.server.to(socketId).emit as Emit)(event, payload);
      },
    }));
  }

  handleConnection(socket: Socket): void {
    this.sessions.set(socket.id, { guard: new CommandGuard(Date.now()), playerId: null, roomCode: null });
  }

  handleDisconnect(socket: Socket): void {
    const session = this.sessions.get(socket.id);
    this.sessions.delete(socket.id);
    if (session?.playerId && session.roomCode) {
      this.socketByPlayer.delete(session.playerId);
      this.rooms.leave(session.roomCode, session.playerId);
    }
  }

  @SubscribeMessage(ClientEvent.RoomJoin)
  join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): RoomJoinAck {
    const session = this.sessionOf(socket);
    const admitted = session.guard.admit(ClientEvent.RoomJoin, body, Date.now(), this.currentMatchId(session));
    if (!admitted.ok) return this.rejected(socket, ClientEvent.RoomJoin, admitted);

    const playerId = `p-${randomUUID().slice(0, 8)}`;
    const result = this.rooms.join(admitted.message.roomCode, playerId);
    if (!result.ok) return { ok: false, code: result.code, message: result.message };

    session.playerId = playerId;
    session.roomCode = admitted.message.roomCode;
    this.socketByPlayer.set(playerId, socket.id);
    void socket.join(roomChannel(admitted.message.roomCode));
    return { ok: true, playerId, matchId: result.matchId, serverTime: Date.now(), setup: result.setup };
  }

  @SubscribeMessage(ClientEvent.PlayerInput)
  input(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): CommandAck {
    const session = this.sessionOf(socket);
    const admitted = session.guard.admit(ClientEvent.PlayerInput, body, Date.now(), this.currentMatchId(session));
    if (!admitted.ok) return this.rejected(socket, ClientEvent.PlayerInput, admitted);
    const { seq, moveX, moveZ, yaw } = admitted.message;
    return this.matchOf(session).queueInput(session.playerId!, { seq, moveX, moveZ, yaw });
  }

  @SubscribeMessage(ClientEvent.ProjectileRequest)
  projectile(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): CommandAck {
    const session = this.sessionOf(socket);
    const admitted = session.guard.admit(ClientEvent.ProjectileRequest, body, Date.now(), this.currentMatchId(session));
    if (!admitted.ok) return this.rejected(socket, ClientEvent.ProjectileRequest, admitted);
    return this.matchOf(session).requestProjectile(session.playerId!, admitted.message.yaw, admitted.message.pitch);
  }

  @SubscribeMessage(ClientEvent.WeaponSelect)
  selectWeapon(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): CommandAck {
    const session = this.sessionOf(socket);
    const admitted = session.guard.admit(ClientEvent.WeaponSelect, body, Date.now(), this.currentMatchId(session));
    if (!admitted.ok) return this.rejected(socket, ClientEvent.WeaponSelect, admitted);
    return this.matchOf(session).selectWeapon(session.playerId!, admitted.message.weapon);
  }

  @SubscribeMessage(ClientEvent.QuestionAnswer)
  answer(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): CommandAck {
    const session = this.sessionOf(socket);
    const admitted = session.guard.admit(ClientEvent.QuestionAnswer, body, Date.now(), this.currentMatchId(session));
    if (!admitted.ok) return this.rejected(socket, ClientEvent.QuestionAnswer, admitted);
    return this.matchOf(session).submitAnswer(session.playerId!, admitted.message.encounterId, admitted.message.optionId);
  }

  private sessionOf(socket: Socket): Session {
    let session = this.sessions.get(socket.id);
    if (!session) {
      session = { guard: new CommandGuard(Date.now()), playerId: null, roomCode: null };
      this.sessions.set(socket.id, session);
    }
    return session;
  }

  /** The match the session's room is playing now; it changes when an admin change starts a new one. */
  private currentMatchId(session: Session): string | null {
    return session.roomCode ? (this.rooms.matchFor(session.roomCode)?.id ?? null) : null;
  }

  /** Only reachable after the guard admitted a non-join command, so the session has joined a room. */
  private matchOf(session: Session): Match {
    const match = this.rooms.matchFor(session.roomCode!);
    if (!match) throw new Error(`Room ${session.roomCode} has no match`);
    return match;
  }

  private rejected<T extends { ok: false }>(socket: Socket, event: string, rejection: T): T {
    this.logger.debug(`Rejected ${event} from ${socket.id}: ${JSON.stringify(rejection)}`);
    return rejection;
  }
}
