export function generateMfaCode(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString(); // 6 dígitos
}