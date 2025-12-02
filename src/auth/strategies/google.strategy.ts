import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy as any, 'google') {
    constructor(
        private readonly cfg: ConfigService,
        private readonly usersService: UsersService,
    ) {
        super({
            clientID: cfg.get<string>('GOOGLE_CLIENT_ID'),
            clientSecret: cfg.get<string>('GOOGLE_CLIENT_SECRET'),
            callbackURL: cfg.get<string>('GOOGLE_CALLBACK_URL'),
            scope: ['email', 'profile'],
            state: false,
        } as any);
    }

    async validate(
        accessToken: string,
        refreshToken: string,
        profile: Profile,
    ) {
        const email = profile.emails?.[0]?.value;
        const nombre = profile.displayName;

        if (!email) {
            throw new UnauthorizedException(
                'No se pudo obtener el email desde Google',
            );
        }

        // Solo permitimos login con Google si el correo YA está registrado y confirmado
        const user = await this.usersService.findByEmail(email);

        if (!user || !user.confirmed) {
            throw new UnauthorizedException(
                'Cuenta no registrada o no confirmada para acceso con Google',
            );
        }

        // Passport pondrá este user en req.user
        return user;
    }
}
