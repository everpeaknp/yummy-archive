"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Archive, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";

export function Navbar() {
  const pathname = usePathname();
  const { logout, restaurantId } = useAuth();
  
  if (pathname === "/login") return null;

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200" style={{ backgroundColor: '#ffffff' }}>
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight text-blue-600">
                <Archive className="h-6 w-6" />
                <span>Yummy Archive</span>
            </Link>
            
            <div className="hidden md:flex gap-6">
                <Link 
                    href="/" 
                    className={cn(
                        "text-sm font-medium transition-colors hover:text-blue-600",
                        pathname === "/" ? "text-blue-600" : "text-slate-600"
                    )}
                >
                    Dashboard
                </Link>
                <Link 
                    href="/history" 
                    className={cn(
                        "text-sm font-medium transition-colors hover:text-blue-600",
                        pathname === "/history" ? "text-blue-600" : "text-slate-600"
                    )}
                >
                    Order History
                </Link>
                <Link 
                    href="/analytics" 
                    className={cn(
                        "text-sm font-medium transition-colors hover:text-blue-600",
                        pathname === "/analytics" ? "text-blue-600" : "text-slate-600"
                    )}
                >
                    Analytics
                </Link>
            </div>
        </div>

        <div className="flex items-center gap-4">
            <div className="hidden md:block text-xs font-medium px-3 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                Rest ID: <span className="text-slate-900">{restaurantId}</span>
            </div>
            <Button 
                variant="ghost" 
                size="sm" 
                onClick={logout} 
                className="text-slate-500 hover:text-red-600 hover:bg-red-50"
            >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
            </Button>
        </div>
      </div>
    </nav>
  );
}
