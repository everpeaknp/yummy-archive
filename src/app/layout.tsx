import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { Navbar } from "@/components/ui/Navbar";

export const metadata: Metadata = {
  title: "Yummy Archive Manager",
  description: "Securely archive and manage restaurant order data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" style={{ colorScheme: 'light' }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body style={{ backgroundColor: '#f8fafc', color: '#0f172a' }}>
        <AuthProvider>
          <div className="min-h-screen" style={{ backgroundColor: '#f8fafc' }}>
            <Navbar />
            <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 max-w-7xl">
              {children}
            </main>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
