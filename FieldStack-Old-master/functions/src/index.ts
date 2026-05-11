import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import cors from "cors";
import { Timestamp, FieldValue } from "firebase-admin/firestore";
import type { UserProfile, Subscription, SubscriptionPlan } from "./types";
import { checkUserRole, checkAdminRole } from "./authHelpers";
import { sendPasswordResetEmail as sendPasswordResetEmailViaResend, sendVerificationEmailToAddress } from "./emailService";
import { getPlanCredits, buildPriceIdToPlanMap, invalidatePlanCache, getAllPlans } from "./plans";
import { buildPlanSeedData, PLAN_IDS } from "./seedPlans";
import Stripe from "stripe";
type StripeInstance = InstanceType<typeof Stripe>;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
let _stripe: StripeInstance | null = null;
function getStripe(): StripeInstance {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
  }
  return _stripe;
}

admin.initializeApp();
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Set CORS_ORIGIN (comma-separated) in functions/.env:
//   CORS_ORIGIN=https://your-app.web.app,https://your-custom-domain.com
const rawCorsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

if (rawCorsOrigins.length === 0) {
  console.error("[CORS] ❌ CORS_ORIGIN is not set — all cross-origin requests will be rejected with 401. Set CORS_ORIGIN in functions/.env");
} else {
  // CORS origins configured
}

const corsHandler = cors({
  origin: (origin, callback) => {
    // Allow requests with no Origin header (same-origin, curl, server-to-server)
    if (!origin) {
      callback(null, true);
      return;
    }
    if (rawCorsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" is not allowed`));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// ─── Auth Helper ──────────────────────────────────────────────────────────────

/**
 * Verifies the request token and checks that the caller has the "user" or "admin" role.
 * Treats a missing `role` claim as "user" for backward compatibility.
 * Throws FORBIDDEN for any unrecognized role value.
 */
async function verifyUserRole(req: functions.https.Request): Promise<admin.auth.DecodedIdToken> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  // No checkRevoked here — revocation is reserved for admin/security actions.
  // Checking revocation on every user request breaks sessions for users whose
  // tokens were revoked during admin operations (e.g. role changes).
  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1]);
  checkUserRole(decoded);
  return decoded;
}

/**
 * Verifies the request token with revocation check and asserts the caller has the "admin" role.
 * Logs uid + function name on rejection (Req 4.3).
 * Throws FORBIDDEN if role !== "admin".
 */
async function verifyAdmin(req: functions.https.Request, functionName?: string): Promise<admin.auth.DecodedIdToken> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new Error("UNAUTHENTICATED");
  }
  const decoded = await admin.auth().verifyIdToken(header.split("Bearer ")[1], true /* checkRevoked */);
  checkAdminRole(decoded, decoded.uid, functionName);
  return decoded;
}

// ─── User Profile Helper ─────────────────────────────────────────────────────

const USERS_COLLECTION = "users";

type FirestoreUserProfile = Omit<UserProfile, "createdAt" | "updatedAt"> & {
  createdAt: FieldValue;
  updatedAt: FieldValue;
};


/**
 * Build a default subscription object for a given plan.
 * creditsTotal is read from the Firestore plans collection.
 */
async function buildDefaultSubscription(plan: SubscriptionPlan = "free"): Promise<Subscription> {
  const creditsTotal = await getPlanCredits(plan);
  return {
    plan,
    status: "active",
    creditsUsed: 0,
    creditsTotal,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
  };
}

/**
 * Build a complete user profile document from the given fields.
 * Single source of truth for the shape of a new user document.
 */
async function buildUserProfile(fields: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}): Promise<FirestoreUserProfile> {
  const now = FieldValue.serverTimestamp();
  return {
    uid: fields.uid,
    email: fields.email ?? null,
    displayName: fields.displayName ?? null,
    photoURL: fields.photoURL ?? null,
    role: "user",
    subscription: await buildDefaultSubscription("free"),
    preferences: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Authoritative user profile creation — called from the onUserCreate auth
 * trigger with the full UserRecord already in hand.
 *
 * Uses Firestore `create()` so it fails loudly if the doc already exists
 * (which should never happen in the onCreate path). This guarantees the
 * complete profile is written atomically before the function returns.
 */
async function createUserProfile(user: admin.auth.UserRecord): Promise<void> {
  const ref = db.collection(USERS_COLLECTION).doc(user.uid);
  const profile = await buildUserProfile({
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
  });

  try {
    await ref.create(profile);
  } catch (err: unknown) {
    const code = (err as { code?: number }).code;
    if (code === 6) {
      return;
    }
    console.error(`[createUserProfile] FAILED uid=${user.uid} code=${code}`, err);
    throw err;
  }
}

// ─── Rate Limiting (Firestore-backed, per-user) ───────────────────────────────
// Keyed by uid so limits are consistent across all function instances.
// Each counter doc lives at: rateLimits/{uid}_{fn} and expires after the window.

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Returns null if the request is allowed, or the resetAt timestamp (ms) if
 * the user has exceeded `maxRequests` calls to `fnName` within the window.
 */
async function checkRateLimit(uid: string, fnName: string, maxRequests: number): Promise<number | null> {
  const key = `${uid}_${fnName}`;
  const ref = db.collection("rateLimits").doc(key);
  const now = Date.now();

  try {
    const resetAtMs = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || snap.data()!.resetAt.toMillis() <= now) {
        tx.set(ref, {
          count: 1,
          resetAt: Timestamp.fromMillis(now + RATE_LIMIT_WINDOW_MS),
        });
        return null;
      }
      const count: number = snap.data()!.count;
      const resetAt: number = snap.data()!.resetAt.toMillis();
      if (count >= maxRequests) return resetAt;
      tx.update(ref, { count: count + 1 });
      return null;
    });
    return resetAtMs;
  } catch (err) {
    console.error(`[rateLimit] Firestore error for uid=${uid} fn=${fnName}:`, err);
    return null; // fail open
  }
}

/** Send a 429 with Retry-After header and retryAfter seconds in the body. */
function replyRateLimited(res: functions.Response, resetAtMs: number): void {
  const retryAfter = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  res.set("Retry-After", String(retryAfter));
  res.status(429).json({ error: "Too many requests. Please wait a moment.", retryAfter });
}

// ─── Auth Trigger: Assign default role on account creation ──────────────────

export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  console.log(`[onUserCreate] TRIGGERED uid=${user.uid} email=${user.email ?? "none"} provider=${user.providerData.map((p) => p.providerId).join(",")}`);

  // 1. Set the custom claim so the frontend can gate on role.
  try {
    await admin.auth().setCustomUserClaims(user.uid, { role: "user" });
    console.log(`[onUserCreate] custom claim set uid=${user.uid}`);
  } catch (err) {
    console.error(`[onUserCreate] FAILED to set custom claim uid=${user.uid}`, err);
    throw err; // propagate so Cloud Functions retries
  }

  // Do NOT revoke tokens here — the claim will be picked up on next natural
  // token refresh. Revoking immediately after signup breaks the new user's session.

  // 2. Write the full user profile document using the UserRecord we already
  //    have — no redundant getUser() call, no silent swallowing of errors.
  await createUserProfile(user);

  // 3. Profile created. Verification email is sent on-demand from the
  //    VerifyEmailScreen via the resendVerificationEmail callable — we don't
  //    call generateEmailVerificationLink here to avoid burning Firebase's
  //    rate limit before the user even clicks "send".
  console.log(`[onUserCreate] COMPLETE uid=${user.uid}`);
});

// ─── Callable: Send branded password reset email via Resend ──────────────────

export const sendPasswordReset = functions.https.onCall(async (data, context) => {
  const email = (data?.email ?? "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new functions.https.HttpsError("invalid-argument", "A valid email address is required.");
  }

  // ── Rate limit: max 3 reset requests per email per hour ──────────────────
  const db = admin.firestore();
  const rateLimitRef = db.collection("rateLimits").doc(`pwreset:${email}`);
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateLimitRef);
    const existing = snap.exists ? (snap.data() as { count: number; windowStart: number }) : null;

    if (existing && now - existing.windowStart < windowMs) {
      if (existing.count >= 3) {
        throw new functions.https.HttpsError(
          "resource-exhausted",
          "Too many reset requests. Please wait before trying again."
        );
      }
      tx.update(rateLimitRef, { count: existing.count + 1 });
    } else {
      tx.set(rateLimitRef, { count: 1, windowStart: now });
    }
  });

  try {
    const resetLink = await admin.auth().generatePasswordResetLink(email);
    await sendPasswordResetEmailViaResend(email, resetLink);
    console.log(`[sendPasswordReset] Reset email sent`);
  } catch (err: any) {
    if (err instanceof functions.https.HttpsError) throw err;
    // Don't leak whether the email exists — always return success to the client.
    console.error(`[sendPasswordReset] Error:`, err?.message ?? err);
  }

  // Always return success to prevent email enumeration
  return { success: true };
});

// ─── Callable: Resend verification email ─────────────────────────────────────

export const resendVerificationEmail = functions.https.onCall(async (_data, context) => {
  console.log(`[resendVerificationEmail] Called auth=${!!context.auth} uid=${context.auth?.uid ?? "none"}`);

  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Must be signed in.");
  }

  const uid = context.auth.uid;
  console.log(`[resendVerificationEmail] Fetching user record uid=${uid}`);
  const userRecord = await admin.auth().getUser(uid);
  console.log(`[resendVerificationEmail] emailVerified=${userRecord.emailVerified} email=${userRecord.email ?? "none"}`);

  if (userRecord.emailVerified) {
    console.log(`[resendVerificationEmail] Already verified, skipping uid=${uid}`);
    return { success: true };
  }

  if (!userRecord.email) {
    throw new functions.https.HttpsError("failed-precondition", "No email address on account.");
  }

  try {
    console.log(`[resendVerificationEmail] Generating link for ${userRecord.email}`);
    const verificationLink = await admin.auth().generateEmailVerificationLink(userRecord.email);
    console.log(`[resendVerificationEmail] Link generated, sending…`);
    await sendVerificationEmailToAddress(userRecord.email, verificationLink);
    console.log(`[resendVerificationEmail] ✅ Sent uid=${uid}`);
  } catch (err: any) {
    const msg: string = err?.errorInfo?.message ?? err?.message ?? "";
    if (msg.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
      throw new functions.https.HttpsError(
        "resource-exhausted",
        "Too many attempts. Please wait a few minutes before requesting another verification email."
      );
    }
    console.error(`[resendVerificationEmail] Failed for uid=${uid}:`, err);
    throw new functions.https.HttpsError("internal", "Failed to send verification email. Please try again.");
  }

  return { success: true };
});

// ─── Submit Report ────────────────────────────────────────────────────────────

const VALID_REASONS = ["wrong_ranking", "wrong_signal", "incorrect_info", "other"] as const;

export const submitReport = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const rlReset = await checkRateLimit(decodedToken.uid, "submitReport", 10);
    if (rlReset !== null) { replyRateLimited(res, rlReset); return; }

    const { cid, businessName, websiteUrl, reason, details } = req.body ?? {};

    if (!cid || typeof cid !== "string" || cid.length > 50) {
      res.status(400).json({ error: "Missing or invalid field: cid (max 50 chars)" });
      return;
    }
    if (!businessName || typeof businessName !== "string" || businessName.length > 200) {
      res.status(400).json({ error: "Missing or invalid field: businessName (max 200 chars)" });
      return;
    }
    if (!VALID_REASONS.includes(reason)) {
      res.status(400).json({ error: `Invalid reason. Must be one of: ${VALID_REASONS.join(", ")}` });
      return;
    }
    if (details !== undefined && (typeof details !== "string" || details.length > 1000)) {
      res.status(400).json({ error: "details must be a string under 1000 characters" });
      return;
    }

    if (websiteUrl !== undefined && websiteUrl !== null && (typeof websiteUrl !== "string" || websiteUrl.length > 500)) {
      res.status(400).json({ error: "websiteUrl must be a string under 500 characters" });
      return;
    }

    const reportRef = db.collection("reports").doc();
    await reportRef.set({
      cid,
      businessName,
      websiteUrl: websiteUrl ?? null,
      reason,
      details: details ?? null,
      uid: decodedToken.uid,
      createdAt: FieldValue.serverTimestamp(),
      status: "open",
    });

    console.log(`[submitReport] Report ${reportRef.id} created by uid=${decodedToken.uid} for cid=${cid}`);
    res.status(200).json({ reportId: reportRef.id });
  });
});

// ─── Admin: List Reports (grouped by business) ───────────────────────────────

export const getAdminReports = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "getAdminReports");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({ error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required." });
      return;
    }

    try {
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "all";
      let query: admin.firestore.Query = db.collection("reports").orderBy("createdAt", "desc");
      if (statusFilter === "open" || statusFilter === "closed") {
        query = query.where("status", "==", statusFilter);
      }

      const snap = await query.limit(500).get();

      // Group by cid
      const grouped: Record<string, {
        cid: string;
        businessName: string;
        websiteUrl: string | null;
        reportCount: number;
        openCount: number;
        reasons: Record<string, number>;
        reports: Array<{
          id: string;
          reason: string;
          details: string | null;
          uid: string;
          status: string;
          createdAt: number | null;
        }>;
        latestAt: number | null;
      }> = {};

      // Collect unique uids to resolve emails
      const uids = new Set<string>();
      snap.docs.forEach((doc) => {
        const d = doc.data();
        if (d.uid) uids.add(d.uid);
      });

      // Batch-fetch user emails from Auth
      const emailMap: Record<string, string> = {};
      const uidArr = Array.from(uids);
      for (let i = 0; i < uidArr.length; i += 100) {
        const batch = uidArr.slice(i, i + 100).map((uid) => ({ uid }));
        const result = await admin.auth().getUsers(batch);
        result.users.forEach((u) => { emailMap[u.uid] = u.email ?? u.uid; });
      }

      snap.docs.forEach((doc) => {
        const d = doc.data();
        const cid: string = d.cid;
        const ts = d.createdAt as admin.firestore.Timestamp | null;
        const createdAtMs = ts ? ts.toMillis() : null;

        if (!grouped[cid]) {
          grouped[cid] = {
            cid,
            businessName: d.businessName,
            websiteUrl: d.websiteUrl ?? null,
            reportCount: 0,
            openCount: 0,
            reasons: {},
            reports: [],
            latestAt: null,
          };
        }

        const g = grouped[cid];
        g.reportCount++;
        if (d.status === "open") g.openCount++;
        g.reasons[d.reason] = (g.reasons[d.reason] ?? 0) + 1;
        if (createdAtMs && (g.latestAt === null || createdAtMs > g.latestAt)) g.latestAt = createdAtMs;

        g.reports.push({
          id: doc.id,
          reason: d.reason,
          details: d.details ?? null,
          uid: emailMap[d.uid] ?? d.uid,
          status: d.status,
          createdAt: createdAtMs,
        });
      });

      res.status(200).json({ groups: Object.values(grouped).sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0)) });
    } catch (err) {
      console.error("[getAdminReports] error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
});

// ─── Admin: Update Report Status ─────────────────────────────────────────────

export const updateReportStatus = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "updateReportStatus");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({ error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required." });
      return;
    }

    const { reportId, status } = req.body ?? {};
    if (!reportId || typeof reportId !== "string") { res.status(400).json({ error: "Missing reportId" }); return; }
    if (status !== "open" && status !== "closed") { res.status(400).json({ error: 'status must be "open" or "closed"' }); return; }

    await db.collection("reports").doc(reportId).update({ status });
    console.log(`[updateReportStatus] reportId=${reportId} status=${status}`);
    res.status(200).json({ success: true });
  });
});

// ─── Set User Role: admin-only endpoint to assign roles ──────────────────────

export const setUserRole = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    // ── Method check ──
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    // ── Admin auth check ──
    try {
      await verifyAdmin(req, "setUserRole");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "UNAUTHENTICATED") {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
      } else {
        res.status(403).json({ error: "Forbidden. Admin role required." });
      }
      return;
    }

    // ── Validate role ──
    const { uid, role } = req.body ?? {};
    if (!uid || typeof uid !== "string" || uid.length > 128) {
      res.status(400).json({ error: "Missing or invalid field: uid" });
      return;
    }
    if (role !== "user" && role !== "admin") {
      res.status(400).json({ error: 'Invalid role value. Must be "user" or "admin".' });
      return;
    }

    // ── Set custom claim and revoke tokens ──
    await admin.auth().setCustomUserClaims(uid, { role });
    await admin.auth().revokeRefreshTokens(uid);

    console.log(`[setUserRole] uid=${uid} role=${role}`);
    res.status(200).json({ success: true, uid, role });
  });
});

// ─── Admin Stats: aggregate search + business data across all users ───────────

export const getAdminStats = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      await verifyAdmin(req, "getAdminStats");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "UNAUTHENTICATED") {
        res.status(401).json({ error: "Unauthorized. Please sign in." });
      } else {
        res.status(403).json({ error: "Forbidden. Admin role required." });
      }
      return;
    }

    try {
      const [userCount] = await Promise.all([
        db.collection(USERS_COLLECTION).count().get(),
      ]);

      res.status(200).json({
        totalUsers: userCount.data().count,
        lastUpdated: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[getAdminStats] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
});

// ─── Admin: Audit Dead Sites — run pipeline on reported businesses, return CSV ─

export const createCheckoutSession = functions
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const { priceId } = req.body ?? {};

    // Validate priceId against plans collection
    const priceToplan = await buildPriceIdToPlanMap();
    if (!priceId || !priceToplan.has(priceId)) {
      res.status(400).json({ error: "Invalid plan selected" });
      return;
    }

    // Read user profile
    const userRef = db.collection(USERS_COLLECTION).doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userData = userSnap.data()!;
    let stripeCustomerId: string = userData.subscription?.stripeCustomerId ?? null;

    // Guard: checkout is for free → paid upgrades only.
    // Paid → lower-paid downgrades must go through changeSubscription (which uses
    // proration_behavior: "none" and schedules the change at period end).
    // Use sortOrder from the plans collection so this is resilient to plan additions/reordering.
    const targetPlan = priceToplan.get(priceId)!;
    const currentPlan = (userData.subscription?.plan ?? "free") as SubscriptionPlan;
    const allPlans = await getAllPlans();
    const currentSortOrder = allPlans.get(currentPlan)?.sortOrder ?? 0;
    const targetSortOrder = allPlans.get(targetPlan as SubscriptionPlan)?.sortOrder ?? 0;
    if (currentSortOrder > 0 && targetSortOrder <= currentSortOrder) {
      // User is on a paid plan and trying to go to the same or lower tier via checkout.
      // Reject — they must use the downgrade flow.
      res.status(400).json({ error: "Use the downgrade option to switch to a lower plan." });
      return;
    }

    // Create Stripe Customer if not exists
    if (!stripeCustomerId) {
      const customer = await getStripe().customers.create({
        email: userData.email ?? undefined,
        metadata: { uid },
      });
      stripeCustomerId = customer.id;
      await userRef.update({ "subscription.stripeCustomerId": stripeCustomerId });
    }

    // Create checkout session
    const { promoCode, existingSubscriptionId } = req.body ?? {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionParams: any = {
      customer: stripeCustomerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${FRONTEND_URL}/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/billing`,
      // Store old subscription id so the webhook can cancel it after the new one activates
      metadata: { uid, existingSubscriptionId: existingSubscriptionId ?? "" },
      allow_promotion_codes: !promoCode,
    };
    if (promoCode) {
      // Validate and pre-apply the promo code
      const promoCodes = await getStripe().promotionCodes.list({ code: promoCode, active: true, limit: 1 });
      if (promoCodes.data.length > 0) {
        sessionParams.discounts = [{ promotion_code: promoCodes.data[0].id }];
        sessionParams.allow_promotion_codes = false;
      } else {
        res.status(400).json({ error: "Invalid or expired promo code." });
        return;
      }
    }
    const session = await getStripe().checkout.sessions.create(sessionParams);

    res.status(200).json({ url: session.url });
  });
});

// ─── Portal Configuration Cache ──────────────────────────────────────────────
// We create a portal configuration with subscription updates enabled so that
// flow_data[type]=subscription_update_confirm works for paid→paid upgrades.
// The config is cached in Firestore to avoid recreating it on every request.

const PORTAL_CONFIG_DOC = "admin/stripePortalConfigId";

async function getOrCreatePortalConfig(): Promise<string> {
  // Check Firestore cache first
  const snap = await db.doc(PORTAL_CONFIG_DOC).get();
  if (snap.exists && snap.data()?.configId) {
    const cachedId = snap.data()!.configId as string;
    // Validate the cached config still has subscription_update enabled with correct proration
    try {
      const existing = await getStripe().billingPortal.configurations.retrieve(cachedId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subUpdate = (existing.features as any).subscription_update;
      if (subUpdate?.enabled === true && subUpdate?.proration_behavior === "none") {
        return cachedId;
      }
      console.warn(`[portal] Cached config ${cachedId} has wrong settings — recreating`);
    } catch (err) {
      console.warn(`[portal] Could not retrieve cached config ${cachedId} — recreating`, err);
    }
  }

  // Build the list of all paid price IDs for the subscription_update products list
  const allPlans = await getAllPlans();
  const products: { product: string; prices: string[] }[] = [];
  const productPriceMap = new Map<string, string[]>();

  for (const plan of allPlans.values()) {
    if (!plan.stripePriceId) continue; // skip free plan
    // Fetch the price to get its product ID
    const price = await getStripe().prices.retrieve(plan.stripePriceId);
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    if (!productPriceMap.has(productId)) productPriceMap.set(productId, []);
    productPriceMap.get(productId)!.push(plan.stripePriceId);
    if (plan.stripePriceIdAnnual) {
      productPriceMap.get(productId)!.push(plan.stripePriceIdAnnual);
    }
  }

  for (const [product, prices] of productPriceMap) {
    products.push({ product, prices });
  }

  const config = await getStripe().billingPortal.configurations.create({
    business_profile: {
      headline: "Manage your subscription",
    },
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        proration_behavior: "none",
        products,
      },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
      },
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
    },
  });

  // Cache the config ID in Firestore
  await db.doc(PORTAL_CONFIG_DOC).set({ configId: config.id, createdAt: FieldValue.serverTimestamp() });
  console.log(`[portal] Created portal config ${config.id}`);
  return config.id;
}

export const createPortalSession = functions
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userData = userSnap.data()!;
    const stripeCustomerId: string | null = userData.subscription?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      res.status(400).json({ error: "No active subscription to manage" });
      return;
    }

    const { priceId } = req.body ?? {};

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionParams: any = {
      customer: stripeCustomerId,
      return_url: `${FRONTEND_URL}/billing`,
    };

    if (priceId) {
      // Upgrade flow: deep-link to the subscription_update_confirm screen.
      // The user sees exactly what they'll be charged (prorated diff) and must
      // explicitly confirm before any charge occurs.
      const stripeSubscriptionId: string | null = userData.subscription?.stripeSubscriptionId ?? null;
      if (!stripeSubscriptionId) {
        res.status(400).json({ error: "No active subscription to upgrade" });
        return;
      }

      const stripeSub = await getStripe().subscriptions.retrieve(stripeSubscriptionId);
      const itemId = stripeSub.items.data[0]?.id;
      if (!itemId) {
        res.status(500).json({ error: "Could not retrieve subscription item" });
        return;
      }

      // Ensure portal config with subscription_update enabled exists
      const configId = await getOrCreatePortalConfig();
      sessionParams.configuration = configId;
      sessionParams.flow_data = {
        type: "subscription_update_confirm",
        after_completion: {
          type: "redirect",
          redirect: { return_url: `${FRONTEND_URL}/billing?upgraded=1` },
        },
        subscription_update_confirm: {
          subscription: stripeSubscriptionId,
          items: [{ id: itemId, price: priceId, quantity: 1 }],
        },
      };
    }

    try {
      const session = await getStripe().billingPortal.sessions.create(sessionParams);
      res.status(200).json({ url: session.url });
    } catch (err: any) {
      const stripeMsg = err?.raw?.message ?? err?.message ?? "Unknown Stripe error";
      console.error(`[createPortalSession] Stripe error: ${stripeMsg}`, err?.raw ?? err);
      res.status(500).json({ error: stripeMsg });
    }
  });
});

// ─── Get Invoice History ──────────────────────────────────────────────────────

export const getInvoices = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    const stripeCustomerId: string | null = userSnap.data()?.subscription?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      res.status(200).json({ invoices: [] });
      return;
    }

    const invoices = await getStripe().invoices.list({
      customer: stripeCustomerId,
      limit: 24,
      expand: ["data.charge"],
    });

    const result = invoices.data.map((inv) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const invAny = inv as any;
      const charge = invAny.charge;
      return {
        id: inv.id,
        number: inv.number,
        status: inv.status,
        amountPaid: inv.amount_paid,
        amountDue: inv.amount_due,
        currency: inv.currency,
        created: inv.created,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        refunded: charge?.refunded ?? false,
        amountRefunded: charge?.amount_refunded ?? 0,
      };
    });

    res.status(200).json({ invoices: result });
  });
});

// ─── Change Subscription (Downgrade / Upgrade in-place) ──────────────────────

export const changeSubscription = functions
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;

    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userData = userSnap.data()!;
    const stripeCustomerId: string | null = userData.subscription?.stripeCustomerId ?? null;
    if (!stripeCustomerId) {
      res.status(400).json({ error: "No active subscription to manage" });
      return;
    }

    // Redirect to the Stripe Customer Portal's subscription update screen
    // where the user can pick a lower plan. The portal config has all paid
    // plans listed, so the user sees downgrade options. Stripe handles
    // end-of-cycle scheduling natively.
    try {
      const configId = await getOrCreatePortalConfig();
      const stripeSubscriptionId: string | null = userData.subscription?.stripeSubscriptionId ?? null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessionParams: any = {
        customer: stripeCustomerId,
        return_url: `${FRONTEND_URL}/billing`,
        configuration: configId,
      };

      // If we have a subscription, deep-link to the subscription_update flow
      // so the user lands directly on the plan picker instead of the generic portal.
      if (stripeSubscriptionId) {
        sessionParams.flow_data = {
          type: "subscription_update",
          after_completion: {
            type: "redirect",
            redirect: { return_url: `${FRONTEND_URL}/billing` },
          },
          subscription_update: {
            subscription: stripeSubscriptionId,
          },
        };
      }

      const session = await getStripe().billingPortal.sessions.create(sessionParams);
      res.status(200).json({ url: session.url });
    } catch (err: any) {
      const stripeMsg = err?.raw?.message ?? err?.message ?? "Unknown Stripe error";
      console.error(`[changeSubscription] Stripe error: ${stripeMsg}`, err?.raw ?? err);
      res.status(500).json({ error: stripeMsg });
    }
  });
});

// ─── Cancel Subscription ──────────────────────────────────────────────────────

export const cancelSubscription = functions
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const stripeSubscriptionId: string | null = userSnap.data()?.subscription?.stripeSubscriptionId ?? null;
    if (!stripeSubscriptionId) {
      res.status(400).json({ error: "No active subscription to cancel" });
      return;
    }

    // Only allow cancellation when the subscription is in a cancellable state.
    // Blocking on past_due prevents interfering with dunning recovery.
    const currentStatus: string = userSnap.data()?.subscription?.status ?? "active";
    if (!["active", "trialing"].includes(currentStatus)) {
      res.status(409).json({ error: `Cannot cancel a subscription with status "${currentStatus}". Please update your payment method first.` });
      return;
    }

    // Idempotency: if already set to cancel, nothing to do.
    const alreadyCancelling: boolean = userSnap.data()?.subscription?.cancelAtPeriodEnd ?? false;
    if (alreadyCancelling) {
      res.status(200).json({ success: true, alreadyCancelling: true });
      return;
    }

    const { reason } = req.body ?? {};

    // Sanitize reason: strip non-printable characters, collapse whitespace, cap length.
    function sanitizeCancelReason(raw: unknown): string | null {
      if (!raw || typeof raw !== "string") return null;
      return raw
        .replace(/[^\x20-\x7E]/g, "") // printable ASCII only
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200) || null;
    }
    const sanitizedReason = sanitizeCancelReason(reason);

    // Cancel at period end — user keeps access until billing cycle ends
    await getStripe().subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Optimistically update Firestore so UI reflects immediately; store reason for analytics
    const update: Record<string, unknown> = {
      "subscription.cancelAtPeriodEnd": true,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (sanitizedReason) {
      update["subscription.cancelReason"] = sanitizedReason;
    }
    await db.collection(USERS_COLLECTION).doc(uid).update(update);

    res.status(200).json({ success: true });
  });
});

// ─── Reactivate Subscription (undo cancel) ────────────────────────────────────

export const reactivateSubscription = functions
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized. Please sign in." });
      return;
    }

    const uid = decodedToken.uid;
    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const stripeSubscriptionId: string | null = userSnap.data()?.subscription?.stripeSubscriptionId ?? null;
    if (!stripeSubscriptionId) {
      res.status(400).json({ error: "No active subscription to reactivate" });
      return;
    }

    // Only allow reactivation when the subscription is actually pending cancellation.
    const isCancellingAtPeriodEnd: boolean = userSnap.data()?.subscription?.cancelAtPeriodEnd ?? false;
    if (!isCancellingAtPeriodEnd) {
      res.status(409).json({ error: "Subscription is not pending cancellation." });
      return;
    }

    await getStripe().subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    await db.collection(USERS_COLLECTION).doc(uid).update({
      "subscription.cancelAtPeriodEnd": false,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(200).json({ success: true });
  });
});

// ─── Sync Subscription (called on login to reconcile Stripe → Firestore) ─────

export const syncSubscription = functions
  .runWith({ timeoutSeconds: 30 })
  .https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await verifyUserRole(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const uid = decodedToken.uid;

    // Rate-limit syncSubscription — it hits Stripe on every call.
    // 1 call per minute per user is more than enough for a login-time sync.
    const rlReset = await checkRateLimit(uid, "syncSubscription", 1);
    if (rlReset !== null) {
      // Soft-fail: return 200 so the client doesn't surface an error to the user.
      // The Firestore profile is already up-to-date from the last sync.
      console.log(`[syncSubscription] rate-limited uid=${uid} — skipping Stripe call`);
      res.status(200).json({ synced: false, reason: "rate_limited" });
      return;
    }

    const userSnap = await db.collection(USERS_COLLECTION).doc(uid).get();
    if (!userSnap.exists) { res.status(404).json({ error: "User not found" }); return; }

    const userData = userSnap.data()!;
    const stripeCustomerId: string | null = userData.subscription?.stripeCustomerId ?? null;

    // No Stripe customer → nothing to sync, they're on free
    if (!stripeCustomerId) {
      res.status(200).json({ synced: false, reason: "no_customer" });
      return;
    }

    // Fetch all active/trialing subscriptions for this customer
    const subs = await getStripe().subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 10,
      expand: ["data.items.data.price"],
    });

    // Find the most relevant subscription: active > trialing > past_due, ignore cancelled
    const priority = ["active", "trialing", "past_due"];
    const activeSub = subs.data
      .filter((s) => priority.includes(s.status))
      .sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0] ?? null;

    if (!activeSub) {
      // No active subscription in Stripe — ensure Firestore reflects free.
      // Guard: if the user cancelled but is still within their paid period
      // (cancelAtPeriodEnd=true and currentPeriodEnd is in the future), do NOT
      // downgrade yet. The customer.subscription.deleted webhook will handle it
      // when the period actually ends.
      const currentPlan = userData.subscription?.plan ?? "free";
      const cancelAtPeriodEnd: boolean = userData.subscription?.cancelAtPeriodEnd ?? false;
      const periodEndTs = userData.subscription?.currentPeriodEnd as admin.firestore.Timestamp | null | undefined;
      const periodEndMs = periodEndTs?.toMillis?.() ?? 0;
      const stillInPaidPeriod = cancelAtPeriodEnd && periodEndMs > Date.now();

      if (currentPlan !== "free" && !stillInPaidPeriod) {
        await downgradeToFree(uid);
        console.log(`[syncSubscription] uid=${uid} no active Stripe sub → downgraded to free`);
      } else if (stillInPaidPeriod) {
        console.log(`[syncSubscription] uid=${uid} cancelled but still in paid period until ${new Date(periodEndMs).toISOString()} — skipping downgrade`);
      }
      res.status(200).json({ synced: true, plan: stillInPaidPeriod ? currentPlan : "free" });
      return;
    }

    const priceId = activeSub.items.data[0]?.price?.id;
    const priceToplan = await buildPriceIdToPlanMap();
    const plan = (priceToplan.get(priceId ?? "") ?? "free") as SubscriptionPlan;
    const status = mapStripeStatus(activeSub.status);
    const item = activeSub.items.data[0] as unknown as { current_period_start: number; current_period_end: number };

    await updateSubscription(uid, plan, {
      id: activeSub.id,
      cancel_at_period_end: activeSub.cancel_at_period_end,
      current_period_start: item.current_period_start,
      current_period_end: item.current_period_end,
    }, status);

    console.log(`[syncSubscription] uid=${uid} synced plan=${plan} status=${status} subId=${activeSub.id}`);
    res.status(200).json({ synced: true, plan, status });
  });
});

// ─── Stripe Webhook Helpers ───────────────────────────────────────────────────

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) {
  console.error("[Stripe] ❌ STRIPE_WEBHOOK_SECRET is not set");
}

async function lookupUidByCustomerId(stripeCustomerId: string): Promise<string | null> {
  const snap = await db.collection(USERS_COLLECTION)
    .where("subscription.stripeCustomerId", "==", stripeCustomerId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return snap.docs[0].id;
}

export function mapStripeStatus(stripeStatus: string): "active" | "past_due" | "cancelled" | "trialing" {
  switch (stripeStatus) {
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "cancelled";
    case "trialing": return "trialing";
    // Incomplete/unpaid/paused subscriptions are not fully active — treat as past_due
    // so access is restricted without fully cancelling the subscription.
    case "incomplete":
    case "incomplete_expired":
    case "unpaid":
    case "paused":
      return "past_due";
    default:
      console.warn(`[mapStripeStatus] Unknown Stripe status "${stripeStatus}" — defaulting to past_due`);
      return "past_due";
  }
}

async function updateSubscription(
  uid: string,
  plan: import("./types").SubscriptionPlan,
  stripeSubscription: { id: string; cancel_at_period_end: boolean; current_period_start: number; current_period_end: number },
  status: "active" | "past_due" | "cancelled" | "trialing"
): Promise<void> {
  const creditsTotal = await getPlanCredits(plan);
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.plan": plan,
    "subscription.status": status,
    "subscription.creditsTotal": creditsTotal,
    "subscription.stripeSubscriptionId": stripeSubscription.id,
    "subscription.cancelAtPeriodEnd": stripeSubscription.cancel_at_period_end,
    "subscription.currentPeriodStart": Timestamp.fromMillis(stripeSubscription.current_period_start * 1000),
    "subscription.currentPeriodEnd": Timestamp.fromMillis(stripeSubscription.current_period_end * 1000),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function downgradeToFree(uid: string): Promise<void> {
  const creditsTotal = await getPlanCredits("free");
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.plan": "free",
    "subscription.status": "cancelled",
    // Reset to free plan limits. creditsUsed is zeroed because this function is only
    // called when the subscription has actually ended (customer.subscription.deleted webhook,
    // or syncSubscription confirming no active sub after the paid period has expired).
    // Users who cancelled but are still in their paid period are protected by the
    // stillInPaidPeriod guard in syncSubscription.
    "subscription.creditsTotal": creditsTotal,
    "subscription.creditsUsed": 0,
    "subscription.stripeSubscriptionId": null,
    "subscription.cancelAtPeriodEnd": false,
    "subscription.currentPeriodStart": null,
    "subscription.currentPeriodEnd": null,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// plan is passed in from the invoice's subscription price to avoid a race with
// customer.subscription.updated firing at the same time and writing a different plan.
async function resetCredits(uid: string, invoice: { period_start: number; period_end: number }, plan: import("./types").SubscriptionPlan): Promise<void> {
  const creditsTotal = await getPlanCredits(plan);
  await db.collection(USERS_COLLECTION).doc(uid).update({
    "subscription.creditsUsed": 0,
    "subscription.creditsTotal": creditsTotal,
    "subscription.currentPeriodStart": Timestamp.fromMillis(invoice.period_start * 1000),
    "subscription.currentPeriodEnd": Timestamp.fromMillis(invoice.period_end * 1000),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ─── Stripe Webhook ───────────────────────────────────────────────────────────

export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const sig = req.headers["stripe-signature"] as string | undefined;
  if (!sig) { res.status(400).send("Missing Stripe-Signature header"); return; }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = getStripe().webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET ?? "");
  } catch (err) {
    console.error("[stripeWebhook] Signature verification failed:", err);
    res.status(400).send("Invalid webhook signature");
    return;
  }

  try {
    // ── Idempotency guard ─────────────────────────────────────────────────────
    // Stripe delivers webhooks at-least-once. Use the event ID as a dedup key
    // with a 24-hour TTL so duplicate deliveries are silently acknowledged.
    const eventDocRef = db.collection("processedWebhookEvents").doc(event.id);
    const alreadyProcessed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(eventDocRef);
      if (snap.exists) return true;
      tx.set(eventDocRef, {
        type: event.type,
        processedAt: FieldValue.serverTimestamp(),
        // TTL field — configure a Firestore TTL policy on this field to auto-delete after 24h
        expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000),
      });
      return false;
    });
    if (alreadyProcessed) {
      console.log(`[stripeWebhook] Duplicate event ${event.id} (${event.type}) — skipping`);
      res.status(200).json({ received: true });
      return;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const session = event.data.object as any;
        const uid = session.metadata?.uid;
        if (!uid) { throw new Error(`[stripeWebhook] checkout.session.completed: missing uid in metadata`); }
        const stripeSubscriptionId = session.subscription as string;
        if (!stripeSubscriptionId) { throw new Error(`[stripeWebhook] checkout.session.completed: missing subscription id`); }
        const subscription = await getStripe().subscriptions.retrieve(stripeSubscriptionId, {
          expand: ["items.data.price"],
        });
        const priceId = subscription.items.data[0]?.price?.id;
        if (!priceId) { throw new Error(`[stripeWebhook] checkout.session.completed: could not resolve priceId from subscription ${stripeSubscriptionId}`); }
        const priceToplan = await buildPriceIdToPlanMap();
        const plan = priceToplan.get(priceId);
        if (!plan) { throw new Error(`[stripeWebhook] Unknown priceId: ${priceId}`); }
        const item = subscription.items.data[0] as unknown as { current_period_start: number; current_period_end: number };
        await updateSubscription(uid, plan as SubscriptionPlan, {
          id: subscription.id,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_start: item.current_period_start,
          current_period_end: item.current_period_end,
        }, "active");

        // Cancel the old subscription if this was an upgrade from an existing plan
        const oldSubId = session.metadata?.existingSubscriptionId as string | undefined;
        if (oldSubId && oldSubId !== stripeSubscriptionId) {
          try {
            await getStripe().subscriptions.cancel(oldSubId);
            console.log(`[stripeWebhook] checkout.session.completed: cancelled old subscription ${oldSubId} after upgrade`);
          } catch (err) {
            // Non-fatal — old sub may already be cancelled
            console.warn(`[stripeWebhook] checkout.session.completed: failed to cancel old subscription ${oldSubId}`, err);
          }
        }

        console.log(`[stripeWebhook] checkout.session.completed uid=${uid} plan=${plan}`);
        break;
      }

      case "customer.subscription.updated": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        const uid = await lookupUidByCustomerId(subscription.customer as string);
        if (!uid) { throw new Error(`[stripeWebhook] customer.subscription.updated: uid not found for customer=${subscription.customer}`); }
        const priceId = subscription.items.data[0].price.id;
        const priceToplan2 = await buildPriceIdToPlanMap();
        const plan = (priceToplan2.get(priceId) ?? "free") as SubscriptionPlan;
        const status = mapStripeStatus(subscription.status);
        await updateSubscription(uid, plan, {
          id: subscription.id,
          cancel_at_period_end: subscription.cancel_at_period_end,
          current_period_start: subscription.items.data[0].current_period_start,
          current_period_end: subscription.items.data[0].current_period_end,
        }, status);
        console.log(`[stripeWebhook] customer.subscription.updated uid=${uid} plan=${plan} status=${status}`);
        break;
      }

      case "customer.subscription.deleted": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const subscription = event.data.object as any;
        const uid = await lookupUidByCustomerId(subscription.customer as string);
        if (!uid) { throw new Error(`[stripeWebhook] customer.subscription.deleted: uid not found for customer=${subscription.customer}`); }
        await downgradeToFree(uid);
        console.log(`[stripeWebhook] customer.subscription.deleted uid=${uid} → downgraded to free`);
        break;
      }

      case "invoice.payment_succeeded": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        if (invoice.billing_reason !== "subscription_cycle") break;
        const uid = await lookupUidByCustomerId(invoice.customer as string);
        if (!uid) { throw new Error(`[stripeWebhook] invoice.payment_succeeded: uid not found for customer=${invoice.customer}`); }
        // Resolve the plan from the invoice's subscription price — avoids a race
        // with customer.subscription.updated firing simultaneously.
        const invoicePriceId: string | undefined = invoice.lines?.data?.[0]?.price?.id;
        const priceToplanRenewal = await buildPriceIdToPlanMap();
        const renewalPlan = (invoicePriceId ? (priceToplanRenewal.get(invoicePriceId) ?? "free") : "free") as SubscriptionPlan;
        await resetCredits(uid, { period_start: invoice.period_start, period_end: invoice.period_end }, renewalPlan);
        console.log(`[stripeWebhook] invoice.payment_succeeded (renewal) uid=${uid} plan=${renewalPlan} credits reset`);
        break;
      }

      case "invoice.payment_failed": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const invoice = event.data.object as any;
        const uid = await lookupUidByCustomerId(invoice.customer as string);
        if (!uid) { throw new Error(`[stripeWebhook] invoice.payment_failed: uid not found for customer=${invoice.customer}`); }
        await db.collection(USERS_COLLECTION).doc(uid).update({
          "subscription.status": "past_due",
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Write a dunning notification so the UI can surface a banner
        await db.collection(USERS_COLLECTION).doc(uid).collection("notifications").add({
          type: "payment_failed",
          invoiceId: invoice.id,
          amountDue: invoice.amount_due,
          nextPaymentAttempt: invoice.next_payment_attempt ?? null,
          hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
          read: false,
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`[stripeWebhook] invoice.payment_failed uid=${uid} → past_due + notification written`);
        break;
      }

      case "charge.refunded": {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const charge = event.data.object as any;
        const uid = await lookupUidByCustomerId(charge.customer as string);
        if (!uid) { throw new Error(`[stripeWebhook] charge.refunded: uid not found for customer=${charge.customer}`); }

        const isFullRefund = charge.amount > 0 && charge.amount_refunded >= charge.amount;

        if (isFullRefund) {
          // Full refund → downgrade to free immediately and zero out credits.
          // The subscription deletion webhook may also fire, but downgradeToFree is idempotent.
          await downgradeToFree(uid);
          console.log(`[stripeWebhook] charge.refunded (full) uid=${uid} → downgraded to free, credits zeroed`);
        } else {
          // Partial refund → atomically restore credits proportional to the refund fraction.
          const refundFraction = charge.amount > 0 ? (charge.amount_refunded as number) / (charge.amount as number) : 0;
          const userRef = db.collection(USERS_COLLECTION).doc(uid);
          await db.runTransaction(async (tx) => {
            const snap = await tx.get(userRef);
            if (!snap.exists) return;
            const data = snap.data()!;
            const creditsTotal: number = data.subscription?.creditsTotal ?? 0;
            const creditsUsed: number = data.subscription?.creditsUsed ?? 0;
            const creditsToRestore = Math.round(creditsTotal * refundFraction);
            const newCreditsUsed = Math.max(0, creditsUsed - creditsToRestore);
            tx.update(userRef, {
              "subscription.creditsUsed": newCreditsUsed,
              updatedAt: FieldValue.serverTimestamp(),
            });
            console.log(`[stripeWebhook] charge.refunded (partial) uid=${uid} refundFraction=${refundFraction.toFixed(2)} creditsRestored=${creditsToRestore}`);
          });
        }
        break;
      }

      default:
        console.log(`[stripeWebhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("[stripeWebhook] Error processing event:", err);
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  res.status(200).json({ received: true });
});


// ─── FieldStack domain functions ─────────────────────────────────────────────
export * from "./fieldstack/projectFunctions";
export * from "./fieldstack/alertFunctions";
export * from "./fieldstack/orderFunctions";
export * from "./fieldstack/scheduleFunctions";

// ─── Admin: Migrate Legacy Subscription Plans ─────────────────────────────────

export const seedPlans = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    try {
      await verifyAdmin(req, "seedPlans");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      res.status(msg === "UNAUTHENTICATED" ? 401 : 403).json({
        error: msg === "UNAUTHENTICATED" ? "Unauthorized." : "Forbidden. Admin role required.",
      });
      return;
    }

    try {
      const seedData = buildPlanSeedData();
      const batch = db.batch();

      for (let i = 0; i < PLAN_IDS.length; i++) {
        const planId = PLAN_IDS[i];
        const data = seedData[i];
        const ref = db.collection("plans").doc(planId);
        // merge: true preserves any fields not in seed (e.g. manually set stripePriceId)
        batch.set(ref, { ...data, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }

      await batch.commit();
      invalidatePlanCache();

      console.log(`[seedPlans] seeded ${PLAN_IDS.length} plans`);
      res.status(200).json({ seeded: PLAN_IDS.length, plans: PLAN_IDS });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal server error";
      console.error("[seedPlans] error:", msg);
      res.status(500).json({ error: msg });
    }
  });
});
