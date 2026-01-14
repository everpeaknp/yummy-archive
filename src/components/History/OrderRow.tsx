import React from 'react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Loader2, Database, Archive } from 'lucide-react';

export interface OrderRowData {
  id: number | string;
  created_at: string;
  total: number;
  status: string;
  source: 'live' | 'archived' | 'error';
  job_id?: string;
  channel?: string;
  error_message?: string;
}

interface OrderRowProps {
  order: OrderRowData;
  isLast?: boolean;
}

export function OrderRow({ order }: OrderRowProps) {
  if (order.source === 'error') {
     return (
        <tr className="bg-red-50 hover:bg-red-100 transition-colors border-l-4 border-l-red-500">
           <td colSpan={5} className="px-4 py-3">
              <div className="flex items-center justify-between">
                 <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 rounded-full">
                       <Archive className="w-4 h-4 text-red-600" />
                    </div>
                    <div>
                       <p className="text-sm font-semibold text-red-900">
                          Archive Load Failed
                       </p>
                       <p className="text-xs text-red-700">
                          {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy') : 'Unknown Date'} • {order.error_message || 'Unknown error'}
                       </p>
                    </div>
                 </div>
                 {order.job_id && (
                   <a 
                     href={`/archive/${order.job_id}`}
                     className="px-3 py-1.5 text-xs font-medium bg-white text-red-700 border border-red-200 rounded hover:bg-red-50 shadow-sm"
                   >
                      Fix Issue
                   </a>
                 )}
              </div>
           </td>
        </tr>
     );
  }

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
