"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Archive, LogOut, History, BarChart3, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/contexts/AuthContext";
import { useState } from "react";

export function Navbar() {
  const pathname = usePathname();
  const { logout, restaurantId } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  if (pathname === "/login") return null;

  const navLinks = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/history", label: "Order History", icon: History },
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
  ];

  return (
    <>
      {/* Main Navbar */}
      <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 h-14 md:h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 font-bold text-lg md:text-xl tracking-tight text-blue-600">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
              <Archive className="h-4 w-4 text-white" />
            </div>
            <span className="hidden sm:inline">Yummy Archive</span>
          </Link>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => {
              const Icon = link.icon;
              const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
              return (
                <Link 
                  key={link.href}
                  href={link.href} 
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
                    isActive 
                      ? "bg-blue-50 text-blue-700" 
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Right Section */}
          <div className="flex items-center gap-2 md:gap-3">
            {/* Restaurant ID Badge */}
            <div className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              <span className="hidden sm:inline">Rest ID: </span>
              <span className="text-slate-900 font-semibold">{restaurantId}</span>
            </div>
            
            {/* Desktop Logout */}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={logout} 
              className="hidden md:flex text-slate-500 hover:text-red-600 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>

            {/* Mobile Menu Toggle */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden h-9 w-9 p-0"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 bg-white">
            <div className="container mx-auto px-4 py-3 space-y-1">
              {navLinks.map(link => {
                const Icon = link.icon;
                const isActive = pathname === link.href;
                return (
                  <Link 
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all",
                      isActive 
                        ? "bg-blue-50 text-blue-700" 
                        : "text-slate-700 hover:bg-slate-50"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {link.label}
                  </Link>
                );
              })}
              <div className="pt-2 mt-2 border-t border-slate-100">
                <button
                  onClick={() => { logout(); setMobileMenuOpen(false); }}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium text-red-600 hover:bg-red-50 w-full"
                >
                  <LogOut className="h-5 w-5" />
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 safe-area-bottom">
        <div className="flex items-center justify-around h-16">
          {navLinks.map(link => {
            const Icon = link.icon;
            const isActive = pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href));
            return (
              <Link 
                key={link.href}
                href={link.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl transition-all",
                  isActive 
                    ? "text-blue-600" 
                    : "text-slate-500"
                )}
              >
                <Icon className={cn("h-5 w-5", isActive && "text-blue-600")} />
                <span className={cn(
                  "text-[10px] font-medium",
                  isActive ? "text-blue-600" : "text-slate-500"
                )}>
                  {link.label.split(' ')[0]}
                </span>
              </Link>
            );
          })}
          <button
            onClick={logout}
            className="flex flex-col items-center justify-center gap-1 py-2 px-4 rounded-xl text-slate-500"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium">Logout</span>
          </button>
        </div>
      </nav>
    </>
  );
}
