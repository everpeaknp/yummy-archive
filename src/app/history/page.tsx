"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { format, subDays } from 'date-fns';
import { Loader2, Database, Archive, List, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderRow {
  id: number;
  created_at: string;
  total: number;
  status: string;
  source: 'live' | 'archived';
  job_id?: string;
}

export default function HistoryPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'live' | 'archived' | 'all'>('all');
  const [liveOrders, setLiveOrders] = useState<OrderRow[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) {
      fetchAllData();
    }
  }, [restaurantId]);

  const fetchAllData = async () => {
    setLoading(true);
    await Promise.all([fetchLiveOrders(), fetchArchivedOrders()]);
    setLoading(false);
  };

  const fetchLiveOrders = async () => {
    try {
      // Fetch recent orders from Main Backend
      const res = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=500`);
      console.log("Live orders response:", res.data);
      
      // Use deep extraction (API returns { data: { orders: [...] } })
      const raw = res.data;
      let ordersData: any[] = [];
      
      if (Array.isArray(raw)) {
        ordersData = raw;
      } else if (raw?.data?.orders && Array.isArray(raw.data.orders)) {
        ordersData = raw.data.orders;
      } else if (raw?.orders && Array.isArray(raw.orders)) {
        ordersData = raw.orders;
      } else if (raw?.data && Array.isArray(raw.data)) {
        ordersData = raw.data;
      }
      
      const mapped = ordersData.map((o: any) => ({
        id: o.id || o.order_id,
        created_at: o.created_at,
        total: o.total || o.net_amount || o.grand_total || 0,
        status: o.status,
        source: 'live' as const
      }));
      setLiveOrders(mapped);
    } catch (err) {
      console.error("Failed to fetch live orders:", err);
      setLiveOrders([]);
    }
  };

  const fetchArchivedOrders = async () => {
    try {
      // Get all archive jobs
      const last30Days = subDays(new Date(), 30);
      const start = format(last30Days, 'yyyy-MM-dd');
      const end = format(new Date(), 'yyyy-MM-dd');
      
      const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${start}&end_day=${end}`);
      const jobs = jobsRes.data?.jobs || [];
      
      const allArchived: OrderRow[] = [];
      
      // For each EXPORTED job, fetch orders
      for (const job of jobs.filter((j: any) => j.status === 'EXPORTED')) {
        try {
          const ordersRes = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=500`);
          const orders = ordersRes.data?.data || [];
          
          orders.forEach((o: any) => {
            allArchived.push({
              id: o.id || o.order_id,
              created_at: o.created_at,
              total: o.total || o.net_amount || o.grand_total || 0,
              status: 'archived',
              source: 'archived',
              job_id: job.job_id
            });
          });
        } catch (err) {
          // File might not exist (ephemeral storage)
          console.warn(`Could not fetch archived orders for job ${job.job_id}`);
        }
      }
      
      setArchivedOrders(allArchived);
    } catch (err) {
      console.error("Failed to fetch archived orders:", err);
      setArchivedOrders([]);
    }
  };

  const getDisplayOrders = () => {
    switch (activeTab) {
      case 'live':
        return liveOrders;
      case 'archived':
        return archivedOrders;
      case 'all':
      default:
        // Combine and sort by date (newest first)
        const combined = [...liveOrders, ...archivedOrders];
        return combined.sort((a, b) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }
  };

  const displayOrders = getDisplayOrders();

  if (!isAuthenticated) return null;

  const tabs = [
    { key: 'all', label: 'All Orders', icon: List, count: liveOrders.length + archivedOrders.length },
    { key: 'live', label: 'Live (Main DB)', icon: Database, count: liveOrders.length },
    { key: 'archived', label: 'Archived', icon: Archive, count: archivedOrders.length }
  ] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Order History</h1>
          <p className="text-slate-500 text-sm mt-1">View orders from both live database and archives</p>
        </div>
        <Button variant="outline" onClick={fetchAllData} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 pb-2">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            <span className={cn(
              "px-2 py-0.5 rounded-full text-xs",
              activeTab === tab.key ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-600"
            )}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Stats - Enhanced with Sales Totals */}
      {(() => {
        const liveSales = liveOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        const archivedSales = archivedOrders.reduce((sum, o) => sum + (o.total || 0), 0);
        const totalSales = liveSales + archivedSales;
        
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* Combined Stats */}
            <Card className="md:col-span-1">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-slate-900">{liveOrders.length + archivedOrders.length}</p>
                <p className="text-sm text-slate-500">Total Orders</p>
                <p className="text-lg font-semibold text-slate-700 mt-1">Rs. {totalSales.toLocaleString()}</p>
                <p className="text-xs text-slate-400">Combined Sales</p>
              </CardContent>
            </Card>
            
            {/* Live DB Stats */}
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-blue-600">{liveOrders.length}</p>
                <p className="text-sm text-blue-600">Live Orders</p>
                <p className="text-lg font-semibold text-blue-700 mt-1">Rs. {liveSales.toLocaleString()}</p>
                <p className="text-xs text-blue-400">In Main Database</p>
              </CardContent>
            </Card>
            
            {/* Archived Stats */}
            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-green-600">{archivedOrders.length}</p>
                <p className="text-sm text-green-600">Archived Orders</p>
                <p className="text-lg font-semibold text-green-700 mt-1">Rs. {archivedSales.toLocaleString()}</p>
                <p className="text-xs text-green-400">In Cold Storage</p>
              </CardContent>
            </Card>
          </div>
        );
      })()}

      {/* Orders Table */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            {activeTab === 'all' && 'All Orders'}
            {activeTab === 'live' && 'Live Orders (Main Database)'}
            {activeTab === 'archived' && 'Archived Orders'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : displayOrders.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No orders found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Date & Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayOrders.slice(0, 100).map((order, idx) => (
                    <tr key={`${order.source}-${order.id}-${idx}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">#{order.id}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy HH:mm') : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-slate-900">
                        Rs. {order.total.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 text-xs font-medium rounded-full",
                          order.status === 'completed' ? "bg-green-100 text-green-700" :
                          order.status === 'archived' ? "bg-slate-100 text-slate-600" :
                          "bg-yellow-100 text-yellow-700"
                        )}>
                          {order.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-1 text-xs font-medium rounded-full",
                          order.source === 'live' ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                        )}>
                          {order.source === 'live' ? 'Main DB' : 'Archived'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {displayOrders.length > 100 && (
                <div className="p-4 text-center text-sm text-slate-500">
                  Showing first 100 of {displayOrders.length} orders
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
