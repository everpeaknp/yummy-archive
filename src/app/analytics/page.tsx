"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mainApi, archiveApi } from '@/services/api';
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2, BarChart3, Database, TrendingUp, Calendar, AlertCircle, CheckCircle2, Search, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function AnalyticsPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  
  // State
  const [activeTab, setActiveTab] = useState<'analytics' | 'inspector'>('analytics');
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  
  // Data
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [archiveJobs, setArchiveJobs] = useState<any[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalOrders, setTotalOrders] = useState(0);
  
  // Inspect Day State (Inline Detail View)
  const [inspectingDay, setInspectingDay] = useState<string | null>(null);
  const [inspectOrders, setInspectOrders] = useState<any[]>([]);
  const [inspectItems, setInspectItems] = useState<Record<number, any[]>>({});
  const [inspectLoading, setInspectLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [loadingItems, setLoadingItems] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) {
      fetchData();
    }
  }, [restaurantId, dateRange]);

  const fetchData = async () => {
    setLoading(true);
    
    // 1. Fetch Sales Stats
    const fetchSales = async () => {
      try {
        const salesRes = await mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`);
        console.log("[Analytics] Sales response:", salesRes.data);
        const salesData = salesRes.data?.data || salesRes.data;
        
        let mappedStats: any[] = [];
        if (salesData?.periods && Array.isArray(salesData.periods)) {
            mappedStats = salesData.periods.map((item: any) => ({
            date: item.period || item.date,
            order_count: item.orders || item.order_count || 0,
            total_amount: item.sales || item.total_amount || 0
            }));
        }
        setDailyStats(mappedStats);

        const totalRev = salesData?.total_sales || salesData?.total_amount || mappedStats.reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
        const totalOrd = salesData?.total_orders || mappedStats.reduce((acc: number, curr: any) => acc + (curr.order_count || 0), 0);
        setTotalRevenue(totalRev);
        setTotalOrders(totalOrd);
      } catch (err) {
        console.error("Failed to fetch sales stats:", err);
        // Toast or specific error handling here
      }
    };

    // 2. Fetch Archive Jobs
    const fetchArchive = async () => {
      try {
        console.log(`[Analytics] Fetching archive jobs for range: ${dateRange.start} to ${dateRange.end}`);
        const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${dateRange.start}&end_day=${dateRange.end}`);
        setArchiveJobs(jobsRes.data?.jobs || []);
      } catch (err: any) {
        console.error("Failed to fetch archive jobs:", err);
        // If 500, it might be backend issue, leave as empty array
        setArchiveJobs([]);
      }
    };

    await Promise.allSettled([fetchSales(), fetchArchive()]);
    setLoading(false);
  };

  // Helper to merge data for table
  const getUnifiedData = () => {
    const days = eachDayOfInterval({ 
       start: new Date(dateRange.start), 
       end: new Date(dateRange.end) 
    });

    return days.map(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const salesStat = dailyStats.find(s => (s.date || s.period) === dateStr);
        const job = archiveJobs.find(j => j.archive_day === dateStr);
        
        return {
            date: day,
            dateStr,
            salesRevenue: salesStat?.total_amount || 0,
            salesOrders: salesStat?.order_count || 0,
            archiveStatus: job?.status || 'NOT_ARCHIVED',
            archiveId: job?.job_id,
            archiveCount: job?.row_count || job?.orders_count || 0
        };
    }).reverse(); // Newest first
  };

  const unifiedData = getUnifiedData();
  const maxRevenue = Math.max(...dailyStats.map(s => s.total_amount || 0), 1);

  // Inspect a specific day - fetch both Live and Archived orders
  const inspectDay = async (day: string) => {
    console.log('[Analytics] inspectDay called with:', day, 'current:', inspectingDay);
    
    if (inspectingDay === day) {
      setInspectingDay(null);
      setInspectOrders([]);
      return;
    }
    
    // Set inspecting day immediately so panel shows
    setInspectingDay(day);
    setInspectLoading(true);
    setInspectOrders([]);
    setInspectItems({});
    setExpandedOrderId(null);
    
    console.log('[Analytics] Set inspectingDay to:', day);
    
    try {
      const merged = new Map<string, any>();
      
      // 1. Fetch Archived Orders for this day
      const job = archiveJobs.find(j => j.archive_day === day && ['EXPORTED', 'SYNCED'].includes(j.status));
      if (job) {
        try {
          const archRes = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=500`);
          const archOrders = archRes.data?.data || [];
          archOrders.forEach((o: any) => {
            const id = String(o.id || o.order_id);
            merged.set(id, { ...o, _source: 'archive', _jobId: job.job_id });
          });
        } catch (e) {
          console.warn('[Analytics] Failed to fetch archive orders');
        }
      }
      
      // 2. Fetch Live Orders for this day
      try {
        const liveRes = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=500`);
        const allLive = liveRes.data?.orders || liveRes.data?.data || liveRes.data || [];
        const dayOrders = allLive.filter((o: any) => {
          const ts = o.created_at || o.business_date;
          return ts && (ts.startsWith(day) || new Date(ts).toLocaleDateString('en-CA') === day);
        });
        dayOrders.forEach((o: any) => {
          const id = String(o.id || o.order_id);
          const existing = merged.get(id);
          merged.set(id, { ...o, _source: existing ? 'both' : 'live' });
        });
      } catch (e) {
        console.warn('[Analytics] Failed to fetch live orders');
      }
      
      const sorted = Array.from(merged.values()).sort((a, b) => 
        new Date(b.created_at || b.business_date).getTime() - new Date(a.created_at || a.business_date).getTime()
      );
      setInspectOrders(sorted);
    } catch (err) {
      console.error('[Analytics] Inspect day failed', err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Fetch items for a specific order
  const fetchOrderItemsForInspect = async (orderId: number, order: any) => {
    if (inspectItems[orderId]) return;
    
    setLoadingItems(orderId);
    try {
      // Check if items are already in the order object
      if (order.items && order.items.length > 0) {
        setInspectItems(prev => ({ ...prev, [orderId]: order.items }));
        return;
      }
      
      if (order._source === 'archive' && order._jobId) {
        // Fetch from archive
        const itemsRes = await archiveApi.get(`/archive/${order._jobId}/query/order_items?limit=500`);
        const allItems = itemsRes.data?.data || [];
        const items = allItems.filter((item: any) => 
          String(item.order_id) === String(orderId)
        );
        setInspectItems(prev => ({ ...prev, [orderId]: items }));
      } else {
        // For live orders, try to use GET /orders/{id} instead of /orders/{id}/full
        try {
          const res = await mainApi.get(`/orders/${orderId}`);
          const items = res.data?.items || res.data?.order_items || [];
          setInspectItems(prev => ({ ...prev, [orderId]: items }));
        } catch (e) {
          // If that fails too, mark as no items available
          console.warn('[Analytics] Could not fetch items for live order', orderId);
          setInspectItems(prev => ({ ...prev, [orderId]: [] }));
        }
      }
    } catch (err) {
      console.error('[Analytics] Failed to fetch items', err);
      setInspectItems(prev => ({ ...prev, [orderId]: [] }));
    } finally {
      setLoadingItems(null);
    }
  };

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
           <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-2">
             <BarChart3 className="h-8 w-8 text-blue-600" />
             Analytics & Data
           </h1>
           <p className="text-slate-500 mt-1">Comprehensive view of Live and Archive databases</p>
        </div>
        
        {/* Date Controls could go here */}
        <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
            <Button 
               variant={activeTab === 'analytics' ? 'default' : 'ghost'} 
               onClick={() => setActiveTab('analytics')}
               className="gap-2"
            >
               <TrendingUp className="h-4 w-4" /> Analytics
            </Button>
            <Button 
               variant={activeTab === 'inspector' ? 'default' : 'ghost'} 
               onClick={() => setActiveTab('inspector')}
               className="gap-2"
            >
               <Database className="h-4 w-4" /> DB Inspector
            </Button>
        </div>
      </div>

      {loading ? (
          <div className="flex justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
          </div>
      ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-0 shadow-lg">
                    <CardContent className="p-6">
                        <p className="text-blue-100 font-medium mb-1">Total Revenue (Period)</p>
                        <p className="text-3xl font-bold">Rs. {totalRevenue.toLocaleString()}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <p className="text-slate-500 font-medium mb-1">Total Orders</p>
                        <p className="text-3xl font-bold text-slate-900">{totalOrders}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                         <p className="text-slate-500 font-medium mb-1">Avg Order Value</p>
                         <p className="text-3xl font-bold text-slate-900">Rs. {(totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0).toLocaleString()}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                         <p className="text-slate-500 font-medium mb-1">Archive Coverage</p>
                         <div className="flex items-baseline gap-2">
                            <p className="text-3xl font-bold text-green-600">
                                {archiveJobs.filter(j => ['EXPORTED', 'SYNCED'].includes(j.status)).length}
                            </p>
                            <span className="text-slate-400">/ {unifiedData.length} days</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* TAB CONTENT */}
            {activeTab === 'analytics' && (
                <Card>
                    <CardHeader>
                        <CardTitle>Daily Revenue Trend</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-64 flex items-end gap-2 mt-4">
                            {unifiedData.slice(0, 30).reverse().map((day) => (
                                <div key={day.dateStr} className="flex-1 flex flex-col items-center group relative">
                                    {/* Tooltip */}
                                    <div className="absolute bottom-full mb-2 hidden group-hover:block bg-slate-900 text-white text-xs p-2 rounded z-10 whitespace-nowrap">
                                        {day.dateStr}: Rs. {day.salesRevenue.toLocaleString()}
                                    </div>
                                    
                                    {/* Bar */}
                                    <div 
                                        className="w-full bg-blue-500 rounded-t-sm hover:bg-blue-600 transition-all"
                                        style={{ height: `${(day.salesRevenue / maxRevenue) * 100}%` }}
                                    ></div>
                                    
                                    {/* Date Label */}
                                    <span className="text-[10px] text-slate-400 mt-2 rotate-45 origin-left truncate w-full">
                                        {format(day.date, 'd MMM')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {activeTab === 'inspector' && (
              <div className="space-y-4">
                <Card className="overflow-hidden">
                    <CardHeader className="bg-slate-50 border-b">
                        <CardTitle>Unified Data Log</CardTitle>
                    </CardHeader>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-100 text-slate-600 font-medium border-b">
                                <tr>
                                    <th className="p-4">Date</th>
                                    <th className="p-4" title="Aggregated Sales Data (Includes confirmed Live and Archived orders)">Sales DB (Total)</th>
                                    <th className="p-4">Archive Status</th>
                                    <th className="p-4">Archive Count</th>
                                    <th className="p-4">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {unifiedData.map(day => (
                                    <React.Fragment key={day.dateStr}>
                                    <tr className="hover:bg-slate-50">
                                        <td className="p-4 font-medium">{format(day.date, 'MMM d, yyyy')}</td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="font-semibold">{day.salesOrders} orders</span>
                                                <span className="text-slate-500 text-xs">Rs. {day.salesRevenue.toLocaleString()}</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            {['EXPORTED', 'SYNCED'].includes(day.archiveStatus) ? (
                                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                                    <CheckCircle2 className="h-3.5 w-3.5" /> Archived
                                                </span>
                                            ) : day.archiveStatus === 'NOT_ARCHIVED' ? (
                                                 <span className="text-slate-400 text-xs italic">Not Archived</span>
                                            ) : (
                                                 <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                                    {day.archiveStatus}
                                                 </span>
                                            )}
                                        </td>
                                        <td className="p-4 text-slate-600">
                                            {['EXPORTED', 'SYNCED'].includes(day.archiveStatus) ? (
                                                <div className="flex items-center gap-2">
                                                    <span>{day.archiveCount} records</span>
                                                    {day.salesOrders !== day.archiveCount && (
                                                        <div title="Count mismatch with Sales DB" className="text-amber-500 cursor-help">
                                                            <AlertCircle className="h-4 w-4" />
                                                        </div>
                                                    )}
                                                </div>
                                            ) : '-'}
                                        </td>
                                        <td className="p-4">
                                            <Button 
                                                variant={inspectingDay === day.dateStr ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => inspectDay(day.dateStr)}
                                                className="gap-2"
                                            >
                                                {inspectingDay === day.dateStr ? <ChevronUp className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                                {inspectingDay === day.dateStr ? 'Close' : 'Inspect'}
                                            </Button>
                                        </td>
                                    </tr>
                                    {/* Inline Detail View Panel Row */}
                                    {inspectingDay === day.dateStr && (
                                        <tr className="bg-slate-50 border-t border-b border-blue-100 shadow-inner">
                                            <td colSpan={5} className="p-4 md:p-6">
                                                <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                                    <div className="bg-gradient-to-r from-blue-50 to-slate-50 border-b p-4 flex justify-between items-center">
                                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                                            📋 Orders for {format(new Date(inspectingDay), 'MMMM d, yyyy')}
                                                        </h3>
                                                        <Button variant="ghost" size="sm" onClick={() => setInspectingDay(null)} className="hover:bg-red-50 hover:text-red-600">
                                                            ✕ Close
                                                        </Button>
                                                    </div>
                                                    
                                                    <div className="p-0">
                                                      {inspectLoading ? (
                                                        <div className="flex justify-center py-12">
                                                          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                                                        </div>
                                                      ) : inspectOrders.length === 0 ? (
                                                        <div className="text-center py-12 text-slate-500">
                                                          No orders found for this day
                                                        </div>
                                                      ) : (
                                                        <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
                                                          {inspectOrders.map((order: any) => {
                                                            const orderId = order.id || order.order_id;
                                                            const isExpanded = expandedOrderId === orderId;
                                                            
                                                            return (
                                                              <div key={orderId}>
                                                                {/* Order Row */}
                                                                <div 
                                                                  className={cn(
                                                                      "flex items-center gap-4 p-4 hover:bg-slate-50 cursor-pointer transition-colors",
                                                                      isExpanded && "bg-blue-50/50"
                                                                  )}
                                                                  onClick={() => {
                                                                    const newExpanded = isExpanded ? null : orderId;
                                                                    setExpandedOrderId(newExpanded);
                                                                    if (newExpanded !== null) fetchOrderItemsForInspect(orderId, order);
                                                                  }}
                                                                >
                                                                  <div className="flex-1">
                                                                    <div className="flex items-center gap-2">
                                                                      <span className="font-semibold text-slate-900">#{orderId}</span>
                                                                      <span className={cn(
                                                                        "px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-full border",
                                                                        order._source === 'both' ? "bg-purple-100 text-purple-700 border-purple-200" :
                                                                        order._source === 'archive' ? "bg-amber-100 text-amber-700 border-amber-200" :
                                                                        "bg-green-100 text-green-700 border-green-200"
                                                                      )}>
                                                                        {order._source === 'both' ? 'Live & Archived' : order._source === 'archive' ? 'Archived' : 'Live'}
                                                                      </span>
                                                                    </div>
                                                                    <p className="text-xs text-slate-500 mt-1">
                                                                      {order.created_at ? format(new Date(order.created_at), 'HH:mm') : ''} • <span className="capitalize">{order.status}</span> • <span className="capitalize">{order.channel || 'dine-in'}</span>
                                                                    </p>
                                                                  </div>
                                                                  <div className="text-right">
                                                                    <p className="font-bold text-slate-900">Rs. {(order.total || order.net_amount || order.grand_total || 0).toLocaleString()}</p>
                                                                  </div>
                                                                  <div className="text-slate-400">
                                                                    {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                                  </div>
                                                                </div>
                                                                
                                                                {/* Expanded Details */}
                                                                {isExpanded && (
                                                                  <div className="bg-slate-50 px-6 py-6 border-t space-y-6 animate-in slide-in-from-top-1 duration-200">
                                                                    
                                                                    {/* 1. Info Grid */}
                                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-white p-4 rounded border border-slate-200 shadow-sm">
                                                                      <div>
                                                                        <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1">Source & Channel</p>
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="font-semibold text-slate-700 capitalize">{order.channel || 'dine-in'}</span>
                                                                            <span className="text-xs text-slate-400">({order._source})</span>
                                                                        </div>
                                                                      </div>
                                                                      <div>
                                                                        <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1">Table Info</p>
                                                                        <p className="font-medium text-slate-700">
                                                                            {order.table_name || order.table_id ? `Table ${order.table_name || order.table_id}` : 'No Table'}
                                                                            {order.number_of_guests && <span className="text-slate-400 font-normal ml-1">({order.number_of_guests} guests)</span>}
                                                                        </p>
                                                                      </div>
                                                                      <div>
                                                                        <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1">Customer</p>
                                                                        <p className="font-medium text-slate-700">{order.customer_name || 'Walk-in'}</p>
                                                                        {order.customer_phone && <p className="text-xs text-slate-400">{order.customer_phone}</p>}
                                                                      </div>
                                                                      <div>
                                                                        <p className="text-slate-400 text-[10px] uppercase font-bold tracking-wider mb-1">Status</p>
                                                                        <span className={cn(
                                                                            "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize",
                                                                            order.status === 'completed' ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-700"
                                                                        )}>
                                                                            {order.status}
                                                                        </span>
                                                                      </div>
                                                                    </div>

                                                                    <div className="grid md:grid-cols-2 gap-6">
                                                                        {/* 2. Order Items */}
                                                                        <div className="bg-white rounded border border-slate-200 p-4 shadow-sm">
                                                                            <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center justify-between">
                                                                                <span>🍽️ Order Items</span>
                                                                                {loadingItems === orderId && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                                                                            </h4>
                                                                            
                                                                            {(() => {
                                                                                const items = inspectItems[orderId] || order.items || [];
                                                                                
                                                                                if (items.length === 0 && loadingItems === orderId) {
                                                                                    return <div className="py-8 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-slate-400" /></div>;
                                                                                }
                                                                                
                                                                                if (items.length === 0) {
                                                                                    return <p className="text-sm text-slate-400 italic text-center py-4">No items data available</p>;
                                                                                }

                                                                                return (
                                                                                    <table className="w-full text-sm">
                                                                                        <thead className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                                                                                            <tr>
                                                                                                <th className="text-left p-2 font-semibold">Item</th>
                                                                                                <th className="text-center p-2 font-semibold">Qty</th>
                                                                                                <th className="text-right p-2 font-semibold">Price</th>
                                                                                                <th className="text-right p-2 font-semibold">Total</th>
                                                                                            </tr>
                                                                                        </thead>
                                                                                        <tbody className="divide-y divide-slate-100">
                                                                                            {items.map((item: any, idx: number) => {
                                                                                                // ROBUST KEY MAPPING
                                                                                                const name = item.name_snapshot || item.name || item.item_name || item.menu_item_name || `Item #${item.menu_item_id}`;
                                                                                                const qty = item.qty || item.quantity || 1;
                                                                                                const price = item.unit_price || item.price || 0;
                                                                                                const total = item.line_total || item.total || (qty * price);
                                                                                                
                                                                                                return (
                                                                                                    <tr key={idx}>
                                                                                                        <td className="p-2 font-medium text-slate-700">
                                                                                                            {name}
                                                                                                            {item.notes && <p className="text-[10px] text-slate-400 italic">{item.notes}</p>}
                                                                                                        </td>
                                                                                                        <td className="p-2 text-center text-slate-600">{qty}</td>
                                                                                                        <td className="p-2 text-right text-slate-600">Rs. {price.toLocaleString()}</td>
                                                                                                        <td className="p-2 text-right font-medium text-slate-800">Rs. {total.toLocaleString()}</td>
                                                                                                    </tr>
                                                                                                );
                                                                                            })}
                                                                                        </tbody>
                                                                                    </table>
                                                                                );
                                                                            })()}
                                                                        </div>

                                                                        {/* 3. Financials & Payments */}
                                                                        <div className="space-y-4">
                                                                            {/* Payments */}
                                                                            <div className="bg-white rounded border border-slate-200 p-4 shadow-sm">
                                                                                <h4 className="text-sm font-bold text-slate-800 mb-3">💳 Payments</h4>
                                                                                {!order.payments || order.payments.length === 0 ? (
                                                                                    <p className="text-sm text-slate-400 italic">No payment records</p>
                                                                                ) : (
                                                                                    <div className="divide-y divide-slate-100">
                                                                                        {order.payments.map((pay: any, idx: number) => (
                                                                                            <div key={idx} className="flex justify-between items-center py-2 text-sm first:pt-0 last:pb-0">
                                                                                                <div>
                                                                                                    <p className="font-medium text-slate-700 capitalize">{pay.method || 'Unknown Method'}</p>
                                                                                                    <p className="text-[10px] text-slate-400">{pay.created_at ? format(new Date(pay.created_at), 'HH:mm') : ''}</p>
                                                                                                </div>
                                                                                                <div className="text-right">
                                                                                                   <p className="font-bold text-slate-900">Rs. {pay.amount?.toLocaleString()}</p>
                                                                                                   <span className="text-[10px] text-green-600 font-medium uppercase tracking-wide">{pay.status || 'success'}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                )}
                                                                            </div>

                                                                            {/* Bill Summary */}
                                                                            <div className="bg-slate-100 rounded p-4 space-y-2 text-sm">
                                                                                <div className="flex justify-between text-slate-600">
                                                                                    <span>Subtotal</span>
                                                                                    <span>Rs. {(order.subtotal || 0).toLocaleString()}</span>
                                                                                </div>
                                                                                {(order.tax_total > 0 || order.service_charge > 0) && (
                                                                                    <div className="flex justify-between text-slate-600">
                                                                                        <span>Tax & Service</span>
                                                                                        <span>Rs. {((order.tax_total || 0) + (order.service_charge || 0)).toLocaleString()}</span>
                                                                                    </div>
                                                                                )}
                                                                                 {order.discount_total > 0 && (
                                                                                    <div className="flex justify-between text-green-600 font-medium">
                                                                                        <span>Discount</span>
                                                                                        <span>- Rs. {order.discount_total.toLocaleString()}</span>
                                                                                    </div>
                                                                                )}
                                                                                <div className="border-t border-slate-200 pt-2 flex justify-between items-center mt-2">
                                                                                    <span className="font-bold text-slate-900">Grand Total</span>
                                                                                    <span className="font-bold text-lg text-blue-600">Rs. {(order.grand_total || order.total || 0).toLocaleString()}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    {/* Raw JSON Toggle */}
                                                                    <details className="mt-4">
                                                                      <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-blue-600 transition-colors">
                                                                          View Raw JSON Data
                                                                      </summary>
                                                                      <pre className="mt-2 p-3 bg-slate-950 text-green-400 rounded text-xs overflow-auto max-h-48 border border-slate-800">
                                                                        {JSON.stringify(order, null, 2)}
                                                                      </pre>
                                                                    </details>
                                                                  </div>
                                                                )}
                                                              </div>
                                                            );
                                                          })}
                                                        </div>
                                                      )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
              </div>
            )}
          </>
      )}
    </div>
  );
}
