import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { PrivacyService } from './privacy.service';
import { createHash } from 'node:crypto';

const NOTICE_STYLE =
  'body{font:17px/1.65 system-ui,sans-serif;margin:0;background:#f8fafc;color:#182333}main{max-width:760px;margin:40px auto;padding:28px;background:white;border-radius:20px}h1,h2{line-height:1.2}a{color:#b91c1c}header{color:#b91c1c;font-weight:700}li{margin:10px 0}footer{font-size:14px;color:#475569}';
const NOTICE_CSP =
  "default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'; style-src 'sha256-" +
  createHash('sha256').update(NOTICE_STYLE).digest('base64') +
  "'";
import { DeleteOwnAccountDto, PrivacyPreferencesDto } from './privacy.dto';

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}
  @Get('notice')
  @Header('Cache-Control', 'no-store')
  notice() {
    return this.privacy.notice();
  }

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', NOTICE_CSP)
  @Header('Cross-Origin-Embedder-Policy', 'require-corp')
  @Header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  @Header('Cache-Control', 'no-store')
  page() {
    return this.publicPage(false);
  }

  @Get('account-deletion')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Content-Security-Policy', NOTICE_CSP)
  @Header('Cross-Origin-Embedder-Policy', 'require-corp')
  @Header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  @Header('Cache-Control', 'no-store')
  deletionPage() {
    return this.publicPage(true);
  }

  private publicPage(deletion: boolean) {
    const notice = this.privacy.notice();
    const escape = (value: string | null) =>
      (value ?? 'Pendiente de configurar').replace(
        /[&<>"']/g,
        (char) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[char]!,
      );
    const purposes = notice.purposes
      .map((p) => '<li>' + escape(p) + '</li>')
      .join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${deletion ? 'Cancelación de cuenta' : 'Privacidad'} · Econolab</title><style>${NOTICE_STYLE}</style></head><body><main><header>ECONOLAB MÓVIL</header><h1>${deletion ? 'Solicitar cancelación de cuenta' : escape(notice.title)}</h1><p>Versión del aviso: ${notice.version}</p><p>Responsable de atender solicitudes sobre la cuenta móvil: <strong>${escape(notice.controller)}</strong>.</p><p>Contacto: <a href="mailto:${escape(notice.supportEmail)}">${escape(notice.supportEmail)}</a>.</p><h2>Datos y finalidades</h2><p>${notice.accountData.map(escape).join(', ')}.</p><ul>${purposes}</ul><h2>Tus derechos y decisiones</h2><p>Consulta y rectifica tu nombre y correo en Mi perfil. En Privacidad puedes aceptar expresamente este aviso y desactivar las finalidades opcionales; sus controles comienzan desactivados.</p><p>${escape(notice.optionalPurposes)}</p><h2>Cancelar tu cuenta</h2><p>${escape(notice.cancellation)}</p><ol><li>En la app, abre Mi perfil → Privacidad y mis datos → Cancelar mi cuenta.</li><li>Lee el alcance y confirma con tu contraseña y la frase solicitada.</li><li>Si no puedes entrar, escribe al correo de contacto con el asunto «Cancelación de cuenta Econolab». Indica tu correo registrado y la solicitud; no envíes tu contraseña. El responsable verificará tu identidad por un medio adecuado antes de atenderla.</li></ol><h2>Conservación</h2><p>${escape(notice.retention)}</p><p>No se venden los datos de la cuenta. El servicio utiliza alojamiento cloud y almacenamiento seguro del dispositivo para operar el acceso.</p><footer>Este aviso se refiere a la cuenta de acceso de Econolab móvil. Para solicitudes relativas a pacientes o expedientes clínicos, contacta al laboratorio responsable de esos registros.</footer></main></body></html>`;
  }

  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  preferences(@Req() req: { user: { id: string } }) {
    return this.privacy.getPreferences(req.user.id);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  update(
    @Req() req: { user: { id: string } },
    @Body() dto: PrivacyPreferencesDto,
  ) {
    return this.privacy.updatePreferences(req.user.id, dto);
  }
}

@Controller('account')
@UseGuards(JwtAuthGuard)
export class OwnAccountController {
  constructor(private readonly privacy: PrivacyService) {}
  @Delete()
  delete(
    @Req() req: { user: { id: string } },
    @Body() dto: DeleteOwnAccountDto,
  ) {
    return this.privacy.deleteAccount(req.user.id, dto);
  }
}
