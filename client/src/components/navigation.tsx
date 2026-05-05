import { Link, useLocation } from "wouter";
import { useState } from "react";
import { LogOut, User, Settings, Menu, X, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import SpectioLogo from "@/components/spectio-logo";

const ADMIN_PATHS = ["/admin", "/market-builder"];
const PUBLIC_NAV = [
  { href: "/platform", label: "Platform" },
  { href: "/markets", label: "Markets" },
  { href: "/about", label: "About Us" },
  { href: "/licensing", label: "Licensing" },
  { href: "/contact", label: "Contact" },
];

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdminArea = ADMIN_PATHS.some(p => location.startsWith(p));

  const handleLogout = async () => {
    try {
      await logout();
      toast({ title: "Signed out successfully" });
    } catch {
      toast({ title: "Failed to sign out", variant: "destructive" });
    }
  };

  const getUserInitials = () => {
    if (!user?.firstName || !user?.lastName) return "U";
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  };

  if (isAdminArea) {
    return (
      <nav className="bg-white/95 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-8">
              <Link href="/"><SpectioLogo variant="dark" /></Link>
              <span className="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Admin Panel</span>
            </div>
            <div className="flex items-center gap-3">
              {isAuthenticated && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.profileImageUrl || ""} />
                        <AvatarFallback>{getUserInitials()}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="p-2 border-b">
                      <p className="font-medium text-sm">{user?.firstName} {user?.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                    </div>
                    <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4" />Log out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </nav>
    );
  }

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#1e2130]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <SpectioLogo />
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {PUBLIC_NAV.map(({ href, label }) => (
                <Link key={href} href={href}>
                  <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                    location === href
                      ? "text-white bg-white/10"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}>{label}</span>
                </Link>
              ))}
              <Link href={isAuthenticated ? "/me/market-builder" : "/login"}>
                <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                  location.includes("market-builder") ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}>Market Builder</span>
              </Link>
              {isAuthenticated && (
                <>
                  <Link href="/me/reports">
                    <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${
                      location.includes("reports") ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}>My Reports</span>
                  </Link>
                  {isAdmin && (
                    <Link href="/admin">
                      <span className="px-4 py-2 text-sm font-medium rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 transition-all cursor-pointer">Admin</span>
                    </Link>
                  )}
                </>
              )}
            </div>

            <div className="hidden md:flex items-center gap-3">
              {isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full border border-white/10 hover:border-white/20">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.profileImageUrl || ""} />
                        <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-violet-600 text-white text-xs">{getUserInitials()}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-white/10 text-white">
                    <div className="p-2 border-b border-white/10">
                      <p className="font-medium text-sm text-white">{user?.firstName} {user?.lastName}</p>
                      <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                    </div>
                    <DropdownMenuItem className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"><User className="mr-2 h-4 w-4" />Profile</DropdownMenuItem>
                    <DropdownMenuItem className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"><Settings className="mr-2 h-4 w-4" />Settings</DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLogout} className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-white/10 border border-white/10">Sign In</Button>
                  </Link>
                  <Link href="/register">
                    <Button size="sm" className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white border-0 font-medium">
                      Get Started <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </>
              )}
            </div>

            <button
              className="md:hidden p-2 text-slate-400 hover:text-white"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="md:hidden bg-[#1e2130] border-t border-white/5 px-4 py-4 space-y-1">
            {PUBLIC_NAV.map(({ href, label }) => (
              <Link key={href} href={href}>
                <div
                  className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                    location === href ? "text-white bg-white/10" : "text-slate-400"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  {label}
                </div>
              </Link>
            ))}
            <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
              {isAuthenticated ? (
                <Button variant="ghost" onClick={() => { handleLogout(); setMobileOpen(false); }} className="w-full justify-start text-slate-400">
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </Button>
              ) : (
                <>
                  <Link href="/login"><Button variant="ghost" className="w-full text-slate-300 border border-white/10" onClick={() => setMobileOpen(false)}>Sign In</Button></Link>
                  <Link href="/register"><Button className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 text-white" onClick={() => setMobileOpen(false)}>Get Started</Button></Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
      <div className="h-16" />
    </>
  );
}
