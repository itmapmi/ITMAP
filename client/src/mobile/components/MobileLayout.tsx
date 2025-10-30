import { Home, FileText, Building2, Newspaper, User } from "lucide-react";
import { Link, useLocation } from "wouter";

interface MobileLayoutProps {
  children: React.ReactNode;
}

export default function MobileLayout({ children }: MobileLayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { icon: Home, label: "Home", path: "/mobile/dashboard", testId: "nav-home" },
    { icon: FileText, label: "Markets", path: "/mobile/markets", testId: "nav-markets" },
    { icon: Building2, label: "Vendors", path: "/mobile/vendors", testId: "nav-vendors" },
    { icon: Newspaper, label: "News", path: "/mobile/news", testId: "nav-news" },
    { icon: User, label: "Profile", path: "/mobile/profile", testId: "nav-profile" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="flex-1">
        {children}
      </div>
      
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50">
        <div className="flex justify-around items-center h-16 max-w-screen-xl mx-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.path || location.startsWith(item.path + '/');
            
            return (
              <Link key={item.path} href={item.path}>
                <a
                  data-testid={item.testId}
                  className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                    isActive
                      ? "text-blue-600"
                      : "text-gray-600 hover:text-blue-600"
                  }`}
                >
                  <Icon className="h-6 w-6 mb-1" />
                  <span className="text-xs font-medium">{item.label}</span>
                </a>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
