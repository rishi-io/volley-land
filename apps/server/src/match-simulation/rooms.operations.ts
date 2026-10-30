import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { type AnyOperation, type OperationProvider, Operations, defineOperation } from '../operations/operation.js';
import { RoomRegistry } from './room-registry.service.js';

/** Live room state for admins. Never players' answers, questions or encounter state. */
@Operations()
@Injectable()
export class RoomOperations implements OperationProvider {
  constructor(@Inject(RoomRegistry) private readonly rooms: RoomRegistry) {}

  readonly listRooms = defineOperation({
    name: 'list_rooms',
    title: 'List open rooms',
    description:
      'Rooms open now: room code, current match ID, world, simulation tick, and how many humans and bots are in it out of the maximum. ' +
      'A room opens when the first player joins and closes when the last human leaves, so an empty list means no one is playing.',
    input: z.object({}),
    access: 'read',
    run: () => this.rooms.describeRooms(),
  });

  operations(): AnyOperation[] {
    return [this.listRooms];
  }
}
