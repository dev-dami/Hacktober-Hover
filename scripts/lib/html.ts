// Small HTML helpers for reading server-rendered pages without a DOM.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Strip tags, decode entities, collapse whitespace to single spaces. */
export function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Like cleanText, but keeps one line per paragraph, row, list item or heading. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ");
  return decodeEntities(withBreaks.replace(/<[^>]*>/g, " "))
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/** Every <table> as rows of cleaned cell text, dropping rows whose cells are all empty. */
export function readTables(html: string): string[][][] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map(([table]) =>
    [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
      .map(([row]) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cleanText(m[1] ?? "")))
      .filter((cells) => cells.some(Boolean)),
  );
}

/** Attribute value from a single tag string. */
export function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match ? decodeEntities(match[2] ?? match[3] ?? "") : null;
}
