import { Link, useLocation } from "wouter";
import { Search, LogOut, User, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import itmapLogo from "@assets/ITMAP_logo_transparent_1755237362280.png";

export default function Navigation() {
  const [location] = useLocation();
  const { user, isAdmin, logout, isAuthenticated } = useAuth();
  const { toast } = useToast();

  const handleLogout = async () => {
    try {
      await logout();
      toast({
        title: "Success",
        description: "Logged out successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to logout",
        variant: "destructive",
      });
    }
  };

  const getUserInitials = () => {
    if (!user?.firstName || !user?.lastName) return "U";
    return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  };

  return (
    <nav className="bg-white/95 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20">
          <div className="flex items-center">
            <Link href="/">
              <div className="flex items-center space-x-3">
                <img src={itmapLogo} alt="ITMAP" className="h-24 w-auto" />
              </div>
            </Link>
            <div className="ml-10 flex space-x-8">
              <Link href="/">
                <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                  location === "/" 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  Home
                </div>
              </Link>
              <Link href="/about">
                <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                  location === "/about" 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  About Us
                </div>
              </Link>
              <Link href="/platform">
                <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                  location === "/platform" 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  Platform
                </div>
              </Link>
              <Link href="/contact">
                <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                  location === "/contact" 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  Contact Us
                </div>
              </Link>
              {isAuthenticated && (
                <>
                  <Link href="/markets">
                    <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                      location === "/markets" 
                        ? "text-gray-900 hover:text-primary-600" 
                        : "text-gray-500 hover:text-gray-700"
                    }`}>
                      Markets
                    </div>
                  </Link>
                  {isAdmin && (
                    <Link href="/admin">
                      <div className={`px-3 py-2 text-lg font-medium cursor-pointer ${
                        location.startsWith("/admin") 
                          ? "text-gray-900 hover:text-primary-600" 
                          : "text-gray-500 hover:text-gray-700"
                      }`}>
                        Admin
                      </div>
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-4">
            {isAuthenticated && (
              <div className="relative">
                <Input 
                  type="text" 
                  placeholder="Search markets..." 
                  className="w-64 pl-10"
                />
                <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              </div>
            )}
            
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user?.profileImageUrl || ''} alt={user?.firstName || 'User'} />
                      <AvatarFallback>{getUserInitials()}</AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      <p className="font-medium">{user?.firstName} {user?.lastName}</p>
                      <p className="w-[200px] truncate text-sm text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                  </div>
                  <DropdownMenuItem>
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center space-x-3">
                <Link href="/login">
                  <Button variant="outline">Sign In</Button>
                </Link>
                <Link href="/register">
                  <Button>Get Started</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
