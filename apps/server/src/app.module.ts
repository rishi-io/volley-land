import { Module } from '@nestjs/common';
import { ServerConfigModule } from './config/server-config.module.js';
import { ContentWorkflowModule } from './content-workflow/content-workflow.module.js';
import { GameGatewayModule } from './game-gateway/game-gateway.module.js';
import { HealthModule } from './health/health.module.js';
import { McpServerModule } from './mcp-server/mcp-server.module.js';
import { SettingsModule } from './settings/settings.module.js';

@Module({
  imports: [ServerConfigModule, HealthModule, SettingsModule, ContentWorkflowModule, GameGatewayModule, McpServerModule],
})
export class AppModule {}
