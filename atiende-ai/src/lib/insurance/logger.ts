// ═══════════════════════════════════════════════════════════
// MODULO DE SEGUROS AGENTICO — Structured Logger
// Consistent structured logging for insurance module
// ═══════════════════════════════════════════════════════════

/**
 * Log a structured insurance event.
 */
export function logInsuranceEvent(
  event: string,
  data: Record<string, unknown>
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      module: 'insurance',
      event,
      ...data,
    })
  )
}

/**
 * Log a structured insurance error with context.
 */
export function logInsuranceError(
  error: unknown,
  context: Record<string, unknown>
): void {
  const errorInfo: Record<string, unknown> = {}

  if (error instanceof Error) {
    errorInfo.error_name = error.name
    errorInfo.error_message = error.message
    errorInfo.error_stack = error.stack
  } else if (typeof error === 'string') {
    errorInfo.error_message = error
  } else {
    errorInfo.error_message = String(error)
  }

  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      module: 'insurance',
      level: 'error',
      ...errorInfo,
      ...context,
    })
  )
}
