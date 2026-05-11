import { Resend } from "resend";
import { logger } from "./logger";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

// Set APP_NAME and EMAIL_FROM in your functions/.env file.
// Example: APP_NAME=MyApp  EMAIL_FROM=noreply@myapp.com
const APP_NAME = process.env.APP_NAME ?? "App";
const FROM = `${APP_NAME} <${process.env.EMAIL_FROM ?? "noreply@example.com"}>`;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL ?? "support@example.com";

export async function sendVerificationEmail(to: string, link: string): Promise<void> {
  logger.info("sendVerificationEmail", { to, resendApiKeySet: !!process.env.RESEND_API_KEY });
  const { verificationEmailHtml } = await import("./emailTemplates");
  logger.info("HTML template loaded, sending via Resend");
  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: `Verify your email - ${APP_NAME}`,
    html: verificationEmailHtml(link),
  });
  logger.info("Resend response", { id: result.data?.id ?? "none", error: result.error?.message ?? "none" });
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
  logger.info("Verification email delivered", { id: result.data?.id });
}

// Alias for callable resend flow
export const sendVerificationEmailToAddress = sendVerificationEmail;

export async function sendPasswordResetEmail(to: string, link: string): Promise<void> {
  logger.info("sendPasswordResetEmail", { to, resendApiKeySet: !!process.env.RESEND_API_KEY });
  const { passwordResetEmailHtml } = await import("./emailTemplates");
  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: `Reset your ${APP_NAME} password`,
    html: passwordResetEmailHtml(link),
  });
  logger.info("Resend response", { id: result.data?.id ?? "none", error: result.error?.message ?? "none" });
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
  logger.info("Password reset email delivered", { id: result.data?.id });
}

export async function sendMfaEmail(to: string, otp: string): Promise<void> {
  const { mfaEmailHtml } = await import("./emailTemplates");
  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: `Your ${APP_NAME} sign-in code`,
    html: mfaEmailHtml(otp),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}

export async function sendSupportTicketEmail(params: {
  ticketId: string;
  uid: string;
  userEmail: string;
  replyEmail: string;
  category: string;
  subject: string;
  message: string;
}): Promise<void> {
  const { ticketId, uid, userEmail, replyEmail, category, subject, message } = params;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#111">New support ticket - ${escapeHtml(subject)}</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:6px 0;color:#555;width:120px">Ticket ID</td><td style="padding:6px 0">${escapeHtml(ticketId)}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Category</td><td style="padding:6px 0">${escapeHtml(category)}</td></tr>
        <tr><td style="padding:6px 0;color:#555">User UID</td><td style="padding:6px 0">${escapeHtml(uid)}</td></tr>
        <tr><td style="padding:6px 0;color:#555">User email</td><td style="padding:6px 0">${escapeHtml(userEmail)}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Reply to</td><td style="padding:6px 0">${escapeHtml(replyEmail)}</td></tr>
      </table>
      <hr style="margin:16px 0;border:none;border-top:1px solid #eee"/>
      <p style="font-size:14px;white-space:pre-wrap;color:#111">${escapeHtml(message)}</p>
    </div>
  `;

  const result = await getResend().emails.send({
    from: FROM,
    to: SUPPORT_EMAIL,
    replyTo: replyEmail,
    subject: `[Support] ${subject}`,
    html,
  });
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
  logger.info("Support ticket email sent", { id: result.data?.id, ticketId });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
