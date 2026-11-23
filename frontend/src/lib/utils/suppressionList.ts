/**
 * Parses an uploaded suppression list (CSV, TSV or plain text, one per line). Picks the
 * domain/email column by header name when there is one, else the first cell that looks
 * like a domain or email. An optional "reason" column is used when it holds a known reason.
 */
export type ParsedSuppressionRow = { addressOrDomain: string; reason: string | null };

const VALUE_HEADERS = ["domain", "email", "e-mail", "email address", "website", "url", "address", "value", "company domain", "domain or email"];

function splitRow(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function looksLikeDomainOrEmail(v: string): boolean {
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  if (s.includes("@")) return /^[^\s@]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s);
}

export function parseSuppressionList(text: string, reasons: string[]): ParsedSuppressionRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0]!;
  const sep = first.includes("\t") ? "\t" : first.includes(";") && !first.includes(",") ? ";" : ",";
  const header = splitRow(first, sep).map((h) => h.toLowerCase().replace(/["']/g, "").trim());
  const valueCol = header.findIndex((h) => VALUE_HEADERS.includes(h));
  const reasonCol = header.findIndex((h) => h === "reason");
  const hasHeader = valueCol >= 0 || (reasonCol >= 0 && !header.some(looksLikeDomainOrEmail));
  const known = new Set(reasons);

  const out: ParsedSuppressionRow[] = [];
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = splitRow(line, sep);
    const value = valueCol >= 0 ? cells[valueCol] : (cells.find(looksLikeDomainOrEmail) ?? cells[0]);
    if (!value?.trim()) continue;
    const rawReason = reasonCol >= 0 ? cells[reasonCol]?.toLowerCase().trim().replace(/[\s-]+/g, "_") : undefined;
    out.push({ addressOrDomain: value.trim(), reason: rawReason && known.has(rawReason) ? rawReason : null });
  }
  return out;
}
