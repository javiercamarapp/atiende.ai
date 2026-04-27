type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const isProduction = process.env.NODE_ENV === 'production';

// Minimum level to output (debug < info < warn < error)
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || (isProduction ? 'info' : 'debug');

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function formatDev(entry: LogEntry): string {
  const ts = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
  const lvl = entry.level.toUpperCase().padEnd(5);
  const ctx = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  const err = entry.error ? `\n  ${entry.error.name}: ${entry.error.message}${entry.error.stack ? '\n  ' + entry.error.stack : ''}` : '';
  return `${ts} [${lvl}] ${entry.message}${ctx}${err}`;
}

/**
 * Auto-inyecta request_id (y conversationId/tenantId si existen) desde
 * el AsyncLocalStorage del módulo `tracing` ANTES de emitir. Si no hay
 * contexto activo (ej. cron sin runWithRequestContext), no se modifica
 * el entry. Lazy import para evitar import cycle si tracing.ts logueara.
 */
function injectTraceContext(entry: LogEntry): void {
  try {
    // Lazy require para evitar circular dep en cold start.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracing = require('./observability/tracing') as typeof import('./observability/tracing');
    const ctx = tracing.getRequestContext();
    if (!ctx) return;
    entry.context = {
      ...(entry.context || {}),
      request_id: ctx.requestId,
      ...(ctx.tenantId ? { tenant_id: ctx.tenantId } : {}),
      ...(ctx.conversationId ? { conversation_id: ctx.conversationId } : {}),
    };
  } catch {
    // Tracing module no disponible (test env, etc) — silent skip
  }
}

function emit(entry: LogEntry): void {
  injectTraceContext(entry);
  const output = isProduction ? JSON.stringify(entry) : formatDev(entry);

  switch (entry.level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

/**
 * Structured logger for useatiende.ai
 *
 * Production: JSON lines for log aggregation (Vercel, Datadog, etc.)
 * Development: human-readable colored output
 *
 * Pass request context (tenant_id, conversation_id) in the context object
 * so logs can be correlated across a single request.
 */
export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    emit({ timestamp: new Date().toISOString(), level: 'debug', message, context });
  },

  info(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    emit({ timestamp: new Date().toISOString(), level: 'info', message, context });
  },

  warn(message: string, context?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    emit({ timestamp: new Date().toISOString(), level: 'warn', message, context });
  },

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;
    emit({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      context,
      error: error
        ? { name: error.name, message: error.message, stack: error.stack }
        : undefined,
    });
  },

  /**
   * Create a child logger with preset context fields.
   * Useful for binding tenant_id / conversation_id once per request.
   */
  child(baseContext: Record<string, unknown>) {
    return {
      debug: (msg: string, ctx?: Record<string, unknown>) =>
        logger.debug(msg, { ...baseContext, ...ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) =>
        logger.info(msg, { ...baseContext, ...ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) =>
        logger.warn(msg, { ...baseContext, ...ctx }),
      error: (msg: string, err?: Error, ctx?: Record<string, unknown>) =>
        logger.error(msg, err, { ...baseContext, ...ctx }),
    };
  },
};
