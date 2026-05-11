# TEMPLATE_APP – Firebase Auth Email Templates

Three templates matching the TEMPLATE_APP brand (blue gradient, Inter font, clean card layout).

## Files

| File | Firebase template type |
|------|------------------------|
| `email-verification.html` | Email address verification |
| `password-reset.html` | Password reset |
| `mfa-enrollment.html` | Multi-factor auth (SMS/email OTP) |

## How to apply in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com) → select **YOUR_DEV_PROJECT_ID**
2. Navigate to **Authentication → Templates** (left sidebar)
3. For each template:
   - Click the pencil (edit) icon
   - Switch the editor to **HTML** mode
   - Paste the contents of the corresponding `.html` file
   - Update the **Subject line** (suggestions below)
   - Click **Save**

## Suggested subject lines

| Template | Subject |
|----------|---------|
| Email verification | `Verify your email – TEMPLATE_APP` |
| Password reset | `Reset your TEMPLATE_APP password` |
| MFA / sign-in code | `Your TEMPLATE_APP sign-in code` |

## Template variables

Firebase automatically replaces these placeholders:

| Placeholder | Used in |
|-------------|---------|
| `%LINK%` | email-verification, password-reset |
| `%OTP_CODE%` | mfa-enrollment |

> Note: Firebase's actual variable syntax in the console editor uses `%LINK%` for the action URL.
> Double-check the variable names shown in the console editor match — they may appear as `{{link}}` depending on your Firebase project region/version.
