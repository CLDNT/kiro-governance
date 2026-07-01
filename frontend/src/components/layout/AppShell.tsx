import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  LayoutDashboard,
  Settings,
  LogOut,
  Moon,
  Sun,
  ShieldCheck,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface NavItem {
  label: string;
  to: string;
  icon: typeof FolderOpen;
}

const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Projects', to: '/projects', icon: FolderOpen },
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Settings', to: '/settings', icon: Settings },
];

const ROLE_LABEL: Record<string, string> = {
  pm: 'PM',
  sa: 'SA',
  engineer: 'Engineer',
  leadership: 'Leadership',
  admin: 'Admin',
};

function initials(name: string | undefined): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function sectionLabel(pathname: string): string {
  if (pathname.startsWith('/dashboard')) return 'Dashboard';
  if (pathname.startsWith('/projects')) return 'Projects';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Home';
}

export default function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = (): void => {
    logout();
    navigate('/login', { replace: true });
  };

  const isActive = (to: string): boolean =>
    location.pathname === to || location.pathname.startsWith(`${to}/`);

  const section = sectionLabel(location.pathname);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        {/* Brand */}
        <SidebarHeader>
          <div className="flex items-center gap-3 px-1 py-1.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
                DeliverPro
              </span>
              <span className="text-[11px] text-sidebar-foreground/60">Delivery Governance</span>
            </div>
          </div>
        </SidebarHeader>

        {/* Navigation */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.label}>
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* User + controls */}
        <SidebarFooter>
          <div className="flex items-center gap-2 rounded-md p-1.5 group-data-[collapsible=icon]:justify-center">
            <Avatar className="h-8 w-8 border border-sidebar-border">
              <AvatarFallback className="bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {initials(user?.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium text-sidebar-foreground">
                {user?.name ?? 'Unknown user'}
              </span>
              <span className="truncate text-xs text-sidebar-foreground/60">{user?.email}</span>
            </div>
            {user?.role && (
              <Badge
                variant="secondary"
                className="shrink-0 group-data-[collapsible=icon]:hidden"
              >
                {ROLE_LABEL[user.role] ?? user.role}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex-1 justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:flex-none"
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
              <span className="group-data-[collapsible=icon]:hidden">
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              aria-label="Log out"
              className="shrink-0 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      {/* Main content */}
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <SidebarTrigger aria-label="Toggle sidebar" />
          <Separator orientation="vertical" className="h-6" />
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">DeliverPro</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="font-semibold text-foreground">{section}</span>
          </nav>
        </header>
        <main className={cn('flex-1 overflow-y-auto', 'p-4 sm:p-6 lg:p-8')}>{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
