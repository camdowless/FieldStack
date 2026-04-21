import * as admin from "firebase-admin";

/**
 * Pure role-checking logic for the "user" role tier.
 * Treats a missing `role` claim as "user" for backward compatibility (Req 1.2).
 * Throws FORBIDDEN for any unrecognized role value.
 */
export function checkUserRole(decoded: admin.auth.DecodedIdToken): void {
  const role = (decoded as admin.auth.DecodedIdToken & { role?: string }).role;
  // Treat missing role as "user" for backward compatibility (Req 1.2)
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
    console.warn(`[auth] FORBIDDEN uid=${uid} function=${functionName ?? "unknown"}`);
    throw new Error("FORBIDDEN");
  }
}
