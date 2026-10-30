import type { CommandAck, RoomJoinAck } from './acks.js';
import type { PlayerInput, ProjectileRequest, QuestionAnswer, RoomJoin, WeaponSelect } from './client-messages.js';
import type {
  BotWindup,
  HealthChanged,
  HitConfirmed,
  MatchSetupMessage,
  PlayerRespawned,
  ProjectileSpawned,
  QuestionPresented,
  QuestionResolved,
  StateSnapshot,
} from './server-messages.js';

/** Socket.IO typing for both ends of the /ws connection. */
export interface ClientToServerEvents {
  'room.join': (message: RoomJoin, ack: (reply: RoomJoinAck) => void) => void;
  'player.input': (message: PlayerInput, ack?: (reply: CommandAck) => void) => void;
  'projectile.request': (message: ProjectileRequest, ack?: (reply: CommandAck) => void) => void;
  'weapon.select': (message: WeaponSelect, ack?: (reply: CommandAck) => void) => void;
  'question.answer': (message: QuestionAnswer, ack?: (reply: CommandAck) => void) => void;
}

export interface ServerToClientEvents {
  'state.snapshot': (message: StateSnapshot) => void;
  'projectile.spawned': (message: ProjectileSpawned) => void;
  'hit.confirmed': (message: HitConfirmed) => void;
  'question.presented': (message: QuestionPresented) => void;
  'question.resolved': (message: QuestionResolved) => void;
  'health.changed': (message: HealthChanged) => void;
  'player.respawned': (message: PlayerRespawned) => void;
  'match.setup': (message: MatchSetupMessage) => void;
  'bot.windup': (message: BotWindup) => void;
}

/** Socket.IO path for the game gateway; the reverse proxy routes it to the server. */
export const GAME_SOCKET_PATH = '/ws';
