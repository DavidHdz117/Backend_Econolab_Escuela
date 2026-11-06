export type CatalogItem = {
  id: number;
  name: string;
  description: string;
  priceCents: number;
  active: boolean;
};
export type Activity = {
  id: number;
  itemId: number;
  itemName: string;
  quantity: number;
  totalCents: number;
  date: string;
  cancelled: boolean;
};
export type Workspace = {
  catalog: CatalogItem[];
  activities: Activity[];
  nextItemId: number;
  nextActivityId: number;
  preferences: {
    noticeVersion: string | null;
    acceptedAt: string | null;
    optionalCommunications: boolean;
    optionalAnalytics: boolean;
  };
};
export const SCHOOL_NOTICE_VERSION = 'aula-2026-11-06.1';
export function initialWorkspace(): Workspace {
  return {
    catalog: [
      {
        id: 1,
        name: 'Impresión de documentos',
        description: 'Servicio de práctica para un centro escolar.',
        priceCents: 250,
        active: true,
      },
      {
        id: 2,
        name: 'Encuadernado',
        description: 'Ejemplo de organización de servicios.',
        priceCents: 3500,
        active: true,
      },
      {
        id: 3,
        name: 'Asesoría de informática',
        description: 'Actividad ficticia para ejercicios administrativos.',
        priceCents: 8000,
        active: true,
      },
    ],
    activities: [],
    nextItemId: 4,
    nextActivityId: 1,
    preferences: {
      noticeVersion: null,
      acceptedAt: null,
      optionalCommunications: false,
      optionalAnalytics: false,
    },
  };
}
export function validDate(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '2000-01-01' ||
    value > '2100-12-31'
  )
    return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function summarize(activities: Activity[], from: string, to: string) {
  const rows = activities.filter((row) => row.date >= from && row.date <= to);
  const included = rows.filter((row) => !row.cancelled);
  return {
    from,
    to,
    count: included.length,
    cancelledCount: rows.length - included.length,
    totalCents: included.reduce((sum, row) => sum + row.totalCents, 0),
    activities: rows,
  };
}
