import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthResponseDto, LoginDto, RegisterDto } from '../dto/auth.dto';
import { AuthService } from '../services/auth.service';
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  @Post('register') register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.service.register(dto);
  }
  @Post('login') login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.service.login(dto);
  }
}
