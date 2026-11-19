/**
 * The renderer already prints every log line to the console before handing it to pino
 * (see ts/util/logger/renderer_process_logging.ts), so on the web the pino logger is a no-op.
 */
const noop = () => undefined;

export function buildPinoLogger() {
  return { fatal: noop, error: noop, warn: noop, info: noop, debug: noop, trace: noop };
}
