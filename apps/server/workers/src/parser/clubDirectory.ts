/**
 * Parser for the Swimming Canada "Find a Club" directory.
 *
 * The user-facing directory at https://findaclub.swimming.ca/ is a SPA
 * shell — the actual list of clubs is loaded by a JSONP request to
 *
 *   https://www.swimming.ca/club-list.php?preview=true&callback=load_clubs
 *
 * which returns
 *
 *   load_clubs([{ "name": "...", "address": "...", "website": "...",
 *                 "phone": "...", "lat": "...", "lng": "...",
 *                 "category": "...", "type": "..." }, ...])
 *
 * There is no SNC club code (e.g. "ON-CW") and no province field in the
 * payload, so this parser:
 *  - strips the JSONP wrapper and parses the JSON array;
 *  - synthesises a stable, slug-safe ID from the club name (suffixed with a
 *    short hash so similarly-named clubs don't collide);
 *  - derives a 2-letter province from the Canadian postal code embedded in
 *    the address when one is present, leaving `province` undefined otherwise.
 *
 * The parser also accepts a plain JSON array as input so callers can feed it
 * pre-unwrapped data in tests / future endpoints.
 */

export type ParsedClub = {
  /** Stable slug-safe identifier we synthesise from the club name. */
  id: string;
  name: string;
  shortName?: string;
  /** 2-letter Canadian province code. Omitted when we can't derive one. */
  province?: string;
  city?: string;
  /**
   * The club's public website (the JSONP feed's `website` field). We re-use
   * this slot for "rosterUrl" because Task 5's roster parser falls back to
   * `https://results.swimming.ca/clubs/<id>/` when the directory entry has
   * no explicit roster page.
   */
  rosterUrl?: string;
};

interface RawClub {
  readonly name?: unknown;
  readonly address?: unknown;
  readonly website?: unknown;
  readonly phone?: unknown;
  readonly lat?: unknown;
  readonly lng?: unknown;
  readonly category?: unknown;
  readonly type?: unknown;
}

const JSONP_RE = /^[^([]*\(\s*(\[[\s\S]*\])\s*\)\s*;?\s*$/;

// Canadian postal code: A1A 1A1 / A1A1A1. The first letter encodes the
// province (with a couple of multi-province exceptions handled below).
const POSTAL_RE = /\b([A-Z])(\d)([A-Z])\s?(\d)([A-Z])(\d)\b/;

const PROVINCE_BY_POSTAL_PREFIX: Record<string, string> = {
  A: 'NL',
  B: 'NS',
  C: 'PE',
  E: 'NB',
  G: 'QC',
  H: 'QC',
  J: 'QC',
  K: 'ON',
  L: 'ON',
  M: 'ON',
  N: 'ON',
  P: 'ON',
  R: 'MB',
  S: 'SK',
  T: 'AB',
  V: 'BC',
  // X is shared between NT and NU; without finer-grained signal we leave it
  // out so callers can decide (rather than guess).
  Y: 'YT',
};

export function parseClubDirectory(input: string): ParsedClub[] {
  if (!input || input.trim().length === 0) return [];

  const raw = extractRawClubs(input);
  if (raw.length === 0) return [];

  const clubs: ParsedClub[] = [];
  const usedIds = new Set<string>();

  for (const entry of raw) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!name) continue;

    const address = typeof entry.address === 'string' ? entry.address.trim() : '';
    const website = typeof entry.website === 'string' ? entry.website.trim() : '';

    const id = uniqueId(name, address, usedIds);
    usedIds.add(id);

    const province = provinceFromAddress(address);
    const rosterUrl = website && /^https?:\/\//i.test(website) ? website : undefined;

    clubs.push({
      id,
      name,
      ...(province ? { province } : {}),
      ...(rosterUrl ? { rosterUrl } : {}),
    });
  }

  return clubs;
}

// ---------------------------------------------------------------------------
// JSONP / JSON unwrapping
// ---------------------------------------------------------------------------

function extractRawClubs(input: string): RawClub[] {
  const trimmed = input.trim();

  // JSONP form: "load_clubs([...]);" — strip the wrapper and parse.
  const m = JSONP_RE.exec(trimmed);
  if (m) {
    return safeParseArray(m[1]!);
  }

  // Plain JSON array, in case a caller feeds us already-unwrapped data.
  if (trimmed.startsWith('[')) {
    return safeParseArray(trimmed);
  }

  // HTML form (the live findaclub.swimming.ca page) — search for the JSONP
  // payload embedded in a <script>. We accept either the `<script src=...>`
  // pointer (no inline data, returns []) or an inline `load_clubs([...])`
  // call. The site currently uses the external <script src>, in which case
  // we have nothing to parse and return [].
  const inlineMatch = /load_clubs\s*\(\s*(\[[\s\S]*?\])\s*\)/m.exec(trimmed);
  if (inlineMatch) {
    return safeParseArray(inlineMatch[1]!);
  }

  return [];
}

function safeParseArray(text: string): RawClub[] {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RawClub => typeof x === 'object' && x !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Province derivation
// ---------------------------------------------------------------------------

function provinceFromAddress(address: string): string | undefined {
  if (!address) return undefined;
  const upper = address.toUpperCase();
  const m = POSTAL_RE.exec(upper);
  if (!m) return undefined;
  const prefix = m[1]!;
  return PROVINCE_BY_POSTAL_PREFIX[prefix];
}

// ---------------------------------------------------------------------------
// Stable ID synthesis
// ---------------------------------------------------------------------------

function uniqueId(name: string, address: string, used: Set<string>): string {
  const base = slugify(name).toUpperCase();
  // Disambiguate identical-name entries by appending a short hash of the
  // (name + address) tuple. The hash is deterministic so re-parsing the same
  // fixture yields the same ID.
  const suffix = shortHash(`${name}|${address}`);
  let candidate = `${base}-${suffix}`;
  if (!used.has(candidate)) return candidate;

  // Extremely unlikely (would require both identical name+address AND
  // identical hash collision), but fall back to numeric disambiguation so
  // we keep the uniqueness invariant.
  let i = 2;
  while (used.has(`${candidate}-${i}`)) i++;
  return `${candidate}-${i}`;
}

function slugify(input: string): string {
  // Strip combining diacritics, then keep only [A-Z0-9-].
  const ascii = input.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return ascii
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toUpperCase();
}

/**
 * 5-character base36 hash (alphanumeric, uppercase) — short enough to keep
 * IDs readable, long enough that collisions are negligible across ~500 rows.
 *
 * Implementation note: we use a stable FNV-1a 32-bit hash so the output
 * doesn't depend on Node version / platform.
 */
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Force unsigned and base36, pad to 5 chars.
  const u = h >>> 0;
  return u.toString(36).toUpperCase().padStart(5, '0').slice(0, 5);
}
