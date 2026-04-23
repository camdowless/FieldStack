import { Search, LayoutDashboard, Settings, LogOut, Sun, Sparkles, CreditCard, HelpCircle, History, ShieldAlert, Zap } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/hooks/useCredits";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Link } from "react-router-dom";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { title: "Search", url: "/", icon: Search },
  { title: "History", url: "/search-history", icon: History },
  { title: "Saved", url: "/dashboard", icon: LayoutDashboard },
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
  const { logout, user, role, profile } = useAuth();
  const { remaining, max, refreshDate } = useCredits();
  const displayName = profile?.displayName ?? user?.displayName ?? user?.email?.split("@")[0] ?? "User";
  const pct = max > 0 ? (remaining / max) * 100 : 0;
  const barColor = pct > 50 ? "bg-green-500" : pct >= 20 ? "bg-amber-500" : "bg-red-500";

  return (
    <Sidebar collapsible="icon">

      {/* ── Header ─────────────────────────────────────────── */}
      <SidebarHeader className="px-3 py-3">
        {collapsed ? (
          // Collapsed: just the trigger centered
          <div className="flex justify-center">
            <SidebarTrigger />
          </div>
        ) : (
          // Expanded: logo + trigger
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg gradient-bg">
                <Search className="h-5 w-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight whitespace-nowrap">
                Gimme<span className="gradient-text">Leads</span>
              </span>
            </div>
            <SidebarTrigger />
          </div>
        )}
      </SidebarHeader>

      {/* ── Nav ────────────────────────────────────────────── */}
      <SidebarContent>
        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Navigation</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          end
                          className={collapsed ? "flex justify-center px-0" : "hover:bg-muted/50"}
                          activeClassName="bg-muted text-primary font-medium"
                        >
                          <item.icon className={`h-4 w-4 shrink-0 ${!collapsed ? "mr-2" : ""}`} />
                          {!collapsed && <span>{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </TooltipTrigger>
                    {collapsed && <TooltipContent side="right">{item.title}</TooltipContent>}
                  </Tooltip>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!collapsed && <SidebarGroupLabel>Account</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {accountItems
                .filter((item) => item.title !== "System Admin" || role === "admin")
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            end
                            className={collapsed ? "flex justify-center px-0" : "hover:bg-muted/50"}
                            activeClassName="bg-muted text-primary font-medium"
                          >
                            <item.icon className={`h-4 w-4 shrink-0 ${!collapsed ? "mr-2" : ""}`} />
                            {!collapsed && <span>{item.title}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </TooltipTrigger>
                      {collapsed && <TooltipContent side="right">{item.title}</TooltipContent>}
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── Footer ─────────────────────────────────────────── */}
      <SidebarFooter className="p-3">
        <Separator className="mb-3" />

        {/* Avatar row */}
        <div className={`flex mb-3 ${collapsed ? "justify-center" : "items-center gap-3 px-2"}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-8 w-8 shrink-0 cursor-default">
                <AvatarFallback className="gradient-bg text-white text-sm font-semibold">
                  {displayName[0]?.toUpperCase() ?? "?"}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">{displayName}</TooltipContent>}
          </Tooltip>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{displayName}</p>
            </div>
          )}
        </div>

        {/* Credits bar — expanded only */}
        {!collapsed && (
          <div className="px-2 mb-3">
            <Link to="/billing" className="block group rounded-md hover:bg-muted/50 transition-colors -mx-1 px-1 py-1">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">Credits</span>
                <span className="text-xs font-medium tabular-nums">{remaining} / {max}</span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full transition-all ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              {refreshDate && (
                <p className="text-xs text-muted-foreground mt-1">Refreshes {refreshDate}</p>
              )}
            </Link>
            {remaining === 0 && (
              <Button size="sm" className="w-full mt-2 gap-1.5 text-xs h-7" asChild>
                <Link to="/billing">
                  <Zap className="h-3 w-3" /> Upgrade for more searches
                </Link>
              </Button>
            )}
            {remaining > 0 && pct <= 20 && (
              <p className="text-xs text-amber-500 mt-1.5 text-center">
                Running low —{" "}
                <Link to="/billing" className="underline underline-offset-2 hover:text-amber-600">
                  upgrade
                </Link>
              </p>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              className={`w-full gap-2 ${collapsed ? "justify-center px-0" : "justify-start"}`}
            >
              {theme === "light" ? <Sparkles className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
              {!collapsed && <span>{theme === "light" ? "Bold Theme" : "Light Theme"}</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">Toggle Theme</TooltipContent>}
        </Tooltip>

        {/* Logout */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className={`w-full gap-2 text-muted-foreground ${collapsed ? "justify-center px-0" : "justify-start"}`}
            >
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
