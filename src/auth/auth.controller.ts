import {Body, Controller, Get, Post, Req, UseGuards, UsePipes, ValidationPipe,} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { VerifyMfaDto } from './entities/verify-mfa.dto';

@UsePipes(new ValidationPipe({ transform: true }))
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) { }

  /* ───────── Login con usuario/contraseña ───────── */
  @Post('login')
  login(@Req() req, @Body() dto: LoginDto) {
    const ua = (req.headers['user-agent'] as string) || undefined;
    const ip = (req.ip as string) || undefined;
    return this.auth.login(dto, ip, ua);
  }

  /* ───────── Verificación MFA para admins ───────── */
  @Post('mfa/verify')
  verifyMfa(@Req() req, @Body() dto: VerifyMfaDto) {
    const ua = (req.headers['user-agent'] as string) || undefined;
    const ip = (req.ip as string) || undefined;
    return this.auth.verifyMfa(dto, ip, ua);
  }

  /* ───────── OAuth2 con Google ───────── */

  // Inicia el flujo: redirige a Google para autenticación
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleLogin() {
    // Passport se encarga de la redirección a Google
  }

  // Callback de Google después de autenticarse
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(@Req() req) {
    const ua = (req.headers['user-agent'] as string) || undefined;
    const ip = (req.ip as string) || undefined;

    // req.user viene del validate() de GoogleStrategy (es un User)
    return this.auth.loginWithOAuthUser(req.user, ip, ua);
  }

  /* ───────── Logout ───────── */

  // Cierra sólo la sesión actual (token actual)
  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@Req() req) {
    await this.auth.logout(req.user.jti);
    return { message: 'Sesión cerrada' };
  }

  // Cierra todas las sesiones del usuario
  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  async logoutAll(@Req() req) {
    await this.auth.logoutAll(req.user.id);
    return { message: 'Todas las sesiones fueron cerradas' };
  }
}
