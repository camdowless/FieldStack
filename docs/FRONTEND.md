# Frontend Documentation

The frontend is a React 18 SPA built with Vite, TypeScript, and shadcn/ui. It talks to Firebase directly for auth and real-time data, and to Cloud Functions via `/api/*` rewrites for mutations and billing.

---

## Directory Structure

```
frontend/src/
├── App.tsx                 Root component, routing, auth gate
├── main.tsx                Entry point, error reporter init
├── index.css               CSS variables (theme tokens), global styles
│
├── components/
│   ├── ui/                 shadcn/ui primitives (50 components, do not edit)
│   ├── AppLayout.tsx       Shell: sidebar + main content area
│   ├── AppSidebar.tsx      Collapsible sidebar with nav, credits bar, user info
│   ├── ErrorBoundary.tsx   React error boundary with error reporter integration
│   ├── VerifyEmailScreen.tsx  Email verification gate for new email/password users
│   ├── ProfileSetupScreen.tsx Animated loading screen while user profile is provisioned
│   ├── ProtectedAdminRoute.tsx  Route guard for admin-only pages
│   ├── WelcomeModal.tsx    First-login welcome dialog
│   ├── SignUpModal.tsx      Sign up dialog (email + Google)
│   ├── ContactSupportDialog.tsx  Support ticket submission
│   ├── RedirectingOverlay.tsx    Full-screen overlay during Stripe redirects
│   ├── NavLink.tsx         Active-aware nav link wrapper
│   ├── Header.tsx          Page header component
│   ├── DevRateLimitTester.tsx  Dev tool: test rate limiting
│   └── DevLogTester.tsx    Dev tool: test structured logging
│
├── contexts/
│   ├── AuthContext.tsx      Auth state, user profile, subscription (Firestore onSnapshot)
│   └── ThemeContext.tsx     Dark/light theme toggle
│
├── hooks/
│   ├── useCredits.ts       Derives credit balance from AuthContext profile
│   ├── usePlans.ts         Fetches plans from Firestore (cached 5 min)
│   ├── useItems.ts         Real-time Items CRUD (canonical example)
│   ├── usePreferences.ts   User preferences with debounced Firestore writes
│   ├── use-mobile.tsx      Mobile breakpoint detection
│   └── use-toast.ts        Toast notification hook
│
├── lib/
│   ├── firebase.ts         Firebase SDK initialization (auth, firestore)
│   ├── api.ts              Typed API helpers (getAuthToken, Items CRUD, support)
│   ├── config.ts           Brand config (appName, appUrl, colors, feature flags)
│   ├── planFeatures.ts     Plan feature utilities (getPlanFeatures, canSaveLeads)
│   ├── errorReporter.ts    Frontend error capture and reporting
│   └── utils.ts            shadcn cn() utility
│
└── pages/
    ├── ItemsPage.tsx       Canonical example: full CRUD UI
    ├── Billing.tsx         Plans, invoices, cancel/reactivate
    ├── Settings.tsx        Profile, security, preferences
    ├── Help.tsx            Support contact
    ├── Login.tsx           Sign in / sign up
    ├── AuthAction.tsx      Firebase email action handler (verify, reset)
    ├── SystemAdmin.tsx     Admin-only: stats and dev tools
    └── NotFound.tsx        404 redirect
```

---

## Auth Context

`AuthContext` is the single source of truth for auth state. It manages:

- Firebase Auth state via `onAuthStateChanged`
- Firestore profile subscription via `onSnapshot` on `users/{uid}`
- Role custom claim polling (up to 8s after profile doc appears)
- Email verification state
- New user detection (`isNewUser`)

**Reading auth state:**

```tsx
const { user, profile, role, loading, emailVerified } = useAuth();
```

**Available actions:**

```tsx
const { signIn, signUp, signInWithGoogle, logout, sendPasswordReset,
        resendVerificationEmail, refreshEmailVerified, updateProfile,
        deleteAccount } = useAuth();
```

**Never** read `auth.currentUser` directly in components. Always use `useAuth()`.

The `profile` object contains the full Firestore user document including `subscription`. The `role` is derived from the Firebase ID token custom claim.

---

## Routing

Routes are defined in `App.tsx` inside `AuthGate`. The auth gate handles three states before rendering routes:

1. `loading` - shows spinner (or `ProfileSetupScreen` for new users)
2. `!user` - renders `<Login />`
3. `needsVerification` - renders `<VerifyEmailScreen />`

Current routes:

| Path | Component | Notes |
|---|---|---|
| `/` | `ItemsPage` | Main feature page |
| `/settings` | `Settings` | Profile, security, preferences |
| `/billing` | `Billing` | Plans and invoices |
| `/help` | `Help` | Support |
| `/admin` | `SystemAdmin` | Admin role required |
| `/auth/action` | `AuthAction` | Firebase email action handler |

To add a route:
1. Create the page component in `frontend/src/pages/`
2. Import it in `App.tsx` and add a `<Route>` inside `AuthGate`
3. Add a nav item in `AppSidebar.tsx`

---

## API Calls

All API calls go through helpers in `frontend/src/lib/api.ts`. They:

1. Call `getAuthToken()` to get a fresh Firebase ID token
2. `fetch()` to `/api/endpoint` with `Authorization: Bearer <token>`
3. Parse the response and throw `ApiError` on non-2xx

**Pattern:**

```typescript
import { getAuthToken, ApiError } from "@/lib/api";

export async function doSomething(params: Params): Promise<Result> {
  const token = await getAuthToken();
  if (!token) throw new ApiError("You must be signed in.", 401, false);

  const res = await fetch("/api/your-endpoint", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, res.status >= 500);
  }

  return res.json();
}
```

---

## Real-time Data Pattern

For Firestore-backed resources, use `onSnapshot` for real-time updates. Follow `useItems.ts`:

```typescript
export function useYourResource() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(firestore, "users", user.uid, "your-resource"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [user?.uid]);

  // CRUD functions call API helpers, Firestore onSnapshot updates the list
  const create = useCallback(async (params) => { await createYourResource(params); }, []);

  return { items, create, ... };
}
```

---

## Brand Configuration

All brand strings are centralized in `frontend/src/lib/config.ts`:

```typescript
import { config } from "@/lib/config";

config.appName        // "FieldStack" or VITE_APP_NAME
config.appUrl         // Production URL
config.supportEmail   // Support email
config.brand.primaryColor  // HSL color string
config.features.billing    // Feature flag
```

Override any value via environment variables in `frontend/.env`.

---

## Theming

The app uses CSS custom properties for theming. Light and dark themes are defined in `frontend/src/index.css` as `.theme-light` and `.theme-dark` classes on the `<html>` element.

`ThemeContext` manages the toggle and persists the preference to `localStorage`.

To change the primary color, update `--primary` in `index.css` or set `VITE_BRAND_PRIMARY_COLOR` in `.env`.

Gradient utilities (`.gradient-text`, `.gradient-bg`) use `--gradient-start` and `--gradient-end` CSS variables.

---

## Testing

Tests use Vitest + Testing Library. Run with:

```bash
bun run test --cwd frontend
```

Test files live alongside the code they test (`*.test.ts` / `*.test.tsx`).

The test setup is in `frontend/src/test/setup.ts`. Firebase is mocked in `frontend/src/lib/__mocks__/`.

---

## Build

```bash
bun run build --cwd frontend
```

Output goes to `frontend/dist/`. Firebase Hosting serves this directory.

The build injects `VITE_*` environment variables at build time. Make sure all required vars are set before building for production (the CI workflow reads them from GitHub Secrets).

`__APP_VERSION__` is a Vite define injected from `VITE_APP_VERSION` in `.env`. It appears in the sidebar footer.
