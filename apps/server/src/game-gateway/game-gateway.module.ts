import { Module } from '@nestjs/common';
import { MatchSimulationModule } from '../match-simulation/match-simulation.module.js';
import { GameGateway } from './game.gateway.js';

@Module({
  imports: [MatchSimulationModule],
  providers: [GameGateway],
})
export class GameGatewayModule {}
