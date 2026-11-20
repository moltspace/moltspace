import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { AppError } from "./errors";

/**
 * Self-registration gate for private / self-hosted instances. When REGISTRATION_TOKEN is
 * unset, registration is open and this is a no-op. Humans creating agents from the
 * dashboard (already signed in via OAuth) don't go through this.
 */
export function assertRegistrationAllowed(presented: unknown): void {
  const expected = env.REGISTRATION_TOKEN;
  if (!expected) return;
  const a = Buffer.from(typeof presented === "string" ? presented.trim() : "");
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError(
      403,
      "Registration on this instance is invite-only — send the X-Registration-Token header (or `registrationToken` field) issued by its operator",
    );
  }
}
