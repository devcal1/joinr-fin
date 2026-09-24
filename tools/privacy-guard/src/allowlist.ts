// Values the content rules may match but that are safe to publish (stage-0.md §8).
// Keep this list short and generic: documentation ranges, loopback and placeholder addresses.

/** Parses dotted IPv4 text into four octets (undefined if it is not IPv4). */
function octets(ip: string): [number, number, number, number] | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => Number.isNaN(n) || n > 255)) return undefined;
  return nums as [number, number, number, number];
}

/**
 * Allowed IPv4 addresses:
 * - `0.0.0.0` (listen on all interfaces), `255.255.255.255` (broadcast), `255.255.255.0` (netmask)
 * - `127.0.0.0/8` (loopback)
 * - RFC 5737 documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`
 *
 * Version numbers: a bare four-part version whose parts are all 0–255 reads as an address and is
 * flagged. Write it with a "v" prefix, or with a fifth part; the rule treats both as part of a word
 * or a longer number and leaves them alone. In docs and tests, use an address from the RFC 5737
 * ranges above.
 */
export function isAllowedIpv4(ip: string): boolean {
  const o = octets(ip);
  if (!o) return false;
  const [a, b, c, d] = o;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  if (a === 255 && b === 255 && c === 255 && (d === 255 || d === 0)) return true;
  if (a === 127) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  return false;
}

const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net'];
const ALLOWED_EMAILS = new Set(['noreply@anthropic.com', 'git@github.com']);

/**
 * Allowed email addresses:
 * - anything at `example.com`, `example.org`, `example.net` (or their subdomains)
 * - anything under the reserved `.example` TLD
 * - `noreply@anthropic.com` (commit trailers), `git@github.com` (SSH remotes)
 * - GitHub's private commit addresses `*@users.noreply.github.com`
 */
export function isAllowedEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.has(lower)) return true;
  const domain = lower.slice(lower.lastIndexOf('@') + 1);
  if (domain.endsWith('.example')) return true;
  if (domain === 'users.noreply.github.com') return true;
  return ALLOWED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** The placeholder mobile number `0400 000 000` (any spacing). */
export function isAllowedPhone(phone: string): boolean {
  return phone.replace(/\D/g, '') === '0400000000';
}

/** The placeholder ABN `00 000 000 000`. */
export function isAllowedAbn(abn: string): boolean {
  return /^0+$/.test(abn.replace(/\D/g, ''));
}
