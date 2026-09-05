// Single place that decides which user columns may leave the server.
// Every route that echoes a user row back to a client must go through this
// (auth, /api/me, admin user management) so a newly added secret column
// can't leak because one handler forgot to destructure it away.
import type { User } from "@shared/schema";

const PRIVATE_USER_FIELDS = [
  "password",
  "emailVerificationToken",
  "companyEmailVerificationToken",
] as const;

export type PublicUser = Omit<User, (typeof PRIVATE_USER_FIELDS)[number]>;

export function toPublicUser<T extends Partial<User>>(user: T): Omit<T, (typeof PRIVATE_USER_FIELDS)[number]> {
  const copy: any = { ...user };
  for (const key of PRIVATE_USER_FIELDS) delete copy[key];
  return copy;
}
