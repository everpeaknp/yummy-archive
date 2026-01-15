"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { format, parseISO } from 'date-fns';
import { Loader2, Archive, ArrowLeft, CheckCircle, Square, CheckSquare, AlertTriangle, ChevronDown, ChevronUp, Eye } from 'lucide-react';
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
  // Extended fields for detailed view
  customer_name?: string;
  customer_phone?: string;
  payment_method?: string;
  discount?: number;
  tax?: number;
  notes?: string;
  items?: any[];
}

export default function OrdersDayPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const day = params.day as string; // YYYY-MM-DD

  const [orders, setOrders] = useState<Order[]>([]);
  const [liveOrders, setLiveOrders] = useState<Order[]>([]);
  const [archivedOrdersData, setArchivedOrdersData] = useState<Order[]>([]);
  
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [archivedOrderIds, setArchivedOrderIds] = useState<Set<number>>(new Set());
  const [appendMode, setAppendMode] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [orderItems, setOrderItems] = useState<Record<number, any[]>>({});
  const [loadingItems, setLoadingItems] = useState<number | null>(null);
  
  // Debug State (No window access)
  const [debugError, setDebugError] = useState<string | null>(null);
  const [lastDebugLog, setLastDebugLog] = useState<string>('');
  const [debugState, setDebugState] = useState({
    totalFetched: 0,
    dateRange: 'N/A'
  });

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) {
      // Fetch both Live and Archived orders in PARALLEL for instant loading
      setLoading(true);
      Promise.all([
        fetchOrders(),
        fetchArchivedOrders()
      ]).finally(() => {
        setLoading(false);
      });
    }
  }, [restaurantId, day]);

  // Merge Live and Archived Orders
  useEffect(() => {
    const merged = new Map<string, Order>();
    
    // 1. Add Archived Orders (mark them as deleted from main DB initially)
    // Filter to ensure we only show orders for THIS day (since we fetch a wide range of jobs)
    archivedOrdersData.forEach(obj => {
      const o = obj as any;
      const timestamp = o.created_at || o.business_date;
      
      let match = false;
      if (timestamp) {
          match = timestamp.startsWith(day);
          if (!match) {
             try {
                const d = new Date(timestamp);
                match = d.toLocaleDateString('en-CA') === day;
             } catch(e) {}
          }
          if (!match && o.business_date) {
             match = o.business_date.startsWith(day);
          }
      }

      if (match) {
        // Strict String Normalization to prevent any type-based duplicates
        const idKey = String(o.id || o.order_id!);
        // Mark as IS_ARCHIVED_SOURCE
        merged.set(idKey, { ...o, status: o.status || 'archived', isDeleted: true, _source: 'archive' });
      }
    });

    // 2. Add/Override with Live Orders (these exist in DB)
    liveOrders.forEach(o => {
      const idKey = String(o.id || o.order_id!);
      const existing = merged.get(idKey);
      
      // If order exists in both, it's NOT deleted (it's live), but we keep it unique.
      merged.set(idKey, { ...o, isDeleted: false, _source: existing ? 'both' : 'live' }); 
    });

    const sorted = Array.from(merged.values()).sort((a: any, b: any) => {
       const tA = new Date(a.created_at || a.business_date).getTime();
       const tB = new Date(b.created_at || b.business_date).getTime();
       return tB - tA;
    });
    setOrders(sorted);
  }, [liveOrders, archivedOrdersData]);

  // --- HELPER: Robust Response Parser ---
  const parseOrdersResponse = (raw: any): any[] => {
      let data: any[] = [];
      if (Array.isArray(raw)) data = raw;
      else if (raw?.orders && Array.isArray(raw.orders)) data = raw.orders;
      else if (raw?.data && Array.isArray(raw.data)) data = raw.data;
      else if (raw?.data?.orders && Array.isArray(raw.data.orders)) data = raw.data.orders;
      else if (raw?.results && Array.isArray(raw.results)) data = raw.results;
      else if (raw?.data?.data && Array.isArray(raw.data.data)) data = raw.data.data;
      
      return data || [];
  };

  const fetchOrders = async (querySuffix?: string) => {
    // Loading state is handled by Promise.all in useEffect
    setDebugError(null);
    let debugLogs: string[] = [];
    
    try {
      if (!restaurantId) {
        setDebugError("No restaurant ID available");
        return;
      }

      let allOrders: any[] = [];
      
      if (querySuffix) {
        // Test query suffix mode
        const suffix = querySuffix.startsWith('&') ? querySuffix : `&status=${querySuffix}`;
        debugLogs.push(`TESTING QUERY: "${suffix}"`);
        
        const url = `/orders/?restaurant_id=${restaurantId}&limit=200${suffix}`;
        const res = await mainApi.get(url);
        
        allOrders = parseOrdersResponse(res.data);
        debugLogs.push(`Success! Got ${allOrders.length} orders.`);
      } else {
        // Fetch MORE orders and rely on Client-Side Filtering to catch everything
        // This avoids missing orders due to timezone mismatches on server
        debugLogs.push(`Fetching last 500 orders (unfiltered)`);
        
        const url = `/orders/?restaurant_id=${restaurantId}&limit=500`; // Fetch 500 to cover full day + buffer 
        const res = await mainApi.get(url);
        
        const raw = res.data;
        debugLogs.push(`Response Keys: ${Object.keys(raw || {}).join(', ')}`);
        
        // Use robust parser
        allOrders = parseOrdersResponse(raw);
        debugLogs.push(`Extracted ${allOrders.length} orders from API`);
      }

      // Final Safety Check
      if (!Array.isArray(allOrders)) {
          debugLogs.push("Critical: allOrders is not an array. Resetting to empty.");
          allOrders = [];
      }

      // Deduplicate State Update
      let uniqueOrders = [];
      try {
        uniqueOrders = Array.from(new Map(allOrders.map(o => [o.id || o.order_id, o])).values());
      } catch (e) {
        debugLogs.push("Error during deduplication map");
        uniqueOrders = allOrders;
      }
      
      // Update Debug State
      let range = 'No orders fetched';
      if (uniqueOrders.length > 0) {
        const dates = uniqueOrders.map(o => o.created_at || o.business_date).filter(Boolean).sort();
        range = `${dates[0]} to ${dates[dates.length - 1]}`;
        const foundStatuses = Array.from(new Set(uniqueOrders.map(o => o.status)));
        debugLogs.push(`Statuses found in batch: ${foundStatuses.join(', ')}`);
      }
      setDebugState({
        totalFetched: uniqueOrders.length,
        dateRange: range
      });

      // Filter by date (robustly handling timezones)
      const rejected: any[] = [];
      const dayOrders = uniqueOrders.filter((order: any) => {
        const timestamp = order.created_at || order.business_date;
        if (!timestamp) return false;
        
        // Convert API timestamp to YYYY-MM-DD in LOCAL time (or whatever 'day' represents)
        // 'day' is "2026-01-14". 
        // If API returns "2026-01-14T03:00:00Z" (UTC), and we are in +05:45, that is 08:45 AM Local. 
        // We should just match the string prefix if it matches 'day', OR check business_date
        
        // Strategy: Match exact string prefix first (fastest)
        let match = timestamp.startsWith(day);
        
        // If not matching prefix, try timezone conversion
        if (!match) {
            try {
                const d = new Date(timestamp);
                const localDate = d.toLocaleDateString('en-CA'); // YYYY-MM-DD
                match = localDate === day;
            } catch (e) {}
        }

        // Also check explicit business_date matching if available and different
        if (!match && order.business_date) {
            match = order.business_date.startsWith(day);
        }

        if (!match) {
             rejected.push({ id: order.id||order.order_id, date: timestamp, day: day });
        }
        return match;
      });
      
      setLiveOrders(dayOrders);
      if (uniqueOrders.length === 0) {
         setDebugError("Fetched 0 orders. Try the Test Buttons below.");
      }
    } catch (err: any) {
      console.error("Failed to fetch orders:", err);
      const msg = err.response?.data?.detail 
        ? JSON.stringify(err.response.data) 
        : (err.message || 'Unknown Error');
      
      setDebugError(`Fail: ${msg}`);
      debugLogs.push(`ERROR: ${msg}`);
      setOrders([]);
    } finally {
      // setLoading is now handled by Promise.all in useEffect
      setLastDebugLog(debugLogs.join('\n'));
    }
  };


  const fetchArchivedOrders = async () => {
    try {
      // Check if there's an archive job for this day
      // Widen the search to catch timezone shifts (yesterday/tomorrow)
      const dateDate = new Date(day);
      const prevDate = new Date(dateDate); prevDate.setDate(prevDate.getDate() - 1);
      const nextDate = new Date(dateDate); nextDate.setDate(nextDate.getDate() + 1);
      
      const startDay = prevDate.toISOString().split('T')[0];
      const endDay = nextDate.toISOString().split('T')[0];
      
      console.log(`[OrdersDayPage] searching archives from ${startDay} to ${endDay}`);

      let jobs: any[] = [];
      try {
        const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${startDay}&end_day=${endDay}`);
        jobs = jobsRes.data?.jobs || [];
        console.log(`[OrdersDayPage] Found ${jobs.length} jobs.`, jobs);
      } catch (jobsError: any) {
        // Archive backend might be down - fail gracefully
        console.warn('[OrdersDayPage] Archive jobs fetch failed (backend may be down):', jobsError.message);
        // Continue with empty jobs - only live orders will show
        return; 
      }
      
      // Get order IDs from any EXPORTED or SYNCED jobs for THIS SPECIFIC DAY ONLY
      // Per new API: SYNCED means archive is already up-to-date, EXPORTED means complete
      const validStatuses = ['EXPORTED', 'SYNCED'];
      const archivedIds = new Set<number>();
      for (const job of jobs) {
        // IMPORTANT: Only process jobs for THIS day
        if (validStatuses.includes(job.status) && job.archive_day === day) {
          // We have a complete/synced job exactly for THIS day, enable valid append mode
          setAppendMode(true);
          
          try {
            const manifestRes = await archiveApi.get(`/archive/${job.job_id}/manifest`);
            // If manifest has order IDs, add them
            if (manifestRes.data?.order_ids) {
              manifestRes.data.order_ids.forEach((id: number) => archivedIds.add(id));
            }
          } catch (e) {
            // Manifest might not be available (ephemeral storage / 410 Gone)
            console.warn('[OrdersDayPage] Manifest not available for job', job.job_id);
          }
        }
      }
      setArchivedOrderIds(archivedIds);
      
      // Now Fetch DATA for jobs of THIS day to show archived orders
      let allArchivedData: any[] = [];
      for (const job of jobs) {
        // IMPORTANT: Only process jobs for THIS day
        if (validStatuses.includes(job.status) && job.archive_day === day) {
          try {
             // Fetch orders from archive query
             const res = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=500`);
             if (res.data?.data) {
                allArchivedData = [...allArchivedData, ...res.data.data];
                // Also update archivedIds from the actual fetched data
                res.data.data.forEach((o: any) => {
                  const id = o.id || o.order_id;
                  if (id) archivedIds.add(id);
                });
             }
          } catch (e: any) { 
            // 410 Gone = manifest expired, 500 = server error
            console.warn("[OrdersDayPage] Failed to fetch archive data for job", job.job_id, e?.response?.status); 
          }
        }
      }
      // Update archivedOrderIds again with IDs from fetched data
      setArchivedOrderIds(new Set(archivedIds));
      setArchivedOrdersData(allArchivedData);
      
    } catch (err) {
      console.error("Failed to check archived orders:", err);
    }
  };

  // Fetch Order Items (from Live DB or Archive)
  const fetchOrderItems = async (orderId: number, order: Order) => {
    // Already loaded?
    if (orderItems[orderId]) return;
    
    setLoadingItems(orderId);
    try {
      if (order._source === 'archive') {
        // Find the job that contains this order
        // We need to query order_items from archive
        // Get archive jobs for the day
        const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${day}&end_day=${day}`);
        const jobs = jobsRes.data?.jobs || [];
        const exportedJob = jobs.find((j: any) => ['EXPORTED', 'SYNCED'].includes(j.status));
        
        if (exportedJob) {
          const itemsRes = await archiveApi.get(`/archive/${exportedJob.job_id}/query/order_items?limit=500`);
          const allItems = itemsRes.data?.data || [];
          // Filter items for this order
          const items = allItems.filter((item: any) => item.order_id === orderId || item.order_id === String(orderId));
          setOrderItems(prev => ({ ...prev, [orderId]: items }));
        }
      } else {
        // Live order - try to fetch from main API
        try {
          const res = await mainApi.get(`/orders/${orderId}`);
          const fullOrder = res.data;
          const items = fullOrder?.items || fullOrder?.order_items || [];
          setOrderItems(prev => ({ ...prev, [orderId]: items }));
        } catch (e) {
          console.warn("[OrdersDayPage] Could not fetch items, order might not support items endpoint");
          setOrderItems(prev => ({ ...prev, [orderId]: [] }));
        }
      }
    } catch (err) {
      console.error("[OrdersDayPage] Failed to fetch items for order", orderId, err);
      setOrderItems(prev => ({ ...prev, [orderId]: [] }));
    } finally {
      setLoadingItems(null);
    }
  };

  const toggleSelect = (orderId: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === orders.length) {
      setSelectedIds(new Set()); // Deselect all
    } else {
      setSelectedIds(new Set(orders.map(o => o.id || o.order_id!)));
    }
  };

  const handleArchiveSelected = async () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one order to archive.");
      return;
    }

    const action = appendMode ? 'Append to archive' : 'Archive full day';
    if (!confirm(`${action}, then mark ${selectedIds.size} selected order(s) for deletion from main DB.\n\nContinue?`)) return;

    setArchiving(true);
    try {
      // Send order_ids - backend will:
      // 1. Determine which day(s) these orders belong to
      // 2. Archive FULL DAY for each day
      // 3. Store order_ids in manifest's delete_order_ids
      const payload: any = {
        restaurant_id: restaurantId,
        order_ids: Array.from(selectedIds)  // Guide's approach
      };
      if (appendMode) {
        payload.append = true;
      }

      const res = await archiveApi.post('/jobs/archive', payload);
      console.log('[OrdersDayPage] Archive response:', res.data);
      const jobId = res.data.job_id || res.data.jobs?.[0]?.job_id;
      console.log('[OrdersDayPage] Navigating to job:', jobId);
      
      const msg = appendMode 
        ? `Full day archived (appended)! Selected orders marked for deletion.`
        : `Full day archived! Selected orders marked for deletion.`;
      
      alert(msg);
      
      // Navigate WITHOUT URL params - manifest has the selection
      setTimeout(() => {
        router.push(`/archive/${jobId}`);
      }, 500);
    } catch (err: any) {
      console.error("Failed to create archive job:", err);
      
      const status = err.response?.status;
      let errorMsg = err.response?.data?.message || err.response?.data?.detail || err.message;
      
      if (status === 500) {
        errorMsg = "Archive Backend is unavailable (500 error). Please check if the Render.com service is running.";
      } else if (status === 502 || status === 503 || status === 504) {
        errorMsg = "Archive Backend is starting up or unavailable. Please wait a moment and try again.";
      }
      
      alert(`Failed to ${action.toLowerCase()}: ${errorMsg}`);
    } finally {
      setArchiving(false);
    }
  };

  const handleArchiveAll = async () => {
    if (orders.length === 0) {
      alert("No orders to archive.");
      return;
    }

    const action = appendMode ? 'Append to archive' : 'Archive full day';
    if (!confirm(`${action} and mark ALL ${orders.length} order(s) for deletion from main DB?\n\nDay: ${day}\n\nContinue?`)) return;

    setArchiving(true);
    try {
      const payload: any = {
        restaurant_id: restaurantId,
        start_date: `${day}T00:00:00Z`,
        end_date: `${day}T23:59:59Z`
      };
      if (appendMode) {
        payload.append = true;
      }

      const res = await archiveApi.post('/jobs/archive', payload);
      console.log('[OrdersDayPage] Archive All response:', res.data);
      
      const jobId = res.data.job_id || res.data.jobs?.[0]?.job_id;
      
      const msg = appendMode 
        ? `Orders appended to existing archive! Job ID: ${jobId}`
        : `Archive job created! Job ID: ${jobId}`;
            
      alert(msg);
      if (jobId) {
          setTimeout(() => {
            router.push(`/archive/${jobId}`);
          }, 500);
      } else {
          console.error("No Job ID returned!");
      }
    } catch (err: any) {
      console.error("Failed to create archive job:", err);
      const errorMsg = err.response?.data?.message || err.message;
      alert(`Failed to ${action.toLowerCase()} job: ` + errorMsg);
    } finally {
      setArchiving(false);
    }
  };

  const getOrderTotal = (order: Order) => {
    return order.total || order.net_amount || order.grand_total || 0;
  };

  const formatTime = (dateStr: string) => {
    try {
      return format(parseISO(dateStr), 'HH:mm');
    } catch {
      return '--:--';
    }
  };

  if (!isAuthenticated) return null;

  const formattedDate = (() => {
    try {
      return format(parseISO(day), 'EEEE, MMMM d, yyyy');
    } catch {
      return day;
    }
  })();

  const unarchivedOrders = orders.filter(o => !archivedOrderIds.has(o.id || o.order_id!));
  const newOrdersCount = unarchivedOrders.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="h-9 w-9 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Orders</h1>
            <p className="text-slate-500 text-sm">{formattedDate}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {archivedOrderIds.size > 0 && (
            <div className="flex items-center gap-2 mr-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
              <label htmlFor="append-toggle" className="text-sm font-medium text-slate-700 cursor-pointer select-none">
                Append to existing
              </label>
              <div 
                className={cn(
                  "w-10 h-5 rounded-full relative cursor-pointer transition-colors duration-200",
                  appendMode ? "bg-blue-600" : "bg-slate-300"
                )}
                onClick={() => setAppendMode(!appendMode)}
              >
                <div className={cn(
                  "absolute top-1 left-1 w-3 h-3 bg-white rounded-full transition-all duration-200",
                  appendMode ? "translate-x-5" : "translate-x-0"
                )} />
              </div>
            </div>
          )}
          
          <Button 
            onClick={handleArchiveAll}
            disabled={archiving || orders.length === 0}
          >
            {archiving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
            {appendMode ? 'Append to Archive' : 'Archive Day'}
          </Button>
        </div>
      </div>

      {/* New Orders Warning */}
      {archivedOrderIds.size > 0 && newOrdersCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800">
                  {newOrdersCount} new order(s) since last archive
                </p>
                <p className="text-sm text-amber-600">
                  Select and archive these orders to keep your archive up to date.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
            <p className="text-sm text-slate-500">Total Orders</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-green-600">{archivedOrderIds.size}</p>
            <p className="text-sm text-slate-500">Archived</p>
          </CardContent>
        </Card>
      </div>

      {/* Orders List */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Order List</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              No orders found for this day
            </div>
          ) : (
            <div className="divide-y">
              {orders.map((order) => {
                const orderId = order.id || order.order_id!;
                const isSelected = selectedIds.has(orderId);
                const isArchived = archivedOrderIds.has(orderId);
                
                return (
                    <div key={orderId} className="border-b border-slate-100 last:border-b-0">
                      <div 
                        className={cn(
                          "flex items-center gap-4 p-4 transition-colors",
                          order.isDeleted ? "cursor-default opacity-50 bg-slate-50" : "hover:bg-slate-50"
                        )}
                      >
                      {/* Order Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">#{orderId}</span>
                          
                          {order._source === 'both' && (
                             <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-700 rounded-full border border-purple-200">
                               Live & Archived
                             </span>
                          )}
                          {(order._source === 'archive' || isArchived) && order._source !== 'both' && (
                             <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                               Archived
                             </span>
                          )}
                          {order._source === 'live' && (
                             <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full border border-green-200">
                               Live
                             </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">
                          {formatTime(order.created_at)} • {order.status} • {order.channel || 'dine-in'}
                          {order.items_count && ` • ${order.items_count} items`}
                        </p>
                      </div>

                      {/* Amount */}
                      <div className="text-right mr-2">
                        <p className="font-semibold text-slate-900">
                          Rs. {getOrderTotal(order).toLocaleString()}
                        </p>
                      </div>
                      
                      {/* Expand Button */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          const newExpanded = expandedOrderId === orderId ? null : orderId;
                          setExpandedOrderId(newExpanded);
                          if (newExpanded !== null) {
                            fetchOrderItems(orderId, order);
                          }
                        }}
                      >
                        {expandedOrderId === orderId ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                    
                    {/* Expanded Details */}
                    {expandedOrderId === orderId && (
                      <div className="bg-slate-50 px-6 py-4 border-t border-slate-200">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Order ID</p>
                            <p className="font-medium">{orderId}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Date & Time</p>
                            <p className="font-medium">{order.created_at ? format(new Date(order.created_at), 'MMM d, yyyy HH:mm') : 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Status</p>
                            <p className="font-medium">{order.status}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Channel</p>
                            <p className="font-medium">{order.channel || 'dine-in'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Grand Total</p>
                            <p className="font-bold text-lg">Rs. {getOrderTotal(order).toLocaleString()}</p>
                          </div>
                          {order.net_amount !== undefined && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Net Amount</p>
                              <p className="font-medium">Rs. {order.net_amount.toLocaleString()}</p>
                            </div>
                          )}
                          {order.discount !== undefined && order.discount > 0 && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Discount</p>
                              <p className="font-medium text-green-600">-Rs. {order.discount.toLocaleString()}</p>
                            </div>
                          )}
                          {order.tax !== undefined && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Tax</p>
                              <p className="font-medium">Rs. {order.tax.toLocaleString()}</p>
                            </div>
                          )}
                          {order.payment_method && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Payment</p>
                              <p className="font-medium">{order.payment_method}</p>
                            </div>
                          )}
                          {order.customer_name && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Customer</p>
                              <p className="font-medium">{order.customer_name}</p>
                            </div>
                          )}
                          {order.items_count !== undefined && (
                            <div>
                              <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Items</p>
                              <p className="font-medium">{order.items_count} items</p>
                            </div>
                          )}
                          <div>
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Data Source</p>
                            <p className="font-medium capitalize">{order._source || 'unknown'}</p>
                          </div>
                        </div>
                        
                        {order.notes && (
                          <div className="mt-4 p-3 bg-white rounded border border-slate-200">
                            <p className="text-slate-500 text-xs uppercase tracking-wide mb-1">Notes</p>
                            <p className="text-sm">{order.notes}</p>
                          </div>
                        )}
                        
                        {/* Order Items Section */}
                        <div className="mt-4">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                            🍽️ Order Items
                            {loadingItems === orderId && <Loader2 className="h-3 w-3 animate-spin" />}
                          </h4>
                          {loadingItems === orderId ? (
                            <div className="text-center py-4 text-slate-400">
                              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                              <p className="text-xs mt-1">Loading items...</p>
                            </div>
                          ) : orderItems[orderId] && orderItems[orderId].length > 0 ? (
                            <div className="bg-white rounded border border-slate-200 overflow-hidden">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-100 text-slate-600">
                                  <tr>
                                    <th className="text-left p-2 font-medium">Item</th>
                                    <th className="text-center p-2 font-medium">Qty</th>
                                    <th className="text-right p-2 font-medium">Price</th>
                                    <th className="text-right p-2 font-medium">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {orderItems[orderId].map((item: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50">
                                      <td className="p-2">
                                        <p className="font-medium">{item.name || item.item_name || item.menu_item_name || `Item #${item.menu_item_id || item.id}`}</p>
                                        {item.notes && <p className="text-xs text-slate-500">{item.notes}</p>}
                                      </td>
                                      <td className="p-2 text-center">{item.quantity || 1}</td>
                                      <td className="p-2 text-right">Rs. {(item.unit_price || item.price || 0).toLocaleString()}</td>
                                      <td className="p-2 text-right font-medium">Rs. {((item.quantity || 1) * (item.unit_price || item.price || 0)).toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-center py-4 text-slate-400 bg-white rounded border border-slate-200">
                              <p className="text-xs">No items found or items not loaded yet</p>
                            </div>
                          )}
                        </div>
                        
                        {/* Raw JSON View Toggle */}
                        <details className="mt-4">
                          <summary className="text-xs text-slate-500 cursor-pointer hover:text-blue-600">View Raw JSON Data</summary>
                          <pre className="mt-2 p-3 bg-slate-900 text-green-400 rounded text-xs overflow-auto max-h-48">
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
        </CardContent>
      </Card>


    </div>
  );
}
