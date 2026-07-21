export type ClassifiedUrl =
  | { kind: "https"; href: string }
  | { kind: "loopback-http"; href: string }
  | { kind: "internal-route"; route: string }
  | { kind: "rejected"; reason: string };

export function classifyUrl(raw: string, authority: string): ClassifiedUrl {
  if (raw.startsWith("/") && !raw.startsWith("//")) return { kind: "internal-route", route: raw };
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return { kind: "rejected", reason: "parse-error" }; }
  if (parsed.protocol === "https:" && !parsed.username && !parsed.password) return { kind: "https", href: parsed.toString() };
  if (parsed.protocol === "http:" && parsed.toString().startsWith(`${authority}/`)) return { kind: "loopback-http", href: parsed.toString() };
  return { kind: "rejected", reason: "scheme-or-host" };
}
