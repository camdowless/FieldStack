// ─── Shared layout ────────────────────────────────────────────────────────────

const BASE_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background-color: #f5f5f7;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
    color: #1a1f2e;
    -webkit-font-smoothing: antialiased;
  }
  .wrapper { max-width: 560px; margin: 48px auto; padding: 0 16px 48px; }
  .logo-bar { text-align: center; padding: 32px 0 24px; }
  .logo-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 12px;
    background: linear-gradient(135deg, #3b82f6, #0ea5e9); margin-bottom: 10px;
  }
  .logo-name { font-size: 18px; font-weight: 700; color: #1a1f2e; letter-spacing: -0.3px; }
  .card {
    background: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04);
  }
  .card-accent { height: 4px; background: linear-gradient(90deg, #3b82f6, #0ea5e9); }
  .card-body { padding: 40px 40px 36px; }
  .icon-wrap {
    width: 56px; height: 56px; border-radius: 50%; background: #eff6ff;
    display: flex; align-items: center; justify-content: center; margin-bottom: 24px;
  }
  h1 { font-size: 22px; font-weight: 700; color: #1a1f2e; letter-spacing: -0.4px; margin-bottom: 10px; }
  .subtitle { font-size: 15px; color: #6b7280; line-height: 1.6; margin-bottom: 32px; }
  .btn-wrap { text-align: center; margin-bottom: 32px; }
  .btn {
    display: inline-block; padding: 14px 36px;
    background: linear-gradient(135deg, #3b82f6, #0ea5e9);
    color: #ffffff !important; font-size: 15px; font-weight: 600;
    text-decoration: none; border-radius: 10px; letter-spacing: -0.1px;
  }
  .fallback {
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 16px; margin-bottom: 28px;
  }
  .fallback p { font-size: 12px; color: #9ca3af; margin-bottom: 6px; }
  .fallback a { font-size: 12px; color: #3b82f6; word-break: break-all; text-decoration: none; }
  .warning-box {
    display: flex; align-items: flex-start; gap: 10px;
    background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px;
    padding: 14px 16px; margin-bottom: 28px;
  }
  .warning-box p { font-size: 13px; color: #92400e; line-height: 1.5; }
  .divider { border: none; border-top: 1px solid #f3f4f6; margin: 0 0 24px; }
  .note { font-size: 13px; color: #9ca3af; line-height: 1.6; }
  .note strong { color: #6b7280; font-weight: 500; }
  .footer { text-align: center; padding-top: 28px; }
  .footer p { font-size: 12px; color: #9ca3af; line-height: 1.7; }
  .footer a { color: #9ca3af; text-decoration: underline; }
`;

const LOGO_SVG = `
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>`;

const FOOTER_HTML = `
  <div class="footer">
    <p>
      © ${new Date().getFullYear()} GimmeLeads · <a href="https://gimmeleads.io">gimmeleads.io</a><br/>
      <a href="https://gimmeleads.io/privacy.html">Privacy Policy</a> ·
      <a href="https://gimmeleads.io/tos.html">Terms of Service</a>
    </p>
  </div>`;

function layout(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrapper">
    <div class="logo-bar">
      <div class="logo-icon">${LOGO_SVG}</div>
      <div class="logo-name">GimmeLeads</div>
    </div>
    <div class="card">
      <div class="card-accent"></div>
      <div class="card-body">${body}</div>
    </div>
    ${FOOTER_HTML}
  </div>
</body>
</html>`;
}

// ─── Email Verification ───────────────────────────────────────────────────────

export function verificationEmailHtml(link: string): string {
  return layout(`
    <div class="icon-wrap">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="20" height="16" x="2" y="4" rx="2"/>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
      </svg>
    </div>
    <h1>Verify your email address</h1>
    <p class="subtitle">
      Thanks for signing up. Click the button below to confirm your email
      and activate your GimmeLeads account.
    </p>
    <div class="btn-wrap">
      <a href="${link}" class="btn">Verify my email</a>
    </div>
    <div class="fallback">
      <p>Button not working? Copy and paste this link into your browser:</p>
      <a href="${link}">${link}</a>
    </div>
    <hr class="divider"/>
    <p class="note">
      <strong>Didn't create an account?</strong> You can safely ignore this email.
      No account will be created without verification.
    </p>
  `);
}

// ─── Password Reset ───────────────────────────────────────────────────────────

export function passwordResetEmailHtml(link: string): string {
  return layout(`
    <div class="icon-wrap">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
    </div>
    <h1>Reset your password</h1>
    <p class="subtitle">
      We received a request to reset the password for your GimmeLeads account.
      Click the button below to choose a new one.
    </p>
    <div class="btn-wrap">
      <a href="${link}" class="btn">Reset my password</a>
    </div>
    <div class="warning-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <p>This link expires in <strong>1 hour</strong>. If it expires, you can request
      a new one from the sign-in page.</p>
    </div>
    <div class="fallback">
      <p>Button not working? Copy and paste this link into your browser:</p>
      <a href="${link}">${link}</a>
    </div>
    <hr class="divider"/>
    <p class="note">
      <strong>Didn't request this?</strong> Your password has not been changed.
      You can safely ignore this email — your account is secure.
    </p>
  `);
}

// ─── MFA / OTP ────────────────────────────────────────────────────────────────

export function mfaEmailHtml(otp: string): string {
  return layout(`
    <div class="icon-wrap">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3b82f6"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    </div>
    <h1>Your sign-in code</h1>
    <p class="subtitle">
      Use the code below to complete your sign-in to GimmeLeads.
    </p>
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase;
        letter-spacing:0.08em;margin-bottom:12px;">Verification code</div>
      <div style="display:inline-block;font-size:40px;font-weight:700;letter-spacing:0.18em;
        color:#1a1f2e;background:#f0f7ff;border:2px solid #bfdbfe;border-radius:12px;
        padding:16px 32px;">${otp}</div>
    </div>
    <div class="warning-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <p>This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
    </div>
    <hr class="divider"/>
    <p class="note">
      <strong>Didn't try to sign in?</strong> Someone may have your password.
      We recommend changing it immediately from the sign-in page.
    </p>
  `);
}
