"use client";

import React from 'react';
import { Card, CardContent } from '@/components/ui/Card';

interface StatsCardProps {
  title: string;
  value: string | number;
  description?: string;
  icon?: React.ReactNode;
}

export function StatsCard({ title, value, description, icon }: StatsCardProps) {
  return (
    <Card>
      <CardContent className="p-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <h2 className="text-3xl font-bold">{value}</h2>
          {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
        </div>
        {icon && <div className="p-3 bg-blue-100 rounded-full text-blue-600">{icon}</div>}
      </CardContent>
    </Card>
  );
}
