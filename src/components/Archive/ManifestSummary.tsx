"use client";

import React from 'react';
import { Manifest } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ManifestSummaryProps {
  manifest: Manifest | null;
}

export function ManifestSummary({ manifest }: ManifestSummaryProps) {
  if (!manifest) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Archive Manifest</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-medium text-sm text-black mb-1">Timezone</h4>
            <p className="text-black">{manifest.restaurant_timezone}</p>
          </div>
          <div>
            <h4 className="font-medium text-sm text-black mb-1">Total Checksum</h4>
            <p className="font-mono text-xs break-all text-black">{manifest.total_checksum}</p>
          </div>
        </div>
        
        <h4 className="font-medium text-sm text-black mt-4 mb-2">Row Counts</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {Object.entries(manifest.row_counts).map(([table, count]) => (
            <div key={table} className="bg-gray-50 p-3 rounded border">
              <span className="block text-xs uppercase text-black">{table}</span>
              <span className="block text-lg font-bold text-black">{count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
