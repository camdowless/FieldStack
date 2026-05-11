import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type * as adminTypes from "firebase-admin";
import { checkUserRole, checkAdminRole } from "./authHelpers";

// Feature: user-roles-authorization, Property 1: missing role claim treated as user role

/**
 * Property 1: Missing role claim treated as user role
 * Validates: Requirements 1.2
 *
 * For any valid token payload that contains no `role` Custom Claim,
 * `verifyUserRole` (via `checkUserRole`) SHALL treat the request as having
 * the "user" role and SHALL NOT throw.
 */
describe("Property 1: Missing role claim treated as user role", () => {
  // ── Generator: arbitrary token payload without a `role` field ───────────────

  /**
   * Generates a DecodedIdToken-shaped object with no `role` field.
   * Covers a wide range of realistic token payloads (varying uid, email, etc.)
   * while ensuring `role` is always absent.
   */
  const tokenWithoutRoleArb = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 40 }),
    iss: fc.constant("https://securetoken.google.com/test-project"),
    aud: fc.constant("test-project"),
    sub: fc.string({ minLength: 1, maxLength: 40 }),
    iat: fc.integer({ min: 0, max: 2_000_000_000 }),
    exp: fc.integer({ min: 0, max: 2_000_000_000 }),
    auth_time: fc.integer({ min: 0, max: 2_000_000_000 }),
    firebase: fc.record({
      identities: fc.constant({}),
      sign_in_provider: fc.constantFrom("password", "google.com", "anonymous"),
    }),
  }) as fc.Arbitrary<adminTypes.auth.DecodedIdToken>;

  // ── Property: checkUserRole does not throw for tokens with no role field ────

  it("does not throw for any token payload with no role field", () => {
    fc.assert(
      fc.property(tokenWithoutRoleArb, (decoded) => {
        // Ensure `role` is truly absent (not just undefined)
        expect("role" in decoded).toBe(false);

        // SHALL NOT throw — missing role is treated as "user"
        expect(() => checkUserRole(decoded)).not.toThrow();
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: checkUserRole does not throw when role is explicitly undefined ─

  it("does not throw when role is explicitly undefined", () => {
    fc.assert(
      fc.property(tokenWithoutRoleArb, (decoded) => {
        const tokenWithUndefinedRole = { ...decoded, role: undefined } as adminTypes.auth.DecodedIdToken & { role?: string };

        // SHALL NOT throw — undefined role is treated as "user"
        expect(() => checkUserRole(tokenWithUndefinedRole)).not.toThrow();
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: user-roles-authorization, Property 2: invalid role values are rejected

/**
 * Property 2: Invalid role values are rejected
 * Validates: Requirements 3.2
 *
 * For any ID token whose `role` claim is a string other than "user" or "admin",
 * `checkUserRole` SHALL throw an error with message "FORBIDDEN".
 */
describe("Property 2: Invalid role values are rejected", () => {
  // ── Generator: arbitrary strings that are neither "user" nor "admin" ────────

  const invalidRoleArb = fc
    .string()
    .filter((s) => s !== "user" && s !== "admin");

  // ── Property: checkUserRole throws FORBIDDEN for any unrecognized role ───────

  it("throws FORBIDDEN for any role value that is not 'user' or 'admin'", () => {
    fc.assert(
      fc.property(invalidRoleArb, (invalidRole) => {
        const decoded = {
          uid: "test-uid",
          iss: "https://securetoken.google.com/test-project",
          aud: "test-project",
          sub: "test-uid",
          iat: 0,
          exp: 9999999999,
          auth_time: 0,
          firebase: { identities: {}, sign_in_provider: "password" },
          role: invalidRole,
        } as unknown as import("firebase-admin").auth.DecodedIdToken & { role: string };

        expect(() => checkUserRole(decoded)).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: user-roles-authorization, Property 3: admin endpoint rejects non-admin callers

/**
 * Property 3: Admin endpoint rejects non-admin callers
 * Validates: Requirements 4.1, 5.1
 *
 * For any valid ID token with role: "user", no role, or any other non-"admin"
 * string, `checkAdminRole` SHALL throw an error with message "FORBIDDEN".
 */
describe("Property 3: Admin endpoint rejects non-admin callers", () => {
  // ── Base token factory ───────────────────────────────────────────────────────

  const baseTokenArb = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 40 }),
    iss: fc.constant("https://securetoken.google.com/test-project"),
    aud: fc.constant("test-project"),
    sub: fc.string({ minLength: 1, maxLength: 40 }),
    iat: fc.integer({ min: 0, max: 2_000_000_000 }),
    exp: fc.integer({ min: 0, max: 2_000_000_000 }),
    auth_time: fc.integer({ min: 0, max: 2_000_000_000 }),
    firebase: fc.record({
      identities: fc.constant({}),
      sign_in_provider: fc.constantFrom("password", "google.com", "anonymous"),
    }),
  });

  // ── Generator: tokens with role: "user" ─────────────────────────────────────

  const userRoleTokenArb = baseTokenArb.map((t) => ({
    ...t,
    role: "user" as const,
  })) as fc.Arbitrary<adminTypes.auth.DecodedIdToken & { role: string }>;

  // ── Generator: tokens with no role field ────────────────────────────────────

  const noRoleTokenArb = baseTokenArb as fc.Arbitrary<adminTypes.auth.DecodedIdToken>;

  // ── Generator: tokens with any non-"admin" string role ──────────────────────

  const nonAdminRoleTokenArb = fc
    .tuple(
      baseTokenArb,
      fc.string().filter((s) => s !== "admin")
    )
    .map(([t, role]) => ({ ...t, role })) as fc.Arbitrary<
    adminTypes.auth.DecodedIdToken & { role: string }
  >;

  // ── Property: checkAdminRole throws FORBIDDEN for role: "user" ──────────────

  it("throws FORBIDDEN for any token with role: 'user'", () => {
    fc.assert(
      fc.property(userRoleTokenArb, (decoded) => {
        expect(() =>
          checkAdminRole(decoded, decoded.uid, "testFunction")
        ).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: checkAdminRole throws FORBIDDEN for tokens with no role ────────

  it("throws FORBIDDEN for any token with no role claim", () => {
    fc.assert(
      fc.property(noRoleTokenArb, (decoded) => {
        expect(() =>
          checkAdminRole(decoded, decoded.uid, "testFunction")
        ).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: checkAdminRole throws FORBIDDEN for any non-"admin" role ───────

  it("throws FORBIDDEN for any token whose role is not 'admin'", () => {
    fc.assert(
      fc.property(nonAdminRoleTokenArb, (decoded) => {
        expect(() =>
          checkAdminRole(decoded, decoded.uid, "testFunction")
        ).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: user-roles-authorization, Property 4: setUserRole only accepts valid role values

/**
 * Property 4: setUserRole only accepts valid role values
 * Validates: Requirements 2.3
 *
 * For any call to `setUserRole` with a `role` value that is not "user" or "admin",
 * the role validation logic SHALL reject it (would return HTTP 400).
 * Tested as a pure predicate extracted from the setUserRole handler.
 */

/**
 * Pure extraction of the role validation logic from `setUserRole`.
 * Returns true when the role is valid ("user" or "admin"), false otherwise.
 * A false result corresponds to HTTP 400 in the actual handler.
 */
function isValidRole(role: unknown): boolean {
  return role === "user" || role === "admin";
}

describe("Property 4: setUserRole only accepts valid role values", () => {
  // ── Generator: arbitrary strings that are neither "user" nor "admin" ────────

  const invalidRoleArb = fc
    .string()
    .filter((s) => s !== "user" && s !== "admin");

  // ── Property: role validation rejects any string that is not "user" or "admin" ─

  it("rejects (would return 400) any role value that is not 'user' or 'admin'", () => {
    fc.assert(
      fc.property(invalidRoleArb, (invalidRole) => {
        // The validation logic should return false (→ HTTP 400) for any invalid role
        expect(isValidRole(invalidRole)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Sanity check: valid roles are accepted ───────────────────────────────────

  it("accepts 'user' and 'admin' as valid role values", () => {
    expect(isValidRole("user")).toBe(true);
    expect(isValidRole("admin")).toBe(true);
  });
});

// Feature: user-roles-authorization, Property 5: setUserRole requires admin caller

/**
 * Property 5: setUserRole requires admin caller
 * Validates: Requirements 2.2
 *
 * For any call to `setUserRole` by a caller whose token has `role: "user"` or
 * no role at all, `checkAdminRole` SHALL throw an error with message "FORBIDDEN",
 * which maps to HTTP 403 in the `setUserRole` handler.
 */
describe("Property 5: setUserRole requires admin caller", () => {
  // ── Base token factory ───────────────────────────────────────────────────────

  const baseTokenArb = fc.record({
    uid: fc.string({ minLength: 1, maxLength: 40 }),
    iss: fc.constant("https://securetoken.google.com/test-project"),
    aud: fc.constant("test-project"),
    sub: fc.string({ minLength: 1, maxLength: 40 }),
    iat: fc.integer({ min: 0, max: 2_000_000_000 }),
    exp: fc.integer({ min: 0, max: 2_000_000_000 }),
    auth_time: fc.integer({ min: 0, max: 2_000_000_000 }),
    firebase: fc.record({
      identities: fc.constant({}),
      sign_in_provider: fc.constantFrom("password", "google.com", "anonymous"),
    }),
  });

  // ── Generator: tokens with role: "user" ─────────────────────────────────────

  const userRoleTokenArb = baseTokenArb.map((t) => ({
    ...t,
    role: "user" as const,
  })) as fc.Arbitrary<adminTypes.auth.DecodedIdToken & { role: string }>;

  // ── Generator: tokens with no role field ────────────────────────────────────

  const noRoleTokenArb = baseTokenArb as fc.Arbitrary<adminTypes.auth.DecodedIdToken>;

  // ── Property: checkAdminRole throws FORBIDDEN for role: "user" callers ───────

  it("throws FORBIDDEN (→ HTTP 403) for any setUserRole caller with role: 'user'", () => {
    fc.assert(
      fc.property(userRoleTokenArb, (decoded) => {
        expect(() =>
          checkAdminRole(decoded, decoded.uid, "setUserRole")
        ).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: checkAdminRole throws FORBIDDEN for callers with no role ───────

  it("throws FORBIDDEN (→ HTTP 403) for any setUserRole caller with no role claim", () => {
    fc.assert(
      fc.property(noRoleTokenArb, (decoded) => {
        expect(() =>
          checkAdminRole(decoded, decoded.uid, "setUserRole")
        ).toThrow("FORBIDDEN");
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: user-roles-authorization, Property 7: Firestore admin collection blocks non-admins

/**
 * Property 7: Firestore admin collection blocks non-admins
 * Validates: Requirements 8.3
 *
 * For any Firestore read request to the `admin` collection where the caller's
 * token does not have `role: "admin"`, the `isAdmin()` Security Rules helper
 * (modelled as a pure TypeScript predicate) SHALL return false, denying access.
 *
 * Covers:
 *   1. null auth (unauthenticated) → isAdmin returns false
 *   2. auth with role: "user"      → isAdmin returns false
 *   3. auth with no role claim     → isAdmin returns false
 *   4. auth with any non-"admin" string role → isAdmin returns false
 */

/**
 * Pure TypeScript equivalent of the Firestore `isAdmin()` Security Rules helper:
 *
 *   function isAdmin() {
 *     return request.auth != null && request.auth.token.role == "admin";
 *   }
 */
function isAdmin(auth: { token: { role?: string } } | null): boolean {
  return auth !== null && auth.token.role === "admin";
}

describe("Property 7: Firestore admin collection blocks non-admins", () => {
  // ── Generator: auth context with role: "user" ────────────────────────────────

  const userRoleAuthArb = fc.record({
    token: fc.record({ role: fc.constant("user") }),
  });

  // ── Generator: auth context with no role claim ───────────────────────────────

  const noRoleAuthArb = fc.record({
    token: fc.record({}),
  });

  // ── Generator: auth context with any non-"admin" string role ─────────────────

  const nonAdminRoleAuthArb = fc
    .string()
    .filter((s) => s !== "admin")
    .map((role) => ({ token: { role } }));

  // ── Property: null auth (unauthenticated) → isAdmin returns false ─────────────

  it("returns false for null auth (unauthenticated)", () => {
    expect(isAdmin(null)).toBe(false);
  });

  // ── Property: role: "user" → isAdmin returns false ───────────────────────────

  it("returns false for any auth context with role: 'user'", () => {
    fc.assert(
      fc.property(userRoleAuthArb, (auth) => {
        expect(isAdmin(auth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: no role claim → isAdmin returns false ──────────────────────────

  it("returns false for any auth context with no role claim", () => {
    fc.assert(
      fc.property(noRoleAuthArb, (auth) => {
        expect(isAdmin(auth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: any non-"admin" string role → isAdmin returns false ─────────────

  it("returns false for any auth context with a non-'admin' string role", () => {
    fc.assert(
      fc.property(nonAdminRoleAuthArb, (auth) => {
        expect(isAdmin(auth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Sanity check: role: "admin" → isAdmin returns true ───────────────────────

  it("returns true only when role is exactly 'admin'", () => {
    expect(isAdmin({ token: { role: "admin" } })).toBe(true);
  });
});

// Feature: user-roles-authorization, Property 8: Firestore businesses/jobs collections require user role

/**
 * Property 8: Firestore businesses/jobs collections require user role
 * Validates: Requirements 8.4, 8.5
 *
 * For any Firestore read request to the `businesses` or `jobs` collections
 * where the caller's token has neither `role: "user"` nor `role: "admin"`,
 * the `hasUserRole()` Security Rules helper (modelled as a pure TypeScript
 * predicate) SHALL return false, denying access.
 *
 * Covers:
 *   1. null auth (unauthenticated)                    → hasUserRole returns false
 *   2. auth with role: any non-"user"/non-"admin" string → hasUserRole returns false
 *   3. auth with no role claim                        → hasUserRole returns false
 */

/**
 * Pure TypeScript equivalent of the Firestore `hasUserRole()` Security Rules helper:
 *
 *   function hasUserRole() {
 *     return request.auth != null &&
 *            (request.auth.token.role == "user" || request.auth.token.role == "admin");
 *   }
 */
function hasUserRole(auth: { token: { role?: string } } | null): boolean {
  return auth !== null && (auth.token.role === "user" || auth.token.role === "admin");
}

describe("Property 8: Firestore businesses/jobs collections require user role", () => {
  // ── Generator: auth context with any unrecognized role ───────────────────────

  const unrecognizedRoleAuthArb = fc
    .string()
    .filter((s) => s !== "user" && s !== "admin")
    .map((role) => ({ token: { role } }));

  // ── Generator: auth context with no role claim ───────────────────────────────

  const noRoleAuthArb = fc.record({
    token: fc.record({}),
  });

  // ── Property: null auth (unauthenticated) → hasUserRole returns false ─────────

  it("returns false for null auth (unauthenticated)", () => {
    expect(hasUserRole(null)).toBe(false);
  });

  // ── Property: any unrecognized role → hasUserRole returns false ───────────────

  it("returns false for any auth context with a role that is not 'user' or 'admin'", () => {
    fc.assert(
      fc.property(unrecognizedRoleAuthArb, (auth) => {
        expect(hasUserRole(auth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Property: no role claim → hasUserRole returns false ──────────────────────

  it("returns false for any auth context with no role claim", () => {
    fc.assert(
      fc.property(noRoleAuthArb, (auth) => {
        expect(hasUserRole(auth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  // ── Sanity checks: "user" and "admin" roles DO pass ───────────────────────────

  it("returns true when role is exactly 'user'", () => {
    expect(hasUserRole({ token: { role: "user" } })).toBe(true);
  });

  it("returns true when role is exactly 'admin'", () => {
    expect(hasUserRole({ token: { role: "admin" } })).toBe(true);
  });
});
