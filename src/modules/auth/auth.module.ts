import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        type JwtExpiresIn = NonNullable<
          JwtModuleOptions['signOptions']
        >['expiresIn'];

        return {
          // JWT_ACCESS_SECRET es el nombre nuevo; se cae a JWT_SECRET para que
          // el despliegue no exija tocar variables en Render antes de subir.
          secret:
            configService.get<string>('JWT_ACCESS_SECRET') ??
            configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: (configService.get<string>('JWT_ACCESS_EXPIRES_IN') ??
              configService.get<string>('JWT_EXPIRES_IN') ??
              '15m') as JwtExpiresIn,
            issuer: configService.getOrThrow<string>('JWT_ISSUER'),
            audience: configService.getOrThrow<string>('JWT_AUDIENCE'),
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, RolesGuard],
})
export class AuthModule {}
