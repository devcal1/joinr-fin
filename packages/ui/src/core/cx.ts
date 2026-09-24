export type ClassValue = string | false | null | undefined;

/** Joins the truthy class names with single spaces. */
export function cx(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(' ');
}
