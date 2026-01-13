"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface AuthContextType {
  token: string | null;
  restaurantId: number | null;
  login: (token: string, restaurantId: number) => void;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  restaurantId: null,
  login: () => {},
  logout: () => {},
  isAuthenticated: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [token, setToken] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    const storedToken = localStorage.getItem('access_token');
    const storedRestId = localStorage.getItem('restaurant_id');
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedRestId) {
      setRestaurantId(Number(storedRestId));
    }
  }, []);

  const login = (newToken: string, newRestaurantId: number) => {
    setToken(newToken);
    setRestaurantId(newRestaurantId);
    localStorage.setItem('access_token', newToken);
    localStorage.setItem('restaurant_id', String(newRestaurantId));
  };

  const logout = () => {
    setToken(null);
    setRestaurantId(null);
    localStorage.removeItem('access_token');
    localStorage.removeItem('restaurant_id');
    router.push('/login');
  };

  return (
    <AuthContext.Provider value={{ token, restaurantId, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};
