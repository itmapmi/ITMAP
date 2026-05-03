import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, User, Settings, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      toast({ title: "Success", description: "Logged out successfully" });
    } catch {
      toast({ title: "Error", description: "Failed to logout", variant: "destructive" });
    }
  };

  const getUserInitials = () => {
    if (!user?.firstName || !user?.lastName) return "U";
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  };

  const navLinks = [
    { href: "/", label: "Home" },
    ...(isAuthenticated ? [{ href: "/markets", label: "Markets" }] : []),
    { href: "/platform", label: "Platform" },
    { href: "/about", label: "About Us" },
    { href: "/licensing", label: "Licensing" },
    { href: "/contact", label: "Contact Us" },
    ...(isAuthenticated && isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <nav className="bg-[#0a0a0a] border-b border-white/10 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/">
            <div className="flex items-center cursor-pointer">
              <img src={itmapLogo} alt="ITMAP" className={isMobile ? "h-10 w-auto" : "h-12 w-auto"} />
            </div>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label }) => (
              <Link key={href} href={href}>
                <span className={`px-3 py-2 text-sm font-medium cursor-pointer transition-colors rounded ${
                  location === href || (href !== "/" && location.startsWith(href))
                    ? "text-white"
                    : "text-white/50 hover:text-white"
                }`}>
                  {label}
                </span>
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full hover:bg-white/10">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.profileImageUrl || ""} alt={user?.firstName || "User"} />
                      <AvatarFallback className="bg-cyan-600 text-white text-xs">{getUserInitials()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 bg-[#141414] border-white/10 text-white" align="end" forceMount>
                  <div className="flex items-center gap-2 p-2 border-b border-white/10 mb-1">
                    <div className="flex flex-col">
                      <p className="font-medium text-sm text-white">{user?.firstName} {user?.lastName}</p>
                      <p className="text-xs text-white/50 truncate w-40">{user?.email}</p>
                    </div>
                  </div>
                  <DropdownMenuItem className="text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">
                    <User className="mr-2 h-4 w-4" /><span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" /><span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout} className="text-white/70 hover:text-white hover:bg-white/10 cursor-pointer">
                    <LogOut className="mr-2 h-4 w-4" /><span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="hidden md:flex items-center gap-2">
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-white/70 hover:text-white hover:bg-white/10">
                    Sign In
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold">
                    Get Started
                  </Button>
                </Link>
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              className="md:hidden text-white/70 hover:text-white p-2"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[#0a0a0a] border-t border-white/10 px-4 py-3 space-y-1">
          {navLinks.map(({ href, label }) => (
            <Link key={href} href={href}>
              <span
                className={`block px-3 py-2 text-sm font-medium rounded cursor-pointer transition-colors ${
                  location === href ? "text-white bg-white/10" : "text-white/60 hover:text-white"
                }`}
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </span>
            </Link>
          ))}
          {!isAuthenticated && (
            <div className="pt-2 flex gap-2">
              <Link href="/login">
                <Button variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10">Sign In</Button>
              </Link>
              <Link href="/register">
                <Button size="sm" className="bg-cyan-500 hover:bg-cyan-400 text-black font-semibold">Get Started</Button>
              </Link>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
