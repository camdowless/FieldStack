/**
 * FieldStack Settings — lead times, Gmail integration, SMS briefing.
 * Extends the base Settings page with FieldStack-specific tabs.
 */

import { useState } from "react";
import { useLeadTimes } from "@/hooks/useLeadTimes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Mail, MessageSquare, Clock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { apiUpdateLeadTimes, apiGetGmailStatus, apiDisconnectGmail, apiSendSmsBriefing } from "@/lib/fieldstackApi";
import type { LeadTimeSetting, ItemType } from "@/types/fieldstack";
import { ITEM_TYPE_LABELS } from "@/types/fieldstack";

const ITEM_TYPES: ItemType[] = ["CABINETS_STANDARD", "CABINETS_CUSTOM", "COUNTERTOPS", "HARDWARE"];

export default function FieldStackSettings() {
  return (
    <div className="p-6 max-w-2xl">
      <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Lead times, integrations, and notification preferences.</p>
      </motion.div>

      <Tabs defaultValue="lead-times">
        <TabsList className="mb-6">
          <TabsTrigger value="lead-times" className="gap-2">
            <Clock className="h-4 w-4" /> Lead Times
          </TabsTrigger>
          <TabsTrigger value="gmail" className="gap-2">
            <Mail className="h-4 w-4" /> Gmail
          </TabsTrigger>
          <TabsTrigger value="sms" className="gap-2">
            <MessageSquare className="h-4 w-4" /> SMS Briefing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lead-times">
          <LeadTimesSection />
        </TabsContent>

        <TabsContent value="gmail">
          <GmailSection />
        </TabsContent>

        <TabsContent value="sms">
          <SmsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Lead Times ───────────────────────────────────────────────────────────────

function LeadTimesSection() {
  const { leadTimes, loading } = useLeadTimes();
  const [values, setValues] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  function getWeeks(itemType: ItemType): number {
    if (values[itemType] !== undefined) return values[itemType];
    const lt = leadTimes.find((l) => l.itemType === itemType);
    return lt?.leadTimeWeeks ?? 8;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const settings = ITEM_TYPES.map((itemType) => ({
        itemType,
        leadTimeWeeks: getWeeks(itemType),
      }));
      await apiUpdateLeadTimes(settings);
      toast.success("Lead times saved.");
    } catch {
      toast.error("Failed to save lead times.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Default Lead Times</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Order-by dates are computed by subtracting the lead time from the install date. These are company-wide defaults; you can override per project.
        </p>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading...
          </div>
        ) : (
          <div className="space-y-3">
            {ITEM_TYPES.map((itemType) => (
              <div key={itemType} className="flex items-center justify-between gap-4">
                <Label className="text-sm flex-1">{ITEM_TYPE_LABELS[itemType]}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={52}
                    value={getWeeks(itemType)}
                    onChange={(e) => setValues((v) => ({ ...v, [itemType]: parseInt(e.target.value) || 1 }))}
                    className="w-20 h-8 text-sm text-center"
                  />
                  <span className="text-xs text-muted-foreground w-12">weeks</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving || loading} size="sm">
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Lead Times
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Gmail ────────────────────────────────────────────────────────────────────

function GmailSection() {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try {
      // Stub: redirect to Gmail OAuth
      toast.info("Gmail OAuth integration coming soon. This will redirect to Google's authorization page.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await apiDisconnectGmail();
      toast.success("Gmail disconnected.");
    } catch {
      toast.info("Gmail integration coming soon.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Gmail Integration</CardTitle>
          <Badge variant="outline" className="text-xs text-muted-foreground">Coming Soon</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Connect your Gmail account to automatically scan for schedule updates, RFIs, change orders, and delivery confirmations. Emails are classified by AI and appear in each project's Feed tab.
        </p>

        <div className="rounded-lg border border-dashed border-blue-400/30 bg-blue-500/5 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Mail className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-medium">Not connected</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Connect Gmail to enable automatic inbox scanning and AI email classification.
              </div>
            </div>
          </div>
          <Button variant="outline" onClick={handleConnect} disabled={connecting} className="gap-2 border-blue-400/40 text-blue-600">
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
            Connect Gmail Account
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold">What gets scanned</div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Schedule updates and lookahead changes</li>
            <li>• Delivery confirmations and shipping notices</li>
            <li>• Change orders and RFIs</li>
            <li>• Meeting notices and site visits</li>
            <li>• Payment requests and invoices</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SMS Briefing ─────────────────────────────────────────────────────────────

function SmsSection() {
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!phone.trim()) return;
    setSending(true);
    try {
      await apiSendSmsBriefing(phone.trim());
      toast.success("SMS briefing sent!");
    } catch {
      toast.info("SMS briefing coming soon. Requires Twilio configuration.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">SMS Daily Briefing</CardTitle>
          <Badge variant="outline" className="text-xs text-muted-foreground">Coming Soon</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Receive a daily SMS briefing with overdue tasks, upcoming deadlines, and orders that need attention. Powered by Twilio.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="sms-phone">Phone number</Label>
          <div className="flex gap-2">
            <Input
              id="sms-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={sending || !phone.trim()} className="gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
              Send Test
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Requires Twilio credentials in the backend environment variables.
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold">Briefing includes</div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>• Overdue task steps with days overdue</li>
            <li>• Upcoming deadlines this week</li>
            <li>• Orders that need to be placed</li>
            <li>• Recent schedule changes</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
