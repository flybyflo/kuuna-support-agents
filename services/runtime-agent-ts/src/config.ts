export const DEFAULT_HOST = "::";
export const DEFAULT_PORT = 8100;

export function port(): number {
  const value = Number.parseInt(process.env.PORT ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PORT;
}

export function host(): string {
  return process.env.HOST?.trim() || DEFAULT_HOST;
}
