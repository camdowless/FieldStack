import { useState } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { WelcomeModal } from "@/components/WelcomeModal";
import { ChatPanel } from "@/components/fieldstack/ChatPanel";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar onOpenChat={() => setChatOpen(true)} />
        <main className="flex-1 overflow-auto min-w-0">
          {children}
        </main>
      </div>
      <WelcomeModal />
      <ChatPanel isOpen={chatOpen} onClose={() => setChatOpen(false)} />
    </SidebarProvider>
  );
}
