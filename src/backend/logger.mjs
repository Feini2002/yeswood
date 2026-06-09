const SECRET_VALUE_PATTERN =
  /(["']?\b(access[_-]?token|token|appsecret|app[_-]?secret|authorization|sync[_-]?api[_-]?key|sync[_-]?key|x[_-]?sync[_-]?key|api[_-]?key|secret)\b["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,;'"{}]+(["']?)/gi;
const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/g;

export function redactSecrets(value) {
  const input = typeof value === 'string' ? value : JSON.stringify(value);
  return input
    .replace(SECRET_VALUE_PATTERN, (match, prefix, _key, suffix = '') => `${prefix}[REDACTED]${suffix}`)
    .replace(BEARER_PATTERN, '$1 [REDACTED]');
}

function write(level, message, meta) {
  const detail = meta === undefined ? '' : ` ${redactSecrets(meta)}`;
  const safeMessage = redactSecrets(message);
  console[level](`[${level.toUpperCase()}] ${safeMessage}${detail}`);
}

export const logger = {
  info(message, meta) {
    write('log', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  },
};
