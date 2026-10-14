import * as QRCode from 'qrcode';

export type PwaQrKind = 'study' | 'service';

export function buildPwaQrValue(kind: PwaQrKind, id: number): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('No se puede generar un QR sin un identificador válido.');
  }
  return `econolab:${kind}:${id}`;
}

export async function buildPwaQrBuffer(
  kind: PwaQrKind,
  id: number,
): Promise<Buffer> {
  // Same payload as the PWA reader; no URL configuration or clinical data needed.
  return QRCode.toBuffer(buildPwaQrValue(kind, id), {
    type: 'png',
    width: 360,
    margin: 4,
    errorCorrectionLevel: 'M',
  });
}
