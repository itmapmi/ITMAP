import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function Navigation() {
  const [location] = useLocation();

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/">
              <div className="text-2xl font-bold text-primary-700">MarketScope</div>
            </Link>
            <div className="ml-10 flex space-x-8">
              <Link href="/">
                <a className={`px-3 py-2 text-sm font-medium ${
                  location === "/" 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  Markets
                </a>
              </Link>
              <Link href="/admin">
                <a className={`px-3 py-2 text-sm font-medium ${
                  location.startsWith("/admin") 
                    ? "text-gray-900 hover:text-primary-600" 
                    : "text-gray-500 hover:text-gray-700"
                }`}>
                  Admin
                </a>
              </Link>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative">
              <Input 
                type="text" 
                placeholder="Search markets..." 
                className="w-64 pl-10"
              />
              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            </div>
            <Button className="bg-primary-600 hover:bg-primary-700">
              Profile
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
