import { google } from 'googleapis'
import { prisma } from './prisma'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.NEXT_PUBLIC_APP_URL
  ? `${process.env.NEXT_PUBLIC_APP_URL}/api/gmail/callback`
  : 'http://localhost:3001/api/gmail/callback'

export function getOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function getAuthUrl(state: string): string {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
  })
}

export async function getAuthenticatedClient(companyId: string) {
  const connection = await prisma.gmailConnection.findUnique({
    where: { companyId },
  })

  if (!connection) return null

  const client = getOAuth2Client()
  client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: connection.tokenExpiry.getTime(),
  })

  // Auto-refresh if expired
  if (connection.tokenExpiry < new Date()) {
    const { credentials } = await client.refreshAccessToken()
    await prisma.gmailConnection.update({
      where: { companyId },
      data: {
        accessToken: credentials.access_token!,
        tokenExpiry: new Date(credentials.expiry_date!),
      },
    })
    client.setCredentials(credentials)
  }

  return client
}

export interface EmailMessage {
  id: string
  threadId: string
  from: string
  fromEmail: string
  to: string
  subject: string
  snippet: string
  body: string
  date: Date
  hasAttachments: boolean
  attachmentNames: string[]
}

export async function fetchRecentEmails(
  companyId: string,
  hoursBack: number = 24,
  maxResults: number = 50
): Promise<EmailMessage[]> {
  const auth = await getAuthenticatedClient(companyId)
  if (!auth) return []

  const gmail = google.gmail({ version: 'v1', auth })

  const after = Math.floor((Date.now() - hoursBack * 60 * 60 * 1000) / 1000)
  const query = `after:${after}`

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults,
  })

  const messageIds = listRes.data.messages || []
  const emails: EmailMessage[] = []

  for (const msg of messageIds) {
    try {
      const detail = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id!,
        format: 'full',
      })

      const headers = detail.data.payload?.headers || []
      const getHeader = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || ''

      const fromRaw = getHeader('From')
      const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/)
      const from = fromMatch ? fromMatch[1].replace(/"/g, '').trim() : fromRaw
      const fromEmail = fromMatch ? fromMatch[2] : fromRaw

      // Extract body text
      let body = ''
      const payload = detail.data.payload
      if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      } else if (payload?.parts) {
        const textPart = payload.parts.find((p) => p.mimeType === 'text/plain')
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8')
        }
      }

      // Detect attachments
      const parts = payload?.parts || []
      const attachments = parts.filter((p) => p.filename && p.filename.length > 0)

      emails.push({
        id: msg.id!,
        threadId: msg.threadId!,
        from,
        fromEmail,
        to: getHeader('To'),
        subject: getHeader('Subject'),
        snippet: detail.data.snippet || '',
        body: body.slice(0, 3000), // Cap body size for Claude
        date: new Date(parseInt(detail.data.internalDate || '0')),
        hasAttachments: attachments.length > 0,
        attachmentNames: attachments.map((a) => a.filename || '').filter(Boolean),
      })
    } catch (e) {
      console.warn(`[gmail] Failed to fetch message ${msg.id}:`, e)
    }
  }

  return emails
}
