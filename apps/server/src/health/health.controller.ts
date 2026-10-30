import { Controller, Get } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
}

@Controller('health')
export class HealthController {
  @Get()
  health(): HealthStatus {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('live')
  live(): HealthStatus {
    return this.health();
  }

  @Get('ready')
  ready(): HealthStatus {
    return this.health();
  }
}
