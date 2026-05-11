import * as admin from "firebase-admin";
import { logger } from "./logger";

/**
 * Pure role-checking logic for the "user" role tier.
 * Treats a missing `role` claim as "user" for backward compatibility (Req 1.2).
 *
 * Security note: this means a newly-created user can call user-tier functions
 * before onUserCreate fires and sets the claim. This is intentional — the window
 * is a few seconds at most, the user is still authenticated (valid JWT), and all
 * other guards (rate limiting, input validation) apply normally. The missing claim
 * cannot be used to escalate to "admin" — checkAdminRole requires an explicit claim.
 *
 * Throws FORBIDDEN for any unrecognized role value.
 */
export function checkUserRole(decoded: admin.auth.DecodedIdToken): void {
  const role = (decoded as admin.auth.DecodedIdToken & { role?: string }).role;
  const effectiveRole = role ?? "user";
  if (effectiveRole !== "user" && effectiveRole !== "admin") {
    throw new Error("FORBIDDEN");
  }
}

/**
 * Pure role-checking logic for the "admin" role tier.
 * Throws FORBIDDEN if role !== "admin".
 */
export function checkAdminRole(decoded: admin.auth.DecodedIdToken, uid: string, functionName?: string): void {
  const role = (decoded as admin.auth.DecodedIdToken & { role?: string }).role;
  if (role !== "admin") {
    logger.warn("FORBIDDEN", { uid, function_name: functionName ?? "unknown" });
    throw new Error("FORBIDDEN");
  }
}
