import { Resend } from "resend";

let _resend: Resend | null = null;

function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set");
    _resend = new Resend(key);
  }
  return _resend;
}

const FROM = "GimmeLeads <noreply@gimmeleads.io>";

export async function sendVerificationEmail(to: string, link: string): Promise<void> {
  console.log(`[emailService] sendVerificationEmail to=${to} RESEND_API_KEY_SET=${!!process.env.RESEND_API_KEY} FROM=${FROM}`);
  const { verificationEmailHtml } = await import("./emailTemplates");
  console.log(`[emailService] HTML template loaded, sending via Resend…`);
  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: "Verify your email – GimmeLeads",
    html: verificationEmailHtml(link),
  });
  console.log(`[emailService] Resend response id=${result.data?.id ?? "none"} error=${result.error?.message ?? "none"}`);
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
  console.log(`[emailService] ✅ Verification email delivered to Resend id=${result.data?.id}`);
}

// Alias for callable resend flow
export const sendVerificationEmailToAddress = sendVerificationEmail;

export async function sendPasswordResetEmail(to: string, link: string): Promise<void> {
  console.log(`[emailService] sendPasswordResetEmail to=${to} RESEND_API_KEY_SET=${!!process.env.RESEND_API_KEY}`);
  const { passwordResetEmailHtml } = await import("./emailTemplates");
  const result = await getResend().emails.send({
    from: FROM,
    to,
    subject: "Reset your GimmeLeads password",
    html: passwordResetEmailHtml(link),
  });
  console.log(`[emailService] Resend response id=${result.data?.id ?? "none"} error=${result.error?.message ?? "none"}`);
  if (result.error) throw new Error(`Resend error: ${result.error.message}`);
  console.log(`[emailService] ✅ Password reset email delivered to Resend id=${result.data?.id}`);
}

export async function sendMfaEmail(to: string, otp: string): Promise<void> {
  const { mfaEmailHtml } = await import("./emailTemplates");
  const { error } = await getResend().emails.send({
    from: FROM,
    to,
    subject: "Your GimmeLeads sign-in code",
    html: mfaEmailHtml(otp),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
}
