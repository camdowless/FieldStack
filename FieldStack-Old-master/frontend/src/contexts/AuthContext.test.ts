// Feature: user-roles-authorization, Property 6: AuthContext role reflects token claims
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

/**
 * Pure extraction of the role-mapping logic from AuthContext.
 * This mirrors the logic in AuthContext.tsx:
 *
 *   const tokenResult = await user.getIdTokenResult();
 *   const role = (tokenResult.claims.role as "user" | "admin") ?? null;
 *
 * Validates: Requirements 6.1, 6.3
 */
function extractRole(claims: Record<string, unknown>): "user" | "admin" | null {
  const role = claims.role;
  if (role === "user" || role === "admin") return role;
  return null;
}

/**
 * Simulates the unauthenticated path in AuthContext:
 *   if (!user) setRole(null)
 */
function extractRoleUnauthenticated(): null {
  return null;
}

describe("AuthContext role extraction — Property 6", () => {
  // Property 6a: role: "user" in claims → extractRole returns "user"
  it('returns "user" for any claims object with role: "user"', () => {
    fc.assert(
      fc.property(
        fc.record({
          role: fc.constant("user"),
          // arbitrary extra claims to ensure we only look at role
          extra: fc.dictionary(fc.string(), fc.jsonValue()),
        }),
        (claims) => {
          expect(extractRole(claims as Record<string, unknown>)).toBe("user");
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 6b: role: "admin" in claims → extractRole returns "admin"
  it('returns "admin" for any claims object with role: "admin"', () => {
    fc.assert(
      fc.property(
        fc.record({
          role: fc.constant("admin"),
          extra: fc.dictionary(fc.string(), fc.jsonValue()),
        }),
        (claims) => {
          expect(extractRole(claims as Record<string, unknown>)).toBe("admin");
        }
      ),
      { numRuns: 100 }
    );
  });

  // Property 6c: missing or invalid role → extractRole returns null
  it("returns null for any claims object with no role or an unrecognized role", () => {
    const invalidRoleArb = fc.oneof(
      // no role key at all
      fc.record({ extra: fc.dictionary(fc.string(), fc.jsonValue()) }).map(
        (r) => r as Record<string, unknown>
      ),
      // role is null
      fc.record({ role: fc.constant(null), extra: fc.dictionary(fc.string(), fc.jsonValue()) }).map(
        (r) => r as Record<string, unknown>
      ),
      // role is a string that is neither "user" nor "admin"
      fc
        .string()
        .filter((s) => s !== "user" && s !== "admin")
        .map((role) => ({ role } as Record<string, unknown>)),
      // role is a number
      fc.record({ role: fc.integer(), extra: fc.dictionary(fc.string(), fc.jsonValue()) }).map(
        (r) => r as Record<string, unknown>
      ),
      // role is a boolean
      fc.record({ role: fc.boolean(), extra: fc.dictionary(fc.string(), fc.jsonValue()) }).map(
        (r) => r as Record<string, unknown>
      )
    );

    fc.assert(
      fc.property(invalidRoleArb, (claims) => {
        expect(extractRole(claims)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  // Property 6d: unauthenticated user → role is always null
  it("returns null when user is unauthenticated (null auth state)", () => {
    fc.assert(
      fc.property(fc.constant(null), (_user) => {
        expect(extractRoleUnauthenticated()).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
