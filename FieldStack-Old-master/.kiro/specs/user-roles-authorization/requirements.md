# Requirements Document

## Introduction

This feature introduces a two-tier role system (`user` and `admin`) for the Firebase-based web application. All authenticated users receive the `user` role by default. The `admin` role is restricted to designated developers/owners and is assigned exclusively via Firebase Custom Claims on the server side. Role enforcement is layered: Firebase Custom Claims in ID tokens, Firestore Security Rules, and Cloud Function middleware all independently verify roles, so no single layer is a single point of failure. The frontend additionally gates UI elements (the SystemAdmin page and the Re-evaluate button) based on the role decoded from the user's ID token.

## Glossary

- **Auth_Service**: Firebase Authentication service responsible for issuing and verifying ID tokens.
- **Custom_Claims**: Key-value pairs embedded in a Firebase ID token by the Firebase Admin SDK server-side; cannot be set by client code.
- **Role**: A string value (`"user"` or `"admin"`) stored in Custom_Claims under the key `role`.
- **User_Role**: The default role assigned to every authenticated user upon first sign-in or account creation.
- **Admin_Role**: The elevated role restricted to designated developers/owners; grants access to admin panel actions and the Re-evaluate button.
- **Cloud_Function**: A Firebase Cloud Function (HTTP or Firestore trigger) that processes backend requests.
- **Auth_Middleware**: Server-side logic inside each Cloud Function that verifies the caller's ID token and checks the required role before processing the request.
- **Firestore_Rules**: Firestore Security Rules that enforce data-access permissions based on Custom_Claims in the request's auth token.
- **Admin_Panel**: The SystemAdmin page (`/admin`) in the React frontend.
- **Reevaluate_Button**: The "Re-evaluate" button in `LeadDetailPanel` that triggers the `reevaluateBusiness` API call.
- **Role_Assignment_Function**: A Firebase Cloud Function callable only by existing admins that sets the `role` Custom Claim on a target user.
- **Token_Refresh**: The process by which the Firebase client SDK fetches a new ID token from Auth_Service, picking up any updated Custom_Claims.
- **AuthContext**: The React context (`AuthContext.tsx`) that exposes the current user and their decoded role to the frontend.

---

## Requirements

### Requirement 1: Default User Role Assignment

**User Story:** As a new user, I want to automatically receive the `user` role when I create an account, so that I can access the application without any manual setup.

#### Acceptance Criteria

1. WHEN a new user account is created via Firebase Authentication, THE Auth_Service SHALL trigger a Cloud Function that sets the Custom Claim `{ role: "user" }` on the new user's account within 5 seconds of account creation.
2. WHEN a user signs in and their ID token contains no `role` Custom Claim, THE Auth_Middleware SHALL treat the request as having the `user` role for backward compatibility with accounts created before this feature.
3. THE Role_Assignment_Function SHALL set Custom Claims using the Firebase Admin SDK exclusively; client-side SDKs SHALL NOT be used to set or modify Custom Claims.
4. WHEN the `user` role Custom Claim is set on a new account, THE Auth_Service SHALL force a token refresh so the new claim is available in the user's next ID token.

---

### Requirement 2: Admin Role Assignment

**User Story:** As an application owner, I want to grant the `admin` role to specific users (myself and developers), so that only trusted individuals can access privileged operations.

#### Acceptance Criteria

1. THE Role_Assignment_Function SHALL accept a target `uid` and a `role` value, and set the corresponding Custom Claim on that user via the Firebase Admin SDK.
2. WHEN the Role_Assignment_Function is called, THE Auth_Middleware SHALL verify that the caller's ID token contains `role: "admin"` before executing the role change; IF the caller does not have `role: "admin"`, THEN THE Role_Assignment_Function SHALL return HTTP 403.
3. THE Role_Assignment_Function SHALL only accept `"user"` or `"admin"` as valid role values; IF an invalid role value is provided, THEN THE Role_Assignment_Function SHALL return HTTP 400 with a descriptive error message.
4. WHEN the `admin` role is assigned to a user, THE Role_Assignment_Function SHALL force a token refresh on that user's next sign-in so the updated claim is reflected in their ID token.
5. THE system SHALL provide a mechanism (e.g., a one-time bootstrap script using the Firebase Admin SDK) to assign the initial `admin` role to the first owner without requiring an existing admin caller.

---

### Requirement 3: API Protection — Authenticated User with User Role

**User Story:** As a system owner, I want all Cloud Function API endpoints to require an authenticated user with at least the `user` role, so that unauthenticated or role-less callers cannot invoke backend operations.

#### Acceptance Criteria

1. WHEN a request is received by any HTTP Cloud Function, THE Auth_Middleware SHALL verify the `Authorization: Bearer <token>` header contains a valid, non-expired Firebase ID token; IF the token is missing or invalid, THEN THE Auth_Middleware SHALL return HTTP 401.
2. WHEN a valid ID token is verified, THE Auth_Middleware SHALL check that the token's `role` Custom Claim is `"user"` or `"admin"`; IF the claim is absent or holds an unrecognized value, THEN THE Auth_Middleware SHALL return HTTP 403.
3. THE Auth_Middleware SHALL perform token verification using the Firebase Admin SDK `verifyIdToken` method with `checkRevoked: true` to detect revoked tokens.
4. WHILE a Cloud Function is processing a request, THE Auth_Middleware SHALL re-use the single decoded token result for all subsequent role checks within that request to avoid redundant verification calls.
5. IF token verification throws any error, THEN THE Auth_Middleware SHALL return HTTP 401 and SHALL NOT expose internal error details to the caller.

---

### Requirement 4: Admin Role Enforcement on Admin Panel Actions

**User Story:** As a system owner, I want all Admin Panel Cloud Function endpoints to require the `admin` role, so that only authorized administrators can perform privileged backend operations.

#### Acceptance Criteria

1. WHEN a request is received by an admin-only Cloud Function (recalculate business ranks, fetch ghost businesses, assign roles), THE Auth_Middleware SHALL verify the decoded token contains `role: "admin"`; IF the role is not `"admin"`, THEN THE Auth_Middleware SHALL return HTTP 403.
2. THE admin-only Cloud Functions SHALL enforce the `admin` role check server-side regardless of any client-side UI gating; client-side checks are supplementary only.
3. IF an `admin` role check fails on any admin-only Cloud Function, THEN THE Cloud_Function SHALL log the unauthorized attempt including the caller's `uid` and the function name, without logging the full token.

---

### Requirement 5: Re-evaluate Button — Admin Role Enforcement

**User Story:** As a system owner, I want the Re-evaluate button to be restricted to admin users, so that only authorized users can trigger expensive re-scoring operations.

#### Acceptance Criteria

1. WHEN the `reevaluateBusiness` Cloud Function receives a request, THE Auth_Middleware SHALL verify the decoded token contains `role: "admin"`; IF the role is not `"admin"`, THEN THE Auth_Middleware SHALL return HTTP 403.
2. WHILE the current user's role is not `"admin"`, THE Reevaluate_Button SHALL be hidden from the `LeadDetailPanel` UI.
3. WHEN a non-admin user attempts to call the `reevaluateBusiness` endpoint directly (bypassing the UI), THE Auth_Middleware SHALL still return HTTP 403, ensuring server-side enforcement is independent of the UI.

---

### Requirement 6: Frontend Role Propagation via AuthContext

**User Story:** As a developer, I want the AuthContext to expose the current user's role decoded from their ID token, so that UI components can conditionally render based on role without additional API calls.

#### Acceptance Criteria

1. THE AuthContext SHALL decode the current user's ID token claims on each auth state change and expose a `role` field of type `"user" | "admin" | null`.
2. WHEN the user's ID token is refreshed (e.g., after a role change), THE AuthContext SHALL update the exposed `role` field to reflect the new claims within one token refresh cycle (up to 1 hour, or immediately if `getIdTokenResult(true)` is called).
3. WHILE the user is not authenticated, THE AuthContext SHALL expose `role: null`.
4. THE AuthContext SHALL obtain the role exclusively from the decoded ID token claims (via `getIdTokenResult`), not from Firestore or any other client-readable source, to prevent client-side role spoofing.

---

### Requirement 7: Admin Panel Route Protection

**User Story:** As a system owner, I want the Admin Panel page to be inaccessible to non-admin users, so that the admin UI is not exposed to regular users.

#### Acceptance Criteria

1. WHILE the current user's role is not `"admin"`, THE Admin_Panel route SHALL redirect the user to the application home page (`/`).
2. WHILE the authentication state is loading, THE Admin_Panel route SHALL render a loading state and SHALL NOT redirect prematurely.
3. WHEN an unauthenticated user navigates to the Admin Panel route, THE Admin_Panel route SHALL redirect the user to the login page.
4. THE Admin_Panel route guard SHALL read the role exclusively from AuthContext to remain consistent with the rest of the application.

---

### Requirement 8: Firestore Security Rules — Role-Based Access

**User Story:** As a system owner, I want Firestore Security Rules to enforce role-based access at the database layer, so that even if application code is bypassed, data remains protected.

#### Acceptance Criteria

1. THE Firestore_Rules SHALL define a helper function `isAdmin()` that returns `true` when `request.auth.token.role == "admin"`.
2. THE Firestore_Rules SHALL define a helper function `hasUserRole()` that returns `true` when `request.auth.token.role == "user"` or `request.auth.token.role == "admin"`.
3. WHEN a read request is made to the `admin` collection, THE Firestore_Rules SHALL allow access only if `isAdmin()` returns `true`; IF `isAdmin()` returns `false`, THEN THE Firestore_Rules SHALL deny the request.
4. WHEN a read request is made to the `businesses` collection, THE Firestore_Rules SHALL allow access only if `hasUserRole()` returns `true`.
5. WHEN a read request is made to the `jobs` collection or its `results` subcollection, THE Firestore_Rules SHALL allow access only if `hasUserRole()` returns `true` and `resource.data.uid == request.auth.uid`.
6. THE Firestore_Rules SHALL NOT rely solely on `request.auth != null` for any collection that previously used that check; all such rules SHALL be upgraded to use `hasUserRole()` or `isAdmin()`.

---

### Requirement 9: Token Revocation and Security Hardening

**User Story:** As a system owner, I want the system to handle token revocation and edge cases securely, so that compromised or stale tokens cannot be used to access protected resources.

#### Acceptance Criteria

1. THE Auth_Middleware SHALL pass `{ checkRevoked: true }` to `admin.auth().verifyIdToken()` on all admin-only endpoints to detect revoked tokens.
2. IF a revoked token is presented to an admin-only endpoint, THEN THE Auth_Middleware SHALL return HTTP 401.
3. THE Role_Assignment_Function SHALL call `admin.auth().revokeRefreshTokens(uid)` after changing a user's role to force immediate re-authentication and token refresh for that user.
4. THE system SHALL NOT store role information in Firestore user documents as an authoritative source; Custom_Claims in the ID token SHALL be the sole authoritative source of role data.
5. THE system SHALL NOT expose any Cloud Function or client-accessible endpoint that allows a user to self-assign or escalate their own role.
