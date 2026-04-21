import { Search, LayoutDashboard, Settings, LogOut, Sun, Sparkles, CreditCard, HelpCircle, History, ShieldAlert } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/hooks/useCredits";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { title: "Lead Search", url: "/", icon: Search },
  { title: "Search History", url: "/search-history", icon: History },
  { title: "Saved Leads", url: "/dashboard", icon: LayoutDashboard },
];

const accountItems = [
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Help", url: "/help", icon: HelpCircle },
  { title: "System Admin", url: "/admin", icon: ShieldAlert },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { theme, toggleTheme } = useTheme();
  const { logout, user, role } = useAuth();
  const { remaining, max } = useCredits();
  const displayName = user?.displayName ?? user?.email?.split("@")[0] ?? "User";
  const pct = max > 0 ? (remaining / max) * 100 : 0;
  const barColor = pct > 50 ? "bg-green-500" : pct >= 20 ? "bg-amber-500" : "bg-red-500";

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-bg">
            <Search className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight whitespace-nowrap">
              Lead<span className="gradient-text">Scout</span>
            </span>
          )}
        </div>
      </SidebarHeader>



      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end className="hover:bg-muted/50" activeClassName="bg-muted text-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accountItems.filter(item => item.title !== "System Admin" || role === "admin").map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink to={item.url} end className="hover:bg-muted/50" activeClassName="bg-muted text-primary font-medium">
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3 overflow-hidden">
        <Separator className="mb-3" />
        <div className="flex items-center gap-3 px-2 mb-3 overflow-hidden">
          <Avatar className="h-9 w-9 shrink-0">
            <AvatarFallback className="gradient-bg text-white text-sm font-semibold">
              {displayName[0]?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{displayName}</p>
            </div>
          )}
        </div>
        {!collapsed && (
          <div className="px-2 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-muted-foreground">Credits</span>
              <span className="text-xs font-medium tabular-nums">
                {remaining} / {max}
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, pct)}%` }}
              />
            </div>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={toggleTheme} className="w-full justify-start gap-2">
              {theme === "light" ? <Sparkles className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
              {!collapsed && <span>{theme === "light" ? "Bold Theme" : "Light Theme"}</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Toggle Theme</TooltipContent>}
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-muted-foreground" onClick={logout}>
              <LogOut className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Log out</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Log out</TooltipContent>}
        </Tooltip>
      </SidebarFooter>
    </Sidebar>
  );
}
