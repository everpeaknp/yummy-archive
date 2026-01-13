import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Loader2, Database, Archive } from 'lucide-react';

export interface OrderRowData {
  id: number;
  created_at: string;
  total: number;
  status: string;
  source: 'live' | 'archived';
  job_id?: string;
  channel?: string;
}

interface OrderRowProps {
  order: OrderRowData;
  isLast?: boolean;
}

export function OrderRow({ order }: OrderRowProps) {
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 text-sm font-medium text-slate-900">
        #{order.id}
      </td>
      <td className="px-4 py-3 text-sm text-slate-600">
        {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy HH:mm') : '-'}
      </td>
      <td className="px-4 py-3 text-sm font-medium text-slate-900">
        Rs. {order.total.toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          "px-2 py-1 text-xs font-medium rounded-full inline-flex items-center gap-1",
          order.status === 'completed' ? "bg-green-100 text-green-700" :
          order.status === 'archived' ? "bg-slate-100 text-slate-600" :
          "bg-yellow-100 text-yellow-700"
        )}>
          {order.status}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={cn(
          "px-2 py-1 text-xs font-medium rounded-full inline-flex items-center gap-1",
          order.source === 'live' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
        )}>
          {order.source === 'live' ? <Database className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
          {order.source === 'live' ? 'Live' : 'Archived'}
        </span>
      </td>
    </tr>
  );
}
