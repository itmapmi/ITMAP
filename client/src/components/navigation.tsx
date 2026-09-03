import { Link, useLocation } from "wouter";
import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, User, Settings, Menu, X, ChevronRight, Store, ChevronDown, FileText, ClipboardList, Star, MessageSquare, Shield, Smartphone } from "lucide-react";
import { useViewMode } from "@/hooks/use-view-mode";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import SpectioLogo from "@/components/spectio-logo";
import { LockedFeatureTooltip } from "@/components/locked-feature-tooltip";
import { Lock } from "lucide-react";
import { VerificationBanner } from "@/components/email-verification-gate";
import type { LockableFeatureKey } from "@shared/features";

const ADMIN_PATHS = ["/admin", "/market-builder", "/lead-gen"];

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAdmin, logout, isAuthenticated, hasFeature, isVendorScoped } = useAuth();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { canToggle: canToggleMobileView, switchToMobile } = useViewMode();

  // The fixed header (verification banner + nav) is measured at runtime and
  // that measurement drives the spacer below it, so the two can never drift
  // out of sync — no hardcoded height assumption, regardless of whether the
  // banner is present or wraps to multiple lines.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setHeaderHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { data: vendorScope } = useQuery<{ vendor: { name?: string } }>({
    queryKey: ["/api/lead-gen/me/scope"],
    enabled: isVendorScoped && !isAdmin,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const vendorSeatName = vendorScope?.vendor?.name;

  // /lead-gen/me/* paths are for vendor seat users, NOT the admin area.
  // Only /lead-gen (admin dashboard) and paths that don't start with /lead-gen/me
  // should trigger the light admin nav.
  const isAdminArea = ADMIN_PATHS.some(p => location.startsWith(p)) && !location.startsWith("/lead-gen/me");

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

  const isMarketBuilderActive = location.includes("market-builder") && !location.includes("forecast");
  const isForecastBuilderActive = location.includes("forecast-builder");
  const isVendorPersona = (user as any)?.persona === "vendor";
  const vendorOnly = (isVendorScoped || isVendorPersona) && !isAdmin;
  const buyerOnly = isAuthenticated && !isVendorScoped && !isVendorPersona && !isAdmin;

  // Public nav (unauthenticated)
  const publicNavItems = [
    { href: "/platform", label: "Platform" },
    { href: "/markets", label: "Markets" },
    { href: "/licensing", label: "Licensing" },
    { href: "/pricing", label: "Pricing" },
    { href: "/about", label: "About Us" },
  ];

  // Buyer nav (all features unlocked — no locks needed)
  const buyerNavItems = [
    { href: "/markets", label: "Markets" },
    { href: "/me/rfps", label: "RFP Builder" },
    { href: "/datasheets", label: "Datasheets" },
    { href: "/security", label: "Security Intelligence" },
    { href: "/platform", label: "Methodology" },
  ];

  // Vendor nav — intelligence and tools dropdowns
  const intelligenceItems: { href: string; label: string; featureKey: LockableFeatureKey }[] = [
    { href: "/forecast-builder", label: "Forecast Builder", featureKey: "forecast_builder" },
    { href: "/me/market-builder", label: "Market Builder", featureKey: "market_builder" },
    { href: "/markets", label: "News & Signals", featureKey: "news" },
  ];
  const toolsItems: { href: string; label: string; featureKey: LockableFeatureKey }[] = [
    { href: "/lead-gen/me", label: "Lead Generator", featureKey: "lead_gen" },
    { href: "/rfp-responder", label: "RFP Responder", featureKey: "rfp" },
    { href: "/battle-cards", label: "Battle Cards", featureKey: "battle_cards" },
    { href: "/datasheets", label: "Datasheets", featureKey: "datasheets" },
    { href: "/security", label: "Security Intelligence", featureKey: "cve_intelligence" },
  ];

  const isToolsActive = location.startsWith("/rfp-responder") || location.startsWith("/battle-cards") || location.startsWith("/datasheets") || location.startsWith("/lead-gen/me") || location.startsWith("/security");
  const isIntelligenceActive = isForecastBuilderActive || isMarketBuilderActive;
  const intelligenceAllLocked = intelligenceItems.every(i => !hasFeature(i.featureKey));
  const toolsAllLocked = toolsItems.every(i => !hasFeature(i.featureKey));

  if (isAdminArea) {
    return (
      <>
        <VerificationBanner />
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
      </>
    );
  }

  return (
    <>
      <div ref={headerRef} className="fixed top-0 left-0 right-0 z-50">
        <VerificationBanner />
        <nav className="bg-[#1e2130]/80 backdrop-blur-xl border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center h-16">
            <Link href="/" className="justify-self-start">
              <SpectioLogo />
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center justify-center gap-1">
              {/* Buyer nav — all features unlocked */}
              {buyerOnly && buyerNavItems.map(({ href, label }) => {
                const isActive = location === href || (href !== "/markets" && location.startsWith(href));
                return (
                  <Link key={label} href={href}>
                    <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${isActive ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>{label}</span>
                  </Link>
                );
              })}

              {/* Vendor nav — My Markets, Intelligence dropdown, Tools dropdown, Methodology */}
              {vendorOnly && (
                <>
                  <Link href="/markets">
                    <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${location === "/markets" ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>My Markets</span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 select-none ${isIntelligenceActive ? "text-white bg-white/10" : intelligenceAllLocked ? "text-slate-500" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
                        Intelligence
                        {intelligenceAllLocked ? <Lock className="h-3 w-3 text-amber-400/70" /> : <ChevronDown className="h-3 w-3" />}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-slate-900 border-white/10 min-w-[190px]">
                      {intelligenceItems.map(({ href, label, featureKey }) => {
                        const locked = !hasFeature(featureKey);
                        return locked ? (
                          <LockedFeatureTooltip key={label}>
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 cursor-not-allowed select-none w-full">
                              {label}<Lock className="h-3 w-3 text-amber-400/70 ml-auto" />
                            </div>
                          </LockedFeatureTooltip>
                        ) : (
                          <DropdownMenuItem key={label} asChild className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer">
                            <Link href={href}>{label}</Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 select-none ${isToolsActive ? "text-white bg-white/10" : toolsAllLocked ? "text-slate-500" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>
                        Tools
                        {toolsAllLocked ? <Lock className="h-3 w-3 text-amber-400/70" /> : <ChevronDown className="h-3 w-3" />}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="bg-slate-900 border-white/10 min-w-[190px]">
                      {toolsItems.map(({ href, label, featureKey }) => {
                        const locked = !hasFeature(featureKey);
                        return locked ? (
                          <LockedFeatureTooltip key={label}>
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 cursor-not-allowed select-none w-full">
                              {label}<Lock className="h-3 w-3 text-amber-400/70 ml-auto" />
                            </div>
                          </LockedFeatureTooltip>
                        ) : (
                          <DropdownMenuItem key={label} asChild className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer">
                            <Link href={href}>{label}</Link>
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Link href="/platform">
                    <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${location === "/platform" ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>Methodology</span>
                  </Link>
                </>
              )}

              {/* Public nav (unauthenticated) */}
              {!isAuthenticated && publicNavItems.map(({ href, label }) => (
                <Link key={label} href={href}>
                  <span className={`px-4 py-2 text-sm font-medium rounded-lg transition-all cursor-pointer ${location === href ? "text-white bg-white/10" : "text-slate-400 hover:text-white hover:bg-white/5"}`}>{label}</span>
                </Link>
              ))}

              {/* Admin link (always shown for admins) */}
              {isAdmin && (
                <Link href="/admin">
                  <span className="px-4 py-2 text-sm font-medium rounded-lg text-amber-400 hover:text-amber-300 hover:bg-amber-400/10 transition-all cursor-pointer">Admin</span>
                </Link>
              )}
            </div>

            {/* Desktop auth */}
            <div className="hidden md:flex items-center justify-end gap-3">
              {canToggleMobileView && (
                <button
                  onClick={switchToMobile}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors border border-white/10"
                  data-testid="button-switch-mobile"
                  title="Switch to the mobile-optimized view"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  Mobile view
                </button>
              )}
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
                      {isVendorScoped && !isAdmin && (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-500/15 to-violet-600/15 border border-cyan-400/20 px-2 py-0.5 text-[11px] font-medium text-cyan-300">
                          <Store className="h-3 w-3" />
                          Vendor seat{vendorSeatName ? ` · ${vendorSeatName}` : ""}
                        </span>
                      )}
                    </div>
                    <DropdownMenuItem asChild className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer">
                      <Link href="/me/profile"><User className="mr-2 h-4 w-4" />Profile</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild className="text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer">
                      <Link href="/me/settings"><Settings className="mr-2 h-4 w-4" />Settings</Link>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/10" />
                    {!buyerOnly && (
                      <DropdownMenuItem asChild className={`cursor-pointer ${location.includes("reports") ? "text-white bg-white/10" : "text-slate-300 hover:text-white hover:bg-white/10"}`}>
                        <Link href="/me/reports"><FileText className="mr-2 h-4 w-4" />My Reports</Link>
                      </DropdownMenuItem>
                    )}
                    {isVendorScoped && !isAdmin && (
                      <DropdownMenuItem asChild className={`cursor-pointer ${location === "/lead-gen/me/fact-review" ? "text-white bg-white/10" : "text-slate-300 hover:text-white hover:bg-white/10"}`}>
                        <Link href="/lead-gen/me/fact-review"><Star className="mr-2 h-4 w-4" />Fact Review</Link>
                      </DropdownMenuItem>
                    )}
                    {isVendorScoped && !isAdmin && hasFeature("rfp") && (
                      <DropdownMenuItem asChild className={`cursor-pointer ${location.startsWith("/rfp-responder") ? "text-white bg-white/10" : "text-slate-300 hover:text-white hover:bg-white/10"}`}>
                        <Link href="/rfp-responder"><MessageSquare className="mr-2 h-4 w-4" />RFP Responder</Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator className="bg-white/10" />
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

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden bg-[#1e2130] border-t border-white/5 px-4 py-4 space-y-1">
            {/* Buyer mobile nav */}
            {buyerOnly && buyerNavItems.map(({ href, label }) => (
              <Link key={label} href={href}>
                <div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location === href || location.startsWith(href) ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>{label}</div>
              </Link>
            ))}

            {/* Vendor mobile nav */}
            {vendorOnly && (
              <>
                <Link href="/markets"><div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location === "/markets" ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>My Markets</div></Link>
                <div className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">Intelligence</div>
                {intelligenceItems.map(({ href, label, featureKey }) => {
                  const locked = !hasFeature(featureKey);
                  return locked ? (
                    <div key={label} className="px-4 py-3 text-sm font-medium rounded-lg flex items-center gap-1.5 text-slate-600 cursor-not-allowed select-none">
                      {label}<Lock className="h-3 w-3 text-amber-400/70" />
                    </div>
                  ) : (
                    <Link key={label} href={href}><div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location.startsWith(href) ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>{label}</div></Link>
                  );
                })}
                <div className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-widest text-slate-600 uppercase">Tools</div>
                {toolsItems.map(({ href, label, featureKey }) => {
                  const locked = !hasFeature(featureKey);
                  return locked ? (
                    <div key={label} className="px-4 py-3 text-sm font-medium rounded-lg flex items-center gap-1.5 text-slate-600 cursor-not-allowed select-none">
                      {label}<Lock className="h-3 w-3 text-amber-400/70" />
                    </div>
                  ) : (
                    <Link key={label} href={href}><div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location.startsWith(href) ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>{label}</div></Link>
                  );
                })}
                <Link href="/platform"><div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location === "/platform" ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>Methodology</div></Link>
              </>
            )}

            {/* Public mobile nav */}
            {!isAuthenticated && publicNavItems.map(({ href, label }) => (
              <Link key={label} href={href}>
                <div className={`px-4 py-3 text-sm font-medium rounded-lg cursor-pointer ${location === href ? "text-white bg-white/10" : "text-slate-400"}`} onClick={() => setMobileOpen(false)}>{label}</div>
              </Link>
            ))}

            {isAdmin && (
              <Link href="/admin"><div className="px-4 py-3 text-sm font-medium rounded-lg cursor-pointer text-amber-400" onClick={() => setMobileOpen(false)}>Admin</div></Link>
            )}

            {canToggleMobileView && (
              <button
                onClick={switchToMobile}
                className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                data-testid="button-switch-mobile-menu"
              >
                <Smartphone className="h-4 w-4" /> Switch to mobile view
              </button>
            )}

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
      </div>
      <div style={{ height: headerHeight }} />
    </>
  );
}
