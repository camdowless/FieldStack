import { HelpCircle, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Help() {
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <HelpCircle className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Help & Support</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Use the <strong className="text-foreground">Home</strong> page to get started.</p>
          <p>Manage your subscription from the <strong className="text-foreground">Billing</strong> page.</p>
          <p>Update your account details under <strong className="text-foreground">Settings</strong>.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contact Support</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-sm">
          <Mail className="h-4 w-4 text-primary shrink-0" />
          <a
            href="mailto:support@yourapp.com"
            className="text-primary underline underline-offset-4 hover:opacity-80"
          >
            support@yourapp.com
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
