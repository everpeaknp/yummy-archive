"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { format, parseISO } from 'date-fns';
import { 
  Loader2, Archive, ArrowLeft, CheckCircle, ChevronDown, ChevronUp,
  Calendar, ShoppingBag, Clock, CreditCard, AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Order {
  id: number;
  order_id?: number;
  created_at: string;
  total: number;
  net_amount?: number;
  grand_total?: number;
  status: string;
  channel?: string;
  items_count?: number;
  isDeleted?: boolean;
  business_date?: string;
  _source?: 'live' | 'archive' | 'both';
  customer_name?: string;
  payment_method?: string;
}

export default function OrdersDayPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const day = params.day as string;

  const [orders, setOrders] = useState<Order[]>([]);
  const [liveOrders, setLiveOrders] = useState<Order[]>([]);
  const [archivedOrdersData, setArchivedOrdersData] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [archivedOrderIds, setArchivedOrderIds] = useState<Set<number>>(new Set());
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [existingJobId, setExistingJobId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) {
      setLoading(true);
      Promise.all([fetchOrders(), fetchArchivedOrders()]).finally(() => setLoading(false));
    }
  }, [restaurantId, day]);

  // Merge Live and Archived Orders
  useEffect(() => {
    const merged = new Map<string, Order>();
    
    archivedOrdersData.forEach(obj => {
      const o = obj as any;
      const timestamp = o.created_at || o.business_date;
      if (timestamp && (timestamp.startsWith(day) || new Date(timestamp).toLocaleDateString('en-CA') === day)) {
        merged.set(String(o.id || o.order_id), { ...o, isDeleted: true, _source: 'archive' });
      }
    });

    liveOrders.forEach(o => {
      const idKey = String(o.id || o.order_id!);
      const existing = merged.get(idKey);
      merged.set(idKey, { ...o, isDeleted: false, _source: existing ? 'both' : 'live' }); 
    });

    const sorted = Array.from(merged.values()).sort((a, b) => 
      new Date(b.created_at || b.business_date || 0).getTime() - new Date(a.created_at || a.business_date || 0).getTime()
    );
    setOrders(sorted);
  }, [liveOrders, archivedOrdersData, day]);

  const parseOrdersResponse = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw?.orders) return raw.orders;
    if (raw?.data?.orders) return raw.data.orders;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    return [];
  };

  const fetchOrders = async () => {
    try {
      const res = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=500`);
      const allOrders = parseOrdersResponse(res.data);
      const dayOrders = allOrders.filter((order: any) => {
        const timestamp = order.created_at || order.business_date;
        if (!timestamp) return false;
        return timestamp.startsWith(day) || new Date(timestamp).toLocaleDateString('en-CA') === day;
      });
      setLiveOrders(dayOrders);
    } catch (err) {
      console.error("Failed to fetch orders:", err);
    }
  };

  const fetchArchivedOrders = async () => {
    try {
      const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${day}&end_day=${day}`);
      const jobs = jobsRes.data?.jobs || [];
      
      const validStatuses = ['EXPORTED', 'SYNCED'];
      const archivedIds = new Set<number>();
      let allArchivedData: any[] = [];

      for (const job of jobs) {
        if (validStatuses.includes(job.status) && job.archive_day === day) {
          setExistingJobId(job.job_id);
          
          try {
            const manifestRes = await archiveApi.get(`/archive/${job.job_id}/manifest`);
            manifestRes.data?.order_ids?.forEach((id: number) => archivedIds.add(id));
          } catch {}
          
          try {
            const res = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=500`);
            if (res.data?.data) {
              allArchivedData = [...allArchivedData, ...res.data.data];
              res.data.data.forEach((o: any) => archivedIds.add(o.id || o.order_id));
            }
          } catch {}
        }
      }
      
      setArchivedOrderIds(archivedIds);
      setArchivedOrdersData(allArchivedData);
    } catch (err) {
      console.warn("Archive fetch failed:", err);
    }
  };

  const getOrderTotal = (order: Order) => order.grand_total || order.total || order.net_amount || 0;

  const formatTime = (dateStr: string) => {
    try { return format(parseISO(dateStr), 'HH:mm'); } 
    catch { return '--:--'; }
  };

  const handleArchive = async () => {
    const newOrders = orders.filter(o => o._source === 'live');
    const isAppend = existingJobId && archivedOrderIds.size > 0;
    
    const message = isAppend 
      ? `Add ${newOrders.length} new order(s) to existing archive?`
      : `Archive all ${orders.length} order(s) for ${formattedDate}?`;
    
    if (!confirm(message)) return;

    setArchiving(true);
    try {
      const payload: any = {
        restaurant_id: restaurantId,
        start_date: `${day}T00:00:00Z`,
        end_date: `${day}T23:59:59Z`
      };

      const res = await archiveApi.post('/jobs/archive', payload);
      const jobId = res.data.job_id || res.data.jobs?.[0]?.job_id;
      
      if (jobId) {
        router.push(`/archive/${jobId}`);
      }
    } catch (err: any) {
      alert(`Failed to archive: ${err.response?.data?.detail || err.message}`);
    } finally {
      setArchiving(false);
    }
  };

  if (!isAuthenticated) return null;

  const formattedDate = (() => {
    try { return format(parseISO(day), 'EEEE, MMM d'); } 
    catch { return day; }
  })();

  const newOrdersCount = orders.filter(o => o._source === 'live').length;
  const totalRevenue = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);
  const hasExistingArchive = archivedOrderIds.size > 0;

  return (
    <div className="space-y-4 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.push('/')} 
          className="h-10 w-10 rounded-full p-0 shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">{formattedDate}</h1>
          <p className="text-sm text-slate-500">Daily Orders Overview</p>
        </div>
      </div>

      {/* Hero Stats Card */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-5 text-white">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-3xl font-bold">{orders.length}</p>
              <p className="text-sm text-blue-200">Total Orders</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-emerald-300">{archivedOrderIds.size}</p>
              <p className="text-sm text-blue-200">Archived</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-amber-300">{newOrdersCount}</p>
              <p className="text-sm text-blue-200">New</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/20 text-center">
            <p className="text-2xl font-bold">Rs. {totalRevenue.toLocaleString()}</p>
            <p className="text-sm text-blue-200">Total Revenue</p>
          </div>
        </div>
      </Card>

      {/* Status Alert */}
      {hasExistingArchive && newOrdersCount > 0 && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-800">{newOrdersCount} new order(s) not archived yet</p>
            <p className="text-sm text-amber-600">Tap the button below to add them to the archive</p>
          </div>
        </div>
      )}

      {hasExistingArchive && newOrdersCount === 0 && (
        <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          <div>
            <p className="font-medium text-emerald-800">All orders are archived</p>
            <p className="text-sm text-emerald-600">This day's data is safely backed up</p>
          </div>
        </div>
      )}

      {/* Orders List */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900 px-1">Orders</h2>
        
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-3" />
            <p className="text-slate-500">Loading orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <Card className="p-8 text-center">
            <ShoppingBag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No orders found for this day</p>
          </Card>
        ) : (
          orders.map(order => {
            const orderId = order.id || order.order_id!;
            const isArchived = archivedOrderIds.has(orderId) || order._source === 'both' || order._source === 'archive';
            const isExpanded = expandedOrderId === orderId;

            return (
              <Card 
                key={orderId} 
                className={cn(
                  "overflow-hidden transition-all duration-200 hover:shadow-md",
                  order.isDeleted && "opacity-60"
                )}
              >
                <CardContent className="p-0">
                  {/* Order Row */}
                  <div 
                    className="flex items-center gap-3 p-4 cursor-pointer"
                    onClick={() => setExpandedOrderId(isExpanded ? null : orderId)}
                  >
                    {/* Order Number Badge */}
                    <div className={cn(
                      "h-12 w-12 rounded-xl flex items-center justify-center shrink-0 font-bold text-white",
                      isArchived 
                        ? "bg-gradient-to-br from-emerald-400 to-emerald-600" 
                        : "bg-gradient-to-br from-blue-400 to-blue-600"
                    )}>
                      #{orderId % 1000}
                    </div>

                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">Order #{orderId}</span>
                        {isArchived ? (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 rounded-full">
                            ✓ Archived
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded-full">
                            New
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(order.created_at)}</span>
                        <span>•</span>
                        <span className="capitalize">{order.status}</span>
                      </div>
                    </div>

                    {/* Amount & Expand */}
                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-900">Rs. {getOrderTotal(order).toLocaleString()}</p>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400 ml-auto mt-1" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400 ml-auto mt-1" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="bg-slate-50 p-4 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Order ID</p>
                          <p className="font-medium">{orderId}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Time</p>
                          <p className="font-medium">{order.created_at ? format(new Date(order.created_at), 'HH:mm') : 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Status</p>
                          <p className="font-medium capitalize">{order.status}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Channel</p>
                          <p className="font-medium capitalize">{order.channel || 'Dine-in'}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-slate-500 text-xs uppercase mb-1">Total Amount</p>
                          <p className="font-bold text-lg">Rs. {getOrderTotal(order).toLocaleString()}</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-slate-500 text-xs uppercase mb-1">Archive Status</p>
                          <p className={cn("font-medium", isArchived ? "text-emerald-600" : "text-blue-600")}>
                            {isArchived ? "✓ Safely archived" : "Not yet archived"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Sticky Archive Button */}
      {orders.length > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-0 right-0 px-4 z-40">
          <div className="max-w-xl mx-auto">
            <Button 
              onClick={handleArchive}
              disabled={archiving || (hasExistingArchive && newOrdersCount === 0)}
              className={cn(
                "w-full h-14 text-base font-semibold rounded-2xl shadow-lg",
                hasExistingArchive && newOrdersCount > 0
                  ? "bg-amber-500 hover:bg-amber-600"
                  : hasExistingArchive
                    ? "bg-slate-400"
                    : "bg-blue-600 hover:bg-blue-700"
              )}
            >
              {archiving ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : hasExistingArchive && newOrdersCount > 0 ? (
                <>
                  <Archive className="h-5 w-5 mr-2" />
                  Add {newOrdersCount} New Orders to Archive
                </>
              ) : hasExistingArchive ? (
                <>
                  <CheckCircle className="h-5 w-5 mr-2" />
                  All Orders Archived
                </>
              ) : (
                <>
                  <Archive className="h-5 w-5 mr-2" />
                  Archive All {orders.length} Orders
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
