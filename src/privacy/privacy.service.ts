import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { User } from 'src/users/entities/user.entity';
import { Role } from 'src/common/enums/roles.enum';
import { checkPassword } from 'src/common/utils/crypto.util';
import { DeleteOwnAccountDto, PrivacyPreferencesDto } from './privacy.dto';
import { isEmail } from 'class-validator';

export const PRIVACY_NOTICE_VERSION = '2026-10-23';
type PrivacyRow = {
  notice_version: string | null;
  accepted_at: Date | string | null;
  optional_communications: boolean;
  optional_analytics: boolean;
};

@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  notice() {
    const supportEmail =
      this.config
        .get<string>('PRIVACY_SUPPORT_EMAIL', '20230009@uthh.edu.mx')
        .trim() || null;
    const controller =
      this.config
        .get<string>('PRIVACY_CONTROLLER', 'Jesús David Saldaña Hernández')
        .trim() || null;
    return {
      version: PRIVACY_NOTICE_VERSION,
      ready: Boolean(supportEmail && isEmail(supportEmail) && controller),
      controller,
      supportEmail,
      title: 'Privacidad de tu cuenta Econolab',
      purposes: [
        'Identificar tu cuenta y permitir el acceso según tu rol.',
        'Consultar estudios y operar los módulos autorizados del laboratorio.',
        'Proteger la cuenta mediante registros de acceso y revocación de sesiones.',
      ],
      accountData: [
        'Nombre',
        'Correo electrónico',
        'Contraseña protegida mediante hash',
        'Rol y sesiones de acceso',
      ],
      optionalPurposes:
        'Las comunicaciones opcionales y la analítica opcional están desactivadas por defecto. Esta versión no envía campañas ni integra analítica opcional.',
      cancellation:
        'Puedes cancelar tu cuenta de acceso desde Privacidad confirmando tu contraseña. Se eliminan la cuenta, sus sesiones, preferencias y registros de acceso asociados. Esta acción no elimina los expedientes clínicos ni sustituye una solicitud sobre datos de pacientes al laboratorio.',
      retention:
        'Los datos de la cuenta se conservan mientras exista. La conservación y atención de solicitudes sobre expedientes clínicos corresponde al laboratorio y debe informarse en su aviso específico.',
    };
  }

  async getPreferences(userId: string) {
    const [row] = await this.db.query<PrivacyRow[]>(
      'SELECT * FROM account_privacy WHERE user_id = $1',
      [userId],
    );
    return this.present(row);
  }

  private present(row?: PrivacyRow) {
    return {
      noticeVersion: row?.notice_version ?? null,
      acceptedAt: row?.accepted_at
        ? new Date(row.accepted_at).toISOString()
        : null,
      optionalCommunications: row?.optional_communications ?? false,
      optionalAnalytics: row?.optional_analytics ?? false,
      currentNoticeVersion: PRIVACY_NOTICE_VERSION,
    };
  }

  updatePreferences(userId: string, dto: PrivacyPreferencesDto) {
    if (
      dto.consent === true &&
      (!this.notice().ready || dto.noticeVersion !== PRIVACY_NOTICE_VERSION)
    ) {
      throw new BadRequestException(
        'El aviso no está listo o cambió de versión. Consulta el aviso vigente.',
      );
    }
    if (dto.consent === false)
      throw new BadRequestException(
        'Para retirar el consentimiento necesario puedes solicitar la cancelación de tu cuenta. Las finalidades opcionales se pueden desactivar por separado.',
      );
    return this.db.transaction(async (manager) => {
      await manager.query(
        'INSERT INTO account_privacy (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [userId],
      );
      const [row] = await manager.query<PrivacyRow[]>(
        'SELECT * FROM account_privacy WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const accepted =
        dto.consent === true ||
        (row.notice_version === PRIVACY_NOTICE_VERSION && row.accepted_at);
      if (
        (dto.optionalCommunications === true ||
          dto.optionalAnalytics === true) &&
        !accepted
      ) {
        throw new BadRequestException(
          'Primero revisa y acepta el aviso vigente para activar finalidades opcionales.',
        );
      }
      await manager.query(
        `UPDATE account_privacy SET
        notice_version = $2, accepted_at = $3, optional_communications = $4,
        optional_analytics = $5, updated_at = NOW() WHERE user_id = $1 RETURNING *`,
        [
          userId,
          dto.consent === true ? PRIVACY_NOTICE_VERSION : row.notice_version,
          dto.consent === true ? new Date() : row.accepted_at,
          dto.optionalCommunications ?? row.optional_communications,
          dto.optionalAnalytics ?? row.optional_analytics,
        ],
      );
      const [updated] = await manager.query<PrivacyRow[]>(
        'SELECT * FROM account_privacy WHERE user_id = $1',
        [userId],
      );
      return this.present(updated);
    });
  }

  async deleteAccount(userId: string, dto: DeleteOwnAccountDto) {
    await this.db.transaction(async (manager) => {
      // Serialize last-admin checks; never allow deletion to strand the installation.
      await manager.query('SELECT pg_advisory_xact_lock(7732502)');
      const repo = manager.getRepository(User);
      const user = await repo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('La cuenta ya no existe.');
      if (!(await checkPassword(dto.currentPassword, user.password)))
        throw new UnauthorizedException('No se pudo confirmar la contraseña.');
      if (
        user.rol === Role.Admin &&
        (await repo.countBy({ rol: Role.Admin, confirmed: true })) <= 1
      ) {
        throw new ConflictException(
          'Antes de cancelar esta cuenta, otro administrador debe quedar a cargo del sistema.',
        );
      }
      await manager.query(
        'DELETE FROM user_login_logs WHERE user_id = $1 OR "emailIntent" = $2',
        [user.id, user.email],
      );
      // Sessions, refresh hashes and preferences cascade. Clinical tables have no account FK.
      await repo.remove(user);
    });
    return {
      deleted: true,
      message:
        'Tu cuenta de acceso fue cancelada. Los expedientes clínicos del laboratorio no se modificaron.',
    };
  }
}
