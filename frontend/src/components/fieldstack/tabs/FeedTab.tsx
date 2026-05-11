/**
 * FeedTab — activity feed from Gmail integration (stubbed).
 * Shows classified emails: schedule updates, RFIs, change orders, etc.
 */

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, RefreshCw, AlertCircle, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Timestamp } from "firebase/firestore";
import { format } from "date-fns";
import { apiScanGmail, apiGetGmailStatus } from "@/lib/fieldstackApi";
import type { FeedEntry } from "@/types/fieldstack";
import { FEED_TYPE_LABELS } from "@/types/fieldstack";

function feedTypeBadgeVariant(type: string): "default" | "secondary" | "destructive" | "outline" {
  if (type === "CHANGE_ORDER" || type === "ISSUE_REPORT") return "destructive";
  if (type === "SCHEDULE_UPDATE" || type === "RFI") return "secondary";
  return "outline";
}

interface Props {
  projectId: string;
  feed: FeedEntry[];
}

export function FeedTab({ projectId, feed }: Props) {
  const [scanning, setScanning] = useState(false);

  async function handleScan() {
    setScanning(true);
    try {
      const result = await apiScanGmail(24);
      toast.success(`Scanned inbox: ${result.saved} new entries added.`);
    } catch (err) {
      // Gmail not connected — show stub message
      toast.info("Gmail integration coming soon. Connect Gmail in Settings to enable inbox scanning.");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Activity Feed</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Emails classified by AI — schedule updates, RFIs, change orders, and more.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning} className="gap-1.5">
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Scan Inbox
        </Button>
      </div>

      {/* Gmail connection stub */}
      <Card className="border-dashed border-blue-400/30 bg-blue-500/5">
        <CardContent className="flex items-start gap-3 py-4 px-4">
          <Mail className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium text-blue-600 dark:text-blue-400">Gmail not connected</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Connect your Gmail account to automatically scan for schedule updates, RFIs, and change orders.
            </div>
            <Button size="sm" variant="outline" className="mt-2 gap-1.5 text-xs h-7 border-blue-400/40 text-blue-600" onClick={() => toast.info("Gmail OAuth integration coming soon.")}>
              <Mail className="h-3 w-3" /> Connect Gmail
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Feed entries */}
      {feed.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-sm text-muted-foreground">No feed entries yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Connect Gmail and scan your inbox to populate the feed.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {feed.map((entry) => (
            <FeedCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedCard({ entry }: { entry: FeedEntry }) {
  const date = entry.emailDate instanceof Timestamp
    ? format(entry.emailDate.toDate(), "MMM d, h:mm a")
    : "—";

  return (
    <Card className={entry.actionNeeded ? "border-yellow-400/40" : ""}>
      <CardContent className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge variant={feedTypeBadgeVariant(entry.type)} className="text-[10px] px-1.5 py-0">
                {FEED_TYPE_LABELS[entry.type] ?? entry.type}
              </Badge>
              {entry.actionNeeded && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-400/40">
                  <AlertCircle className="h-2.5 w-2.5 mr-1" /> Action needed
                </Badge>
              )}
            </div>
            <div className="text-sm font-medium truncate">{entry.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{entry.summary}</div>
            {entry.sender && (
              <div className="text-xs text-muted-foreground font-mono mt-1">From: {entry.sender}</div>
            )}
          </div>
          <div className="text-xs text-muted-foreground font-mono shrink-0">{date}</div>
        </div>
      </CardContent>
    </Card>
  );
}
