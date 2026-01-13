"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { format, parseISO } from 'date-fns';
import { Loader2, Archive, ArrowLeft, CheckCircle, Square, CheckSquare, AlertTriangle } from 'lucide-react';
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
}

export default function OrdersDayPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const day = params.day as string; // YYYY-MM-DD

  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [archiving, setArchiving] = useState(false);
  const [archivedOrderIds, setArchivedOrderIds] = useState<Set<number>>(new Set());
  const [appendMode, setAppendMode] = useState(false);
  
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
      fetchOrders();
      fetchArchivedOrders();
    }
  }, [restaurantId, day]);

  // Helper for parsing
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

  const fetchOrders = async () => {
    setLoading(true);
    try {
      if (!restaurantId) return;

      // 1. Try to fetch specifically for this date if API supports it
      // Assuming API supports start_date/end_date filtering which is much efficient
      // If not, we fall back to fetching recent 500 and filtering client side (legacy behavior)
      
      const start = `${day}T00:00:00`;
      const end = `${day}T23:59:59`;
      
      // Try date range query first
      let allOrders: any[] = [];
      try {
        const url = `/orders/?restaurant_id=${restaurantId}&start_date=${start}&end_date=${end}&limit=500`; 
        const res = await mainApi.get(url);
        allOrders = parseOrdersResponse(res.data);
      } catch (e) {
        // Fallback to fetch all recent if date filter fails (legacy API compatibility)
        console.warn("Date filter failed, falling back to recent orders", e);
        const url = `/orders/?restaurant_id=${restaurantId}&limit=500`;
        const res = await mainApi.get(url);
        allOrders = parseOrdersResponse(res.data);
      }

      // Deduplicate
      const uniqueOrders = Array.from(new Map(allOrders.map(o => [o.id || o.order_id, o])).values());

      // Client-side strict date filtering (Double check)
      // This handles timezone issues effectively by checking the YYYY-MM-DD string
      const dayOrders = uniqueOrders.filter((order: any) => {
        const orderDate = order.created_at || order.business_date;
        if (!orderDate) return false;
        
        // Robust date parsing
        try {
           // Try ISO split first
           if (orderDate.startsWith(day)) return true;
           
           // Fallback to Date object parsing
           const d = new Date(orderDate);
           if (isNaN(d.getTime())) return false;
           return format(d, 'yyyy-MM-dd') === day;
        } catch {
           return false;
        }
      });
      
      setOrders(dayOrders);
      
    } catch (err: any) {
      console.error("Failed to fetch orders:", err);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };


  const fetchArchivedOrders = async () => {
    try {
      // Check if there's an archive job for this day
      const start = `${day}T00:00:00Z`;
      const end = `${day}T23:59:59Z`;
      const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${day}&end_day=${day}`);
      const jobs = jobsRes.data?.jobs || [];
      
      // Get order IDs from any EXPORTED jobs for this day
      const archivedIds = new Set<number>();
      for (const job of jobs) {
        if (job.status === 'EXPORTED') {
          try {
            const manifestRes = await archiveApi.get(`/archive/${job.job_id}/manifest`);
            // If manifest has order IDs, add them
            if (manifestRes.data?.order_ids) {
              manifestRes.data.order_ids.forEach((id: number) => archivedIds.add(id));
            }
          } catch (e) {
            // Manifest might not be available (ephemeral storage)
          }
        }
      }
      setArchivedOrderIds(archivedIds);
    } catch (err) {
      console.error("Failed to check archived orders:", err);
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

    const action = appendMode ? 'Append' : 'Archive';
    if (!confirm(`${action} ${selectedIds.size} selected order(s)?`)) return;

    setArchiving(true);
    try {
      const payload: any = {
        restaurant_id: restaurantId,
        order_ids: Array.from(selectedIds)
      };
      if (appendMode) {
        payload.append = true;
      }

      const res = await archiveApi.post('/jobs/archive', payload);
      
      const msg = appendMode 
        ? `Orders appended to existing archive! Job ID: ${res.data.job_id}`
        : `Archive job created! Job ID: ${res.data.job_id}`;
      
      alert(msg);
      // Wait a bit before redirecting for append, or just refresh
      setTimeout(() => {
        router.push(`/archive/${res.data.job_id}`);
      }, 500);
    } catch (err: any) {
      console.error("Failed to create archive job:", err);
      
      // Better error handling for backend issues
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

    const action = appendMode ? 'Append' : 'Archive';
    if (!confirm(`${action} all ${orders.length} order(s) for ${day}?`)) return;

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
      
      const msg = appendMode 
        ? `Orders appended to existing archive! Job ID: ${res.data.job_id}`
        : `Archive job created! Job ID: ${res.data.job_id}`;
            
      alert(msg);
      setTimeout(() => {
        router.push(`/archive/${res.data.job_id}`);
      }, 500);
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
            variant="outline" 
            onClick={handleArchiveSelected}
            disabled={archiving || selectedIds.size === 0}
          >
            {archiving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
            {appendMode ? 'Append Selected' : 'Archive Selected'} ({selectedIds.size})
          </Button>
          <Button 
            onClick={handleArchiveAll}
            disabled={archiving || orders.length === 0}
          >
            {archiving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
            {appendMode ? 'Append All Day' : 'Archive All Day'}
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
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-blue-600">{selectedIds.size}</p>
            <p className="text-sm text-slate-500">Selected</p>
          </CardContent>
        </Card>
      </div>

      {/* Orders List */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Order List</CardTitle>
            <Button variant="ghost" size="sm" onClick={selectAll}>
              {selectedIds.size === orders.length && orders.length > 0 ? (
                <><CheckSquare className="h-4 w-4 mr-2" /> Deselect All</>
              ) : (
                <><Square className="h-4 w-4 mr-2" /> Select All</>
              )}
            </Button>
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
                  <div 
                    key={orderId}
                    className={cn(
                      "flex items-center gap-4 p-4 cursor-pointer hover:bg-slate-50 transition-colors",
                      isSelected && "bg-blue-50",
                      isArchived && "opacity-60"
                    )}
                    onClick={() => toggleSelect(orderId)}
                  >
                    {/* Checkbox */}
                    <div className={cn(
                      "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                      isSelected ? "bg-blue-600 border-blue-600" : "border-slate-300"
                    )}>
                      {isSelected && <CheckCircle className="h-4 w-4 text-white" />}
                    </div>

                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">#{orderId}</span>
                        {isArchived && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                            Archived
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-500">
                        {formatTime(order.created_at)} • {order.status} • {order.channel || 'dine-in'}
                      </p>
                    </div>

                    {/* Amount */}
                    <div className="text-right">
                      <p className="font-semibold text-slate-900">
                        Rs. {getOrderTotal(order).toLocaleString()}
                      </p>
                    </div>
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
