import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { submitSupportTicket, type SupportCategory } from "@/lib/api";

interface ContactSupportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: "billing", label: "Billing & subscription" },
  { value: "bug", label: "Bug or technical issue" },
  { value: "account", label: "Account & login" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" },
];

export function ContactSupportDialog({ open, onOpenChange }: ContactSupportDialogProps) {
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [category, setCategory] = useState<SupportCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [replyEmail, setReplyEmail] = useState(user?.email ?? profile?.email ?? "");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const reset = () => {
    setCategory("");
    setSubject("");
    setMessage("");
    setReplyEmail(user?.email ?? profile?.email ?? "");
    setLoading(false);
    setSubmitted(false);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleSubmit = async () => {
    if (!category || !subject.trim() || !message.trim()) return;
    setLoading(true);
    try {
      await submitSupportTicket({
        category,
        subject: subject.trim(),
        message: message.trim(),
        replyEmail: replyEmail.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      toast({ title: "Failed to send message", description: "Please try again or email us directly.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const isValid = !!category && subject.trim().length > 0 && message.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        {submitted ? (
          <div className="text-center space-y-4 py-4">
            <DialogHeader className="items-center">
              <DialogTitle>Message sent</DialogTitle>
              <DialogDescription>
                We got your message and will reply to{" "}
                <span className="font-medium text-foreground">
                  {replyEmail || "your email"}
                </span>{" "}
                as soon as possible.
              </DialogDescription>
            </DialogHeader>
            <Button className="w-full" onClick={() => handleClose(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Contact support</DialogTitle>
              <DialogDescription>
                Send us a message and we'll get back to you by email.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="support-category">Category</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as SupportCategory)}>
                  <SelectTrigger id="support-category">
                    <SelectValue placeholder="What's this about?" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="support-subject">Subject</Label>
                <Input
                  id="support-subject"
                  placeholder="Brief summary of your issue"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={150}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="support-message">Message</Label>
                <Textarea
                  id="support-message"
                  placeholder="Describe your issue or question in detail…"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={2000}
                  rows={5}
                />
                <p className="text-xs text-muted-foreground text-right">
                  {message.length}/2000
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="support-email">
                  Reply-to email{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="support-email"
                  type="email"
                  placeholder="you@example.com"
                  value={replyEmail}
                  onChange={(e) => setReplyEmail(e.target.value)}
                  maxLength={254}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => handleClose(false)} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!isValid || loading}>
                {loading ? "Sending…" : "Send message"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ContactSupportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <MessageSquare className="h-4 w-4" />
        Contact support
      </Button>
      <ContactSupportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
