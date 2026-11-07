import type { IncomingHttpHeaders } from "node:http";

/** Cabeçalhos do Node no formato `Headers` da API fetch, que o Better Auth espera. */
export function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    headers.append(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}
