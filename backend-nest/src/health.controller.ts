import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './common/decorators/public.decorator';
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}
  @Get() async health() {
    if (!this.dataSource.isInitialized) throw new ServiceUnavailableException();
    await this.dataSource.query('SELECT 1');
    return { status: 'healthy' };
  }
}
