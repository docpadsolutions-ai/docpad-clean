/**
 * Initials / letters shown in avatars and name badges (derived from a person's name)
 * should always render in uppercase for consistency across the app.
 */
export function personInitialsDisplay(initials: string): string {
  return initials.toUpperCase();
}
