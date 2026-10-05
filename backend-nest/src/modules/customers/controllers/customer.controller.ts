import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { Tenant } from '../../../common/decorators/tenant.decorator';
import { TenantContext } from '../../../common/interfaces/tenant-context.interface';
import { MarginService } from '../../margin/services/margin.service';
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  UpdateCustomerGuardrailsDto,
} from '../dto/customer.dto';
import { CustomerService } from '../services/customer.service';
@Controller('customers')
export class CustomerController {
  constructor(
    private readonly service: CustomerService,
    private readonly margins: MarginService,
  ) {}
  @Get() list(@Tenant() t: TenantContext) {
    return this.service.list(t.organizationId);
  }
  @Post() create(@Tenant() t: TenantContext, @Body() dto: CreateCustomerDto) {
    return this.service.create(t.organizationId, dto);
  }
  @Get(':id') get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.get(t.organizationId, id);
  }
  @Put(':id') update(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.service.update(t.organizationId, id, dto);
  }
  @Get(':id/margin') margin(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.margins.get(t.organizationId, id);
  }
  @Put(':id/guardrails') guardrails(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerGuardrailsDto,
  ) {
    return this.service.updateGuardrails(t.organizationId, id, dto);
  }
}
