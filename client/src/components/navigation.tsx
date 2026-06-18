import { Link, useLocation } from "wouter";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, User, Settings, Menu, X, ChevronRight, Store, Sun, Moon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import SpectioLogo from "@/components/spectio-logo";
import { LockedFeatureTooltip } from "@/components/locked-feature-tooltip";
import type { LockableFeatureKey } from "@shared/features";
import { useTheme } from "@/components/theme-provider";

const ADMIN_PATHS = ["/admin", "/market-builder", "/lead-gen"];

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAdmin, logout, isAuthenticated, hasFeature, isVendorScoped } = useAuth();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: vendorScope } = useQuery<{ vendor: { name?: string } }>({
    queryKey: ["/api/lead-gen/me/scope"],
    enabled: isVendorScoped && !isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const vendorSeatName = vendorScope?.vendor?.name;

  const isAdminArea = ADMIN_PATHS.some(p => location.startsWith(p));
  const { theme, toggleTheme } = useTheme();

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

  const marketBuilderHref = isAuthenticated ? "/me/market-builder" : "/login";
  const isMarketBuilderActive = location.includes("market-builder") && !location.includes("forecast");
  const isForecastBuilderActive = location.includes("forecast-builder");

  const vendorOnly = isVendorScoped && !isAdmin;

  const navItems: { href: string; label: string; active?: boolean; featureKey?: LockableFeatureKey; vendorHidden?: boolean }[] = [
    { href: "/platform",          label: "Platform" },
    { href: "/markets",           label: "Markets" },
    { href: marketBuilderHref,    label: "Market Builder", active: isMarketBuilderActive, featureKey: "market_builder", vendorHidden: true },
    { href: "/forecast-builder",  label: "Forecast Builder", active: isForecastBuilderActive, featureKey: "forecast_builder", vendorHidden: true },
    { href: "/datasheets",        label: "Datasheets", featureKey: "datasheets", vendorHidden: true },
    { href: "/licensing",         label: "Licensing" },
    { href: "/about",             label: "About Us" },
  ].filter(item => {
    if (!vendorOnly || !item.vendorHidden) return true;
    // For vendor-scoped users: only show vendorHidden items when the feature has been explicitly granted
    return item.featureKey ? hasFeature(item.featureKey) : false;
  });

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

  const navBg = theme === "dark"
    ? "bg-[#1e2130]/80 backdrop-blur-xl border-b border-white/5"
    : "bg-white/95 backdrop-blur-sm border-b border-gray-200/50";

  const navItemClass = (isActive: boolean) => {
    const base = "px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer";
    if (theme === "dark") {
      return `${base} ${isActive ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"}`;
    }
    return `${base} ${isActive ? "text-slate-900 bg-slate-100" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`;
  };

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-50 ${navBg}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link href="/">
              <SpectioLogo />
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {navItems.map(({ href, label, active, featureKey }) => {
                const isActive = active !== undefined ? active : location === href;
                const locked = featureKey ? !hasFeature(featureKey) : false;
                if (locked) {
                  return (
                    <LockedFeatureTooltip key={label}>
                      <span className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-1.5 text-slate-400 hover:text-slate-300 cursor-not-allowed select-none transition-colors">
                        {label}<Lock className="h-3 w-3 text-amber-400/90" />
                      </span>
                    </LockedFeatureTooltip>
                  );
                }
                return (
                  <Link key={label} href={href}>
                    <span className={navItemClass(isActive)}>{label}</span>
                  </Link>
                );
              })}
              {isAuthenticated && (
                <>
                  <Link href="/me/reports">
                    <span className={navItemClass(location.includes("reports"))}>My Reports</span>
                  </Link>
                  {isVendorScoped && !isAdmin && (
                    <Link href="/lead-gen/me">
                      <span className={navItemClass(location === "/lead-gen/me")}>My Leads</span>
                    </Link>
                  )}
                  {isVendorScoped && !isAdmin && (
                    <Link href="/lead-gen/me/fact-review">
                      <span className={navItemClass(location === "/lead-gen/me/fact-review")}>Fact Review</span>
                    </Link>
                  )}
                  {isVendorScoped && !isAdmin && hasFeature("rfp") && (
                    <Link href="/rfp-responder">
                      <span className={navItemClass(location.startsWith("/rfp-responder"))}>RFP Responder</span>
                    </Link>
                  )}
                  {isAdmin && (
                    <Link href="/admin">
                      <span className="px-4 py-2 text-sm font-medium rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 transition-all cursor-pointer">Admin</span>
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* Desktop auth */}
            <div className="hidden md:flex items-center gap-3">
              {/* Theme toggle */}
              <button
                onClick={toggleTheme}
                aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                className={`p-2 rounded-lg transition-colors ${
                  theme === "dark"
                    ? "text-slate-400 hover:text-white hover:bg-white/10"
                    : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              {isAuthenticated ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`relative h-9 w-9 rounded-full border ${
                        theme === "dark" ? "border-white/10 hover:border-white/20" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.profileImageUrl || ""} />
                        <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-violet-600 text-white text-xs">{getUserInitials()}</AvatarFallback>
                      </Avatar>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className={`w-56 ${theme === "dark" ? "bg-slate-900 border-white/10 text-white" : ""}`}
                  >
                    <div className={`p-2 border-b ${theme === "dark" ? "border-white/10" : "border-slate-100"}`}>
                      <p className={`font-medium text-sm ${theme === "dark" ? "text-white" : ""}`}>{user?.firstName} {user?.lastName}</p>
                      <p className={`text-xs truncate ${theme === "dark" ? "text-slate-400" : "text-muted-foreground"}`}>{user?.email}</p>
                      {isVendorScoped && !isAdmin && (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500/15 to-violet-600/15 border border-cyan-400/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                          <Store className="h-3 w-3" />
                          Vendor seat{vendorSeatName ? ` · ${vendorSeatName}` : ""}
                        </span>
                      )}
                    </div>
                    <DropdownMenuItem asChild className={theme === "dark" ? "text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer" : "cursor-pointer"}>
                      <Link href="/me/profile"><User className="mr-2 h-4 w-4" />Profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className={theme === "dark" ? "text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer" : "cursor-pointer"}>
                      <Link href="/me/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleLogout} className={theme === "dark" ? "text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer" : "cursor-pointer"}>
                      <LogOut className="mr-2 h-4 w-4" />Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                  <Link href="/login">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={theme === "dark"
                        ? "text-slate-300 hover:text-white hover:bg-white/10 border border-white/10"
                        : "text-slate-600 hover:text-slate-900 border border-slate-200"}
                    >
                      Sign In
                    </Button>
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
              className={`md:hidden p-2 ${theme === "dark" ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-slate-900"}`}
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className={`md:hidden border-t px-4 py-4 space-y-1 ${
            theme === "dark" ? "bg-[#1e2130] border-white/5" : "bg-white border-gray-200"
          }`}>
            {navItems.map(({ href, label, active, featureKey }) => {
              const isActive = active !== undefined ? active : location === href;
              const locked = featureKey ? !hasFeature(featureKey) : false;
              if (locked) {
                return (
                  <LockedFeatureTooltip key={label}>
                    <div className="px-4 py-3 text-sm font-medium rounded-lg flex items-center gap-1.5 text-slate-400 cursor-not-allowed select-none">
                      {label}<Lock className="h-3 w-3 text-amber-400/90" />
                    </div>
                  </LockedFeatureTooltip>
                );
              }
              return (
                <Link key={label} href={href}>
                  <div
                    className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                      isActive
                        ? theme === "dark" ? "text-white bg-white/10" : "text-slate-900 bg-slate-100"
                        : theme === "dark" ? "text-slate-400" : "text-slate-600"
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    {label}
                  </div>
                </Link>
              );
            })}
            {isAuthenticated && (
              <Link href="/me/reports">
                <div
                  className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                    location.includes("reports")
                      ? theme === "dark" ? "text-white bg-white/10" : "text-slate-900 bg-slate-100"
                      : theme === "dark" ? "text-slate-400" : "text-slate-600"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  My Reports
                </div>
              </Link>
            )}
            {isVendorScoped && !isAdmin && (
              <Link href="/lead-gen/me">
                <div
                  className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                    location === "/lead-gen/me"
                      ? theme === "dark" ? "text-white bg-white/10" : "text-slate-900 bg-slate-100"
                      : theme === "dark" ? "text-slate-400" : "text-slate-600"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  My Leads
                </div>
              </Link>
            )}
            {isVendorScoped && !isAdmin && (
              <Link href="/lead-gen/me/fact-review">
                <div
                  className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                    location === "/lead-gen/me/fact-review"
                      ? theme === "dark" ? "text-white bg-white/10" : "text-slate-900 bg-slate-100"
                      : theme === "dark" ? "text-slate-400" : "text-slate-600"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  Fact Review
                </div>
              </Link>
            )}
            {isVendorScoped && !isAdmin && hasFeature("rfp") && (
              <Link href="/rfp-responder">
                <div
                  className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${
                    location.startsWith("/rfp-responder")
                      ? theme === "dark" ? "text-white bg-white/10" : "text-slate-900 bg-slate-100"
                      : theme === "dark" ? "text-slate-400" : "text-slate-600"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  RFP Responder
                </div>
              </Link>
            )}
            <div className={`pt-3 border-t flex flex-col gap-2 ${theme === "dark" ? "border-white/5" : "border-gray-200"}`}>
              {/* Theme toggle in mobile */}
              <button
                onClick={toggleTheme}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                  theme === "dark" ? "text-slate-400 hover:text-white hover:bg-white/10" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {theme === "dark" ? <><Sun className="h-4 w-4" /> Light mode</> : <><Moon className="h-4 w-4" /> Dark mode</>}
              </button>
              {isAuthenticated ? (
                <Button variant="ghost" onClick={() => { handleLogout(); setMobileOpen(false); }} className={`w-full justify-start ${theme === "dark" ? "text-slate-400" : "text-slate-600"}`}>
                  <LogOut className="mr-2 h-4 w-4" /> Sign out
                </Button>
              ) : (
                <>
                  <Link href="/login">
                    <Button variant="ghost" className={`w-full ${theme === "dark" ? "text-slate-300 border border-white/10" : "text-slate-600 border border-slate-200"}`} onClick={() => setMobileOpen(false)}>Sign In</Button>
                  </Link>
                  <Link href="/register">
                    <Button className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 text-white" onClick={() => setMobileOpen(false)}>Get Started</Button>
                  </Link>
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
