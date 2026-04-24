import { Link, useLocation } from "react-router-dom";
import { Search, LayoutDashboard, Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const location = useLocation();

  const navItems = [
    { to: "/", label: "Search", icon: Search },
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-lg">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-bg">
            <Search className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">
            Gimme<span className="gradient-text">Leads</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <Link key={item.to} to={item.to}>
              <Button
                variant={location.pathname === item.to ? "secondary" : "ghost"}
                size="sm"
                className={cn("gap-2", location.pathname === item.to && "font-semibold")}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Button>
            </Link>
          ))}
          <div className="ml-2 h-6 w-px bg-border" />
          <Button variant="ghost" size="sm" onClick={toggleTheme} className="ml-1 gap-2">
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            <span className="hidden sm:inline">{theme === "light" ? "Dark" : "Light"}</span>
          </Button>
        </nav>
      </div>
    </header>
  );
}
