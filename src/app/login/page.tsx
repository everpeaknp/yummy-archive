"use client";

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { mainApi } from '@/services/api';
import { Loader2, Archive, Eye, Lock, Mail } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      params.append('username', email);
      params.append('password', password);
      
      const res = await mainApi.post('/auth/login', params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      
      const data = res.data.data || res.data;
      const { access_token, restaurant_id } = data;
      
      if (access_token) {
        login(access_token, Number(restaurant_id || 52));
        router.push('/');
      } else {
        throw new Error("No access token in response");
      }
    } catch (err: any) {
      console.error("Login failed", err);
      setError(err.response?.data?.detail || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-lg mb-4">
            <Archive className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Yummy Archive</h1>
          <p className="text-slate-500 mt-1">Secure order archiving system</p>
        </div>

        {/* Login Card */}
        <Card className="shadow-xl border-0">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-xl font-semibold text-slate-900">Sign in to your account</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email / Username
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@yummy.com"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  />
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                  {error}
                </div>
              )}

              {/* Submit Button */}
              <Button 
                type="submit" 
                className="w-full h-11 text-base font-medium bg-blue-600 hover:bg-blue-700" 
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white text-slate-500">Test Credentials</span>
              </div>
            </div>

            {/* Test Credentials */}
            <div className="text-center text-xs text-slate-500 space-y-1">
              <p>Email: <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">admin@yummy.com</code></p>
              <p>Password: <code className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">admin123456</code></p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-6">
          Protected by Yummy Archive System
        </p>
      </div>
    </div>
  );
}
