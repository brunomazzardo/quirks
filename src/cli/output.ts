export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function emitJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Reads render a table on a TTY; JSON when piped or asked for. Writes never call
 *  this — their consumer is a skill that wants the object back. */
export function emitRead(data: unknown, json: boolean, render: () => string): void {
  if (json || !process.stdout.isTTY) emitJson(data);
  else console.log(render());
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(headers), ...rows.map(line)].join("\n");
}
