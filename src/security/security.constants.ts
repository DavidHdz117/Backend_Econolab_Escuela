export const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const CSRF_EXCLUDED_ROUTES = [
  /^\/api\/auth\/login$/i,
  /^\/api\/auth\/mfa\/verify$/i,
  /^\/api\/auth\/google(?:\/callback)?$/i,
  /^\/api\/users\/register$/i,
  /^\/api\/users\/confirm-account$/i,
  /^\/api\/users\/forgot-password$/i,
  /^\/api\/users\/validate-reset-token$/i,
  /^\/api\/users\/reset-password\/[^/]+$/i,
];

export const SENSITIVE_FIELD_PATTERN =
  /pass(word)?|token|secret|cookie|authorization|code|csrf|key/i;

export const SUSPICIOUS_PAYLOAD_PATTERNS = [
  {
    kind: 'xss',
    regex:
      /<script\b|<\/script>|javascript:|onerror\s*=|onload\s*=|<iframe\b|<img\b/i,
  },
  {
    kind: 'sql_injection',
    regex:
      /union\s+select|select\s+.+\s+from|drop\s+table|truncate\s+table|delete\s+from|insert\s+into|update\s+.+\s+set|'[\s)]*(or|and)\s+['"]?[\w\d]+['"]?\s*=\s*['"]?[\w\d]+|--/i,
  },
];
