import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ActivityDto, CatalogDto } from './school.dto';
import {
  initialWorkspace,
  SCHOOL_NOTICE_VERSION,
  summarize,
  validDate,
  Workspace,
} from './domain';
import { PrivacyPreferencesDto } from '../privacy/privacy.dto';

@Injectable()
export class SchoolService implements OnModuleInit {
  constructor(private readonly db: DataSource) {}
  async onModuleInit() {
    await this.db.query(
      'CREATE TABLE IF NOT EXISTS school_workspace (user_id INTEGER PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE, state JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
  }
  private async access<T>(
    userId: string,
    operation: (state: Workspace) => T,
    write = false,
  ): Promise<T> {
    return this.db.transaction(async (manager) => {
      await manager.query(
        'INSERT INTO school_workspace (user_id, state) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING',
        [userId, JSON.stringify(initialWorkspace())],
      );
      const [row] = await manager.query<{ state: Workspace }[]>(
        'SELECT state FROM school_workspace WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      const result = operation(row.state);
      if (write)
        await manager.query(
          'UPDATE school_workspace SET state = $2::jsonb, updated_at = NOW() WHERE user_id = $1',
          [userId, JSON.stringify(row.state)],
        );
      return result;
    });
  }
  workspace(userId: string) {
    return this.access(userId, (state) => ({
      catalog: state.catalog,
      activities: state.activities,
      demonstration: true,
    }));
  }
  addItem(userId: string, dto: CatalogDto) {
    if (dto.name.trim().length < 2)
      throw new BadRequestException(
        'Escribe un nombre de al menos dos caracteres.',
      );
    return this.access(
      userId,
      (state) => {
        if (state.catalog.length >= 100)
          throw new BadRequestException(
            'El espacio admite hasta 100 servicios.',
          );
        state.catalog.push({
          id: state.nextItemId++,
          name: dto.name.trim(),
          description: dto.description.trim(),
          priceCents: dto.priceCents,
          active: true,
        });
        return {
          catalog: state.catalog,
          activities: state.activities,
          demonstration: true,
        };
      },
      true,
    );
  }
  setActive(userId: string, itemId: number, active: boolean) {
    return this.access(
      userId,
      (state) => {
        const item = state.catalog.find((row) => row.id === itemId);
        if (!item) throw new NotFoundException('No encontramos el servicio.');
        item.active = active;
        return {
          catalog: state.catalog,
          activities: state.activities,
          demonstration: true,
        };
      },
      true,
    );
  }
  addActivity(userId: string, dto: ActivityDto) {
    if (!validDate(dto.date))
      throw new BadRequestException('Usa una fecha válida entre 2000 y 2100.');
    return this.access(
      userId,
      (state) => {
        const item = state.catalog.find(
          (row) => row.id === dto.itemId && row.active,
        );
        if (!item)
          throw new NotFoundException('El servicio no está disponible.');
        if (state.activities.length >= 500)
          throw new BadRequestException(
            'El espacio admite hasta 500 registros.',
          );
        state.activities.unshift({
          id: state.nextActivityId++,
          itemId: item.id,
          itemName: item.name,
          quantity: dto.quantity,
          totalCents: item.priceCents * dto.quantity,
          date: dto.date,
          cancelled: false,
        });
        return {
          catalog: state.catalog,
          activities: state.activities,
          demonstration: true,
        };
      },
      true,
    );
  }
  cancelActivity(userId: string, id: number) {
    return this.access(
      userId,
      (state) => {
        const row = state.activities.find((item) => item.id === id);
        if (!row) throw new NotFoundException('No encontramos el registro.');
        row.cancelled = true;
        return {
          catalog: state.catalog,
          activities: state.activities,
          demonstration: true,
        };
      },
      true,
    );
  }
  cut(userId: string, from: string, to: string) {
    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to ||
      Date.parse(to) - Date.parse(from) > 365 * 86400000
    )
      throw new BadRequestException('Revisa el periodo: máximo 366 días.');
    return this.access(userId, (state) =>
      summarize(state.activities, from, to),
    );
  }
  preferences(userId: string) {
    return this.access(userId, (state) => ({
      ...state.preferences,
      currentNoticeVersion: SCHOOL_NOTICE_VERSION,
    }));
  }
  updatePreferences(userId: string, dto: PrivacyPreferencesDto) {
    if (
      dto.consent === false ||
      (dto.consent === true && dto.noticeVersion !== SCHOOL_NOTICE_VERSION)
    )
      throw new BadRequestException(
        'Revisa y acepta el aviso vigente para continuar.',
      );
    return this.access(
      userId,
      (state) => {
        if (dto.consent === true) {
          state.preferences.noticeVersion = SCHOOL_NOTICE_VERSION;
          state.preferences.acceptedAt = new Date().toISOString();
        }
        if (
          (dto.optionalAnalytics || dto.optionalCommunications) &&
          !state.preferences.acceptedAt
        )
          throw new BadRequestException('Primero acepta el aviso vigente.');
        state.preferences.optionalCommunications =
          dto.optionalCommunications ??
          state.preferences.optionalCommunications;
        state.preferences.optionalAnalytics =
          dto.optionalAnalytics ?? state.preferences.optionalAnalytics;
        return {
          ...state.preferences,
          currentNoticeVersion: SCHOOL_NOTICE_VERSION,
        };
      },
      true,
    );
  }
  reset(userId: string) {
    return this.access(
      userId,
      (state) => {
        const clean = initialWorkspace();
        Object.assign(state, clean, { preferences: state.preferences });
        return {
          catalog: state.catalog,
          activities: state.activities,
          demonstration: true,
        };
      },
      true,
    );
  }
}
