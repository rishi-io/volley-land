import { Global, Module } from '@nestjs/common';
import { ADMIN_AUTH, ROOM_SETTINGS, loadAdminAuth, loadRoomSettings } from './server-config.js';

@Global()
@Module({
  providers: [
    { provide: ROOM_SETTINGS, useFactory: () => loadRoomSettings() },
    { provide: ADMIN_AUTH, useFactory: () => loadAdminAuth() },
  ],
  exports: [ROOM_SETTINGS, ADMIN_AUTH],
})
export class ServerConfigModule {}
