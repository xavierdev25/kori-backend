import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { LoginDto } from './dto/login.dto';

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
}

interface AdminJwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const adminUsername = this.configService.get<string>('ADMIN_USERNAME');
    const passwordHash = this.configService.get<string>('ADMIN_PASSWORD_HASH');
    const expiresIn = this.configService.get<string>('JWT_EXPIRES_IN') ?? '2h';

    const isUsernameValid = dto.username === adminUsername;
    const isPasswordValid = passwordHash
      ? await bcrypt.compare(dto.password, passwordHash)
      : false;

    if (!isUsernameValid || !isPasswordValid) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const payload: AdminJwtPayload = {
      sub: adminUsername,
      username: adminUsername,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      expiresIn,
    };
  }
}
