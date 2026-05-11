#!/usr/bin/env npx ts-node
/**
 * scripts/init-project.ts
 *
 * Interactive project initializer. Run this once when starting a new project
 * from this template. It will:
 *
 *   1. Ask for your project name, URLs, and email
 *   2. Replace all TEMPLATE_APP placeholders across the codebase
 *   3. Generate a fresh .env file for the frontend
 *   4. Optionally reset git history to a clean first commit
 *
 * Usage:
 *   npx ts-node scripts/init-project.ts
 *
 * Or with plain Node (no ts-node needed - compiled version):
 *   node scripts/init-project.js
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { execSync } from "child_process";

const ROOT = path.resolve(__dirname, "..");

// ─── Helpers ─────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    rl.question(`${question} ${hint}: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (!a) resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function replaceInFile(filePath: string, replacements: Array<[string | RegExp, string]>): boolean {
  if (!fs.existsSync(filePath)) return false;
  let content = fs.readFileSync(filePath, "utf8");
  let changed = false;
  for (const [from, to] of replacements) {
    const next = content.replace(typeof from === "string" ? new RegExp(escapeRegex(from), "g") : from, to);
    if (next !== content) { content = next; changed = true; }
  }
  if (changed) fs.writeFileSync(filePath, content, "utf8");
  return changed;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceInDir(
  dir: string,
  replacements: Array<[string | RegExp, string]>,
  extensions: string[],
  skip: string[] = [],
): number {
  let count = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (skip.some((s) => full.includes(s))) continue;
    if (entry.isDirectory()) {
      count += replaceInDir(full, replacements, extensions, skip);
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      if (replaceInFile(full, replacements)) count++;
    }
  }
  return count;
}

function log(msg: string) { console.log(`  ${msg}`); }
function section(title: string) { console.log(`\n${"─".repeat(60)}\n  ${title}\n${"─".repeat(60)}`); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n  Firebase SaaS Template - Project Initializer\n");
  console.log("  This will replace all TEMPLATE_APP placeholders with your");
  console.log("  project details. It only touches text files - no destructive ops.\n");

  // ── Gather inputs ──────────────────────────────────────────────────────────

  section("Project Details");

  const appName = await ask("App name (e.g. MyApp)", "MyApp");
  const appUrl = await ask("Production URL (e.g. https://myapp.com)", "https://myapp.com");
  const supportEmail = await ask("Support email", `support@${new URL(appUrl).hostname}`);
  const emailFrom = await ask("Transactional email from address", `noreply@${new URL(appUrl).hostname}`);
  const firebaseProjectId = await ask("Firebase project ID (production)", "your-project-id");
  const firebaseDevProjectId = await ask("Firebase project ID (dev/staging)", `${firebaseProjectId}-dev`);

  section("Confirm");
  console.log(`  App name:        ${appName}`);
  console.log(`  URL:             ${appUrl}`);
  console.log(`  Support email:   ${supportEmail}`);
  console.log(`  Email from:      ${emailFrom}`);
  console.log(`  Firebase prod:   ${firebaseProjectId}`);
  console.log(`  Firebase dev:    ${firebaseDevProjectId}`);

  const confirmed = await askYesNo("\n  Proceed with these values?");
  if (!confirmed) { console.log("\n  Aborted.\n"); rl.close(); process.exit(0); }

  // ── File replacements ──────────────────────────────────────────────────────

  section("Replacing placeholders");

  const appNameSlug = appName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const hostname = new URL(appUrl).hostname;

  const replacements: Array<[string | RegExp, string]> = [
    ["TEMPLATE_APP", appName],
    ["YOUR_PROJECT_ID", firebaseProjectId],
    ["YOUR_DEV_PROJECT_ID", firebaseDevProjectId],
    ["your-project-id", firebaseProjectId],
    ["your-app.web.app", `${firebaseProjectId}.web.app`],
    ["support@example.com", supportEmail],
    ["noreply@example.com", emailFrom],
    ["example.com", hostname],
  ];

  const extensions = [".ts", ".tsx", ".js", ".mjs", ".json", ".html", ".md", ".yml", ".yaml", ".env", ".css"];
  const skip = ["node_modules", ".git", "dist", "lib", "bun.lock", "package-lock.json"];

  let totalFiles = 0;
  for (const dir of ["frontend/src", "functions/src", "functions/scripts", ".github", "landing-site"]) {
    totalFiles += replaceInDir(path.join(ROOT, dir), replacements, extensions, skip);
  }

  // Top-level files
  for (const file of [
    ".firebaserc", "firebase.json", ".env.example",
    "functions/.env.example", "functions/package.json",
    "frontend/index.html", "README.md", "ARCHITECTURE.md", "QUICKSTART.md",
  ]) {
    if (replaceInFile(path.join(ROOT, file), replacements)) totalFiles++;
  }

  log(`Updated ${totalFiles} files.`);

  // ── Generate frontend/.env ─────────────────────────────────────────────────

  section("Generating frontend/.env");

  const frontendEnvPath = path.join(ROOT, "frontend", ".env");
  const frontendEnvContent = `# Generated by scripts/init-project.ts
# Fill in your Firebase config values from the Firebase Console.

VITE_APP_VERSION=1.0.0
VITE_APP_NAME=${appName}
VITE_APP_URL=${appUrl}
VITE_SUPPORT_EMAIL=${supportEmail}

# Firebase Web App Config
# Firebase Console -> Project Settings -> General -> Your Apps -> Web App
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=${firebaseProjectId}.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=${firebaseProjectId}
VITE_FIREBASE_STORAGE_BUCKET=${firebaseProjectId}.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# Local dev only - printed by: firebase emulators:start --only functions
VITE_FUNCTIONS_URL=http://127.0.0.1:5001/${firebaseProjectId}/us-central1
`;

  fs.writeFileSync(frontendEnvPath, frontendEnvContent, "utf8");
  log(`Created frontend/.env`);

  // ── Generate functions/.env ────────────────────────────────────────────────

  section("Generating functions/.env");

  const functionsEnvPath = path.join(ROOT, "functions", ".env");
  const functionsEnvContent = `# Generated by scripts/init-project.ts
# Fill in your actual values before running locally or deploying.

APP_NAME=${appName}
APP_URL=${appUrl}
SUPPORT_EMAIL=${supportEmail}
EMAIL_FROM=${emailFrom}

CORS_ORIGIN=${appUrl},https://${firebaseProjectId}.web.app,https://${firebaseProjectId}.firebaseapp.com
FRONTEND_URL=${appUrl}

# Stripe - get from https://dashboard.stripe.com/apikeys
STRIPE_SECRET_KEY=sk_test_REPLACE_ME
STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME

# Stripe Price IDs - create in Stripe dashboard, then run: bun run seed:plans
STRIPE_PRICE_PRO=price_REPLACE_ME
STRIPE_PRICE_PRO_ANNUAL=price_REPLACE_ME
STRIPE_PRICE_AGENCY=price_REPLACE_ME
STRIPE_PRICE_AGENCY_ANNUAL=price_REPLACE_ME
STRIPE_PRICE_ENTERPRISE=price_REPLACE_ME
STRIPE_PRICE_ENTERPRISE_ANNUAL=price_REPLACE_ME

# Resend - get from https://resend.com/api-keys
RESEND_API_KEY=re_REPLACE_ME

# Backups (optional)
BACKUP_BUCKET=gs://${firebaseProjectId}-backups
`;

  fs.writeFileSync(functionsEnvPath, functionsEnvContent, "utf8");
  log(`Created functions/.env`);

  // ── Create project-specific Firebase env file ──────────────────────────────

  const projectEnvPath = path.join(ROOT, "functions", `.env.${firebaseProjectId}`);
  const projectEnvContent = `# Non-secret config deployed alongside functions for project: ${firebaseProjectId}
# Secrets (Stripe keys, Resend key, etc.) are injected by CI from GitHub Secrets.

APP_NAME=${appName}
APP_URL=${appUrl}
SUPPORT_EMAIL=${supportEmail}
EMAIL_FROM=${emailFrom}
CORS_ORIGIN=${appUrl},https://${firebaseProjectId}.web.app,https://${firebaseProjectId}.firebaseapp.com
FRONTEND_URL=${appUrl}
BACKUP_BUCKET=gs://${firebaseProjectId}-backups
`;

  fs.writeFileSync(projectEnvPath, projectEnvContent, "utf8");
  log(`Created functions/.env.${firebaseProjectId}`);

  // ── Git history reset ──────────────────────────────────────────────────────

  section("Git History");

  const resetGit = await askYesNo(
    "  Reset git history to a single clean initial commit? (recommended for new projects)",
    false,
  );

  if (resetGit) {
    const doubleConfirm = await askYesNo(
      "  This will permanently delete all existing commits. Are you sure?",
      false,
    );
    if (doubleConfirm) {
      try {
        execSync("git checkout --orphan temp-init", { cwd: ROOT, stdio: "pipe" });
        execSync("git add -A", { cwd: ROOT, stdio: "pipe" });
        execSync(`git commit -m "Initial commit: ${appName}"`, { cwd: ROOT, stdio: "pipe" });
        execSync("git branch -D template-extraction 2>/dev/null || true", { cwd: ROOT, stdio: "pipe" });
        execSync("git branch -m main", { cwd: ROOT, stdio: "pipe" });
        log("Git history reset. You are now on branch 'main' with a single initial commit.");
      } catch (err) {
        log(`Git reset failed: ${err instanceof Error ? err.message : String(err)}`);
        log("You can reset manually: git checkout --orphan new-main && git add -A && git commit -m 'Initial commit'");
      }
    } else {
      log("Git history preserved.");
    }
  } else {
    log("Git history preserved. You can reset it manually later if needed.");
  }

  // ── Done ───────────────────────────────────────────────────────────────────

  section("Done");
  console.log(`  ${appName} is ready. Next steps:\n`);
  console.log(`  1. Fill in Firebase config in frontend/.env`);
  console.log(`  2. Fill in Stripe keys in functions/.env`);
  console.log(`  3. Run: bun install (in both frontend/ and functions/)`);
  console.log(`  4. Run: firebase emulators:start`);
  console.log(`  5. Run: bun run dev (in frontend/)`);
  console.log(`\n  See QUICKSTART.md for the full setup guide.\n`);

  rl.close();
}

main().catch((err) => {
  console.error("\n  Error:", err.message);
  rl.close();
  process.exit(1);
});
