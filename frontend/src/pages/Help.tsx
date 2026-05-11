import { HelpCircle, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContactSupportButton } from "@/components/ContactSupportDialog";
import { config } from "@/lib/config";

export default function Help() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <HelpCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Help &amp; Support</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Use the <strong className="text-foreground">Items</strong> page to create and manage your items.</p>
          <p>Manage your subscription and billing from the <strong className="text-foreground">Billing</strong> page.</p>
          <p>Update your profile and preferences in <strong className="text-foreground">Settings</strong>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact Support</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Have a question or running into an issue? Send us a message and we'll get back to you.
          </p>
          <ContactSupportButton />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="h-4 w-4 shrink-0" />
            <span>
              Or email us directly at{" "}
              <a
                href={`mailto:${config.supportEmail}`}
                className="text-primary underline underline-offset-4 hover:opacity-80"
              >
                {config.supportEmail}
              </a>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
