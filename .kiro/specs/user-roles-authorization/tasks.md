# Implementation Plan: User Roles & Authorization

## Overview

Implement a two-tier role system (`user` / `admin`) across Cloud Functions middleware, Firestore Security Rules, AuthContext, and frontend UI guards. Each layer enforces roles independently.

## Tasks

- [x] 1. Add `verifyAdmin` and `verifyUserRole` middleware to Cloud Functions
  - [x] 1.1 Extend `verifyAuth` in `functions/src/index.ts` with `verifyAdmin` and `verifyUserRole` helpers
    - `verifyUserRole`: calls `verifyIdToken` (no `checkRevoked`), treats missing `role` as `"user"`, throws `FORBIDDEN` for unrecognized role values
    - `verifyAdmin`: calls `verifyIdToken` with `{ checkRevoked: true }`, throws `FORBIDDEN` if `role !== "admin"`, logs `uid` + function name on rejection
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.3, 9.1_

  - [x] 1.2 Write property test for `verifyUserRole` — missing role treated as user
    - **Property 1: Missing role claim treated as user role**
    - **Validates: Requirements 1.2**

  - [x] 1.3 Write property test for `verifyUserRole` — invalid role values rejected
    - **Property 2: Invalid role values are rejected**
    - **Validates: Requirements 3.2**

  - [x] 1.4 Write property test for `verifyAdmin` — non-admin callers rejected
    - **Property 3: Admin endpoint rejects non-admin callers**
    - **Validates: Requirements 4.1, 5.1**

- [x] 2. Implement `onUserCreate` Auth trigger and `setUserRole` Cloud Function
  - [x] 2.1 Add `onUserCreate` Firebase Auth trigger in `functions/src/index.ts`
    - On new account creation: call `admin.auth().setCustomUserClaims(uid, { role: "user" })` then `revokeRefreshTokens(uid)`
    - _Requirements: 1.1, 1.3, 1.4_

  - [x] 2.2 Add `setUserRole` HTTP Cloud Function in `functions/src/index.ts`
    - Use `verifyAdmin` to gate the endpoint (HTTP 403 for non-admins)
    - Validate `role` is `"user"` or `"admin"`, return HTTP 400 otherwise
    - Set Custom Claim via Admin SDK, then call `revokeRefreshTokens` on target uid
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.3, 9.5_

  - [x] 2.3 Write property test for `setUserRole` — invalid role values return 400
    - **Property 4: setUserRole only accepts valid role values**
    - **Validates: Requirements 2.3**

  - [x] 2.4 Write property test for `setUserRole` — non-admin caller returns 403
    - **Property 5: setUserRole requires admin caller**
    - **Validates: Requirements 2.2**

- [x] 3. Update existing Cloud Functions to use role-aware middleware
  - [x] 3.1 Replace `verifyAuth` calls in user-level functions with `verifyUserRole`
    - Applies to: `dataforseoBusinessSearch`, `cancelSearchJob`, `getBusinessesByCids`, `getBusinessPhotos`, `submitReport`
    - _Requirements: 3.1, 3.2, 8.6_

  - [x] 3.2 Replace `verifyAuth` calls in admin-only functions with `verifyAdmin`
    - Applies to: `reevaluateBusiness`, `recalculateBusinessRank`, `getGhostBusinesses`, `getAdminStats`
    - _Requirements: 4.1, 4.2, 5.1, 5.3_

- [x] 4. Checkpoint — Ensure all Cloud Function tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Update Firestore Security Rules
  - [x] 5.1 Add `isAdmin()` and `hasUserRole()` helper functions to `firestore.rules`
    - `isAdmin()`: `request.auth != null && request.auth.token.role == "admin"`
    - `hasUserRole()`: `request.auth != null && (request.auth.token.role == "user" || request.auth.token.role == "admin")`
    - _Requirements: 8.1, 8.2_

  - [x] 5.2 Update `businesses` collection rule to use `hasUserRole()` instead of `request.auth != null`
    - _Requirements: 8.4, 8.6_

  - [x] 5.3 Update `jobs` and `jobs/{jobId}/results` rules to use `hasUserRole()` instead of `request.auth != null`
    - _Requirements: 8.5, 8.6_

  - [x] 5.4 Add `admin` collection rule restricted to `isAdmin()`
    - _Requirements: 8.3_

  - [x] 5.5 Write property test for Firestore rules — admin collection blocks non-admins
    - **Property 7: Firestore admin collection blocks non-admins**
    - **Validates: Requirements 8.3**

  - [x] 5.6 Write property test for Firestore rules — businesses/jobs require user role
    - **Property 8: Firestore businesses/jobs collections require user role**
    - **Validates: Requirements 8.4, 8.5**

- [x] 6. Update `AuthContext` to expose `role` from ID token claims
  - [x] 6.1 Extend `AuthContextValue` interface in `frontend/src/contexts/AuthContext.tsx` with `role: "user" | "admin" | null`
    - Call `user.getIdTokenResult()` inside `onAuthStateChanged` to decode claims
    - Set `role` from `claims.role` or `null` when unauthenticated
    - _Requirements: 6.1, 6.3, 6.4_

  - [x] 6.2 Write property test for `AuthContext` — role reflects token claims
    - **Property 6: AuthContext role reflects token claims**
    - **Validates: Requirements 6.1, 6.3**

- [x] 7. Add `ProtectedAdminRoute` and update `/admin` route
  - [x] 7.1 Create `ProtectedAdminRoute` component in `frontend/src/App.tsx` (or a new `frontend/src/components/ProtectedAdminRoute.tsx`)
    - Reads `user`, `role`, `loading` from `useAuth()`
    - Shows loading spinner while `loading === true`
    - Redirects to `/` if `role !== "admin"` and user is authenticated
    - Redirects to login (handled by existing `AuthGate`) if `user === null`
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 7.2 Wrap the `/admin` route in `AuthGate` with `ProtectedAdminRoute` in `frontend/src/App.tsx`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 8. Gate the Re-evaluate button in `LeadDetailPanel`
  - [x] 8.1 Read `role` from `useAuth()` in `frontend/src/components/LeadDetailPanel.tsx`
    - Conditionally render the Re-evaluate button only when `role === "admin"`
    - _Requirements: 5.2_

- [x] 9. Create bootstrap admin script
  - [x] 9.1 Create `scripts/bootstrap-admin.ts` using the Firebase Admin SDK
    - Accepts a `uid` argument, sets `{ role: "admin" }` Custom Claim via Admin SDK
    - Intended for one-time local execution only; never deployed as a Cloud Function
    - _Requirements: 2.5_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check` with a minimum of 100 iterations per property
- Each property test must include the comment: `// Feature: user-roles-authorization, Property N: <property_text>`
- The bootstrap script (task 9.1) is run locally and never deployed
