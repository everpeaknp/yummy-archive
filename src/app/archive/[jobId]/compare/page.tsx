"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  ArrowLeft, Trash2, CheckCircle, Shield, AlertTriangle, Loader2, 
  Server, ChevronDown, ChevronUp, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface CompareOrder {
  id: number;
  created_at: string | null;
  grand_total: number;
  status: string;
  _archive_status: 'safe_to_delete' | 'already_deleted';
  _can_delete: boolean;
  _missing_from_parquet?: boolean;
}

interface CompareSummary {
  live_orders: number;
  archived_orders: number;
  safe_to_delete: number;
  already_deleted: number;
  live_total: number;
  archived_total: number;
}

interface CompareResponse {
  job_id: string;
  archive_day: string;
  summary: CompareSummary;
  order_ids: {
    live: number[];
    archived: number[];
    safe_to_delete: number[];
    already_deleted: number[];
  };
  orders: CompareOrder[];
}

export default function CompareAndDeletePage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [archiveDay, setArchiveDay] = useState<string>('');
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [orders, setOrders] = useState<CompareOrder[]>([]);
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);

  useEffect(() => {
    if (jobId) fetchComparisonData();
  }, [jobId]);

  const fetchComparisonData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const jobRes = await archiveApi.get(`/jobs/archive/${jobId}`);
      const job = jobRes.data;
      setRestaurantId(job.restaurant_id);
      setArchiveDay(job.archive_day);
      
      const res = await archiveApi.get<CompareResponse>(`/archive/${jobId}/compare`, {
        headers: { 'X-Restaurant-ID': String(job.restaurant_id) }
      });
      const data = res.data;
      
      if (data.archive_day) setArchiveDay(data.archive_day);
      setSummary(data.summary);
      const sortedOrders = (data.orders || []).sort((a, b) => b.id - a.id);
      setOrders(sortedOrders);
      
      // Don't auto-select - let user choose what to delete
      setSelectedIds(new Set());
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to load comparison data');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    const order = orders.find(o => o.id === id);
    if (!order?._can_delete) return;
    
    const updated = new Set(selectedIds);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedIds(updated);
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    
    const idsToDelete = Array.from(selectedIds).filter(id => 
      orders.find(o => o.id === id)?._can_delete
    );
    
    if (idsToDelete.length === 0) return;
    
    if (!confirm(`Delete ${idsToDelete.length} order(s) from the live database?\n\nThis action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await archiveApi.post('/jobs/delete', {
        archive_job_id: jobId,
        restaurant_id: restaurantId,
        order_ids: idsToDelete
      });
      
      alert(`Successfully deleted ${idsToDelete.length} order(s).`);
      fetchComparisonData();
    } catch (err: any) {
      alert(`Delete failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '--:--';
    try { return format(new Date(dateStr), 'HH:mm'); } 
    catch { return '--:--'; }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
        <p className="text-slate-500">Loading comparison...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Failed to Load</h2>
        <p className="text-slate-500 max-w-md mb-8">{error}</p>
        <Button onClick={() => router.push(`/archive/${jobId}`)} className="bg-blue-600 hover:bg-blue-700">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Archive
        </Button>
      </div>
    );
  }

  const safeCount = orders.filter(o => o._can_delete).length;
  const deletedCount = orders.filter(o => !o._can_delete).length;

  return (
    <div className="space-y-4 pb-28 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => router.push(`/archive/${jobId}`)} 
          className="h-10 w-10 rounded-full p-0 shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Compare & Delete</h1>
          <p className="text-sm text-slate-500">
            {archiveDay && format(new Date(archiveDay), 'EEEE, MMM d, yyyy')}
          </p>
        </div>
      </div>

      {/* Hero Stats Card */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-5 text-white">
          <div className="flex items-center gap-3 mb-4">
            <Server className="h-6 w-6" />
            <div>
              <p className="font-bold">Live Database Comparison</p>
              <p className="text-sm text-blue-200">See what's safe to delete</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-2xl md:text-3xl font-bold text-emerald-300">{safeCount}</p>
              <p className="text-xs text-blue-200">Safe to Delete</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-2xl md:text-3xl font-bold text-slate-300">{deletedCount}</p>
              <p className="text-xs text-blue-200">Already Deleted</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Selection Controls */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setSelectedIds(new Set(orders.filter(o => o._can_delete).map(o => o.id)))}
            className="text-sm text-blue-600 font-medium hover:underline"
          >
            Select all safe
          </button>
          <span className="text-slate-300">•</span>
          <button 
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-slate-500 hover:underline"
          >
            Clear
          </button>
        </div>
        <span className="text-sm text-slate-500">
          {selectedIds.size} selected
        </span>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {orders.length === 0 ? (
          <Card className="p-8 text-center">
            <AlertTriangle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No orders found for comparison</p>
          </Card>
        ) : (
          orders.map(order => {
            const isSelected = selectedIds.has(order.id) && order._can_delete;
            const isExpanded = expandedOrderId === order.id;
            const isSafe = order._can_delete;
            const isDeleted = !order._can_delete && !order._missing_from_parquet;
            const isLost = order._missing_from_parquet;

            return (
              <Card 
                key={order.id} 
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  isSelected && "ring-2 ring-blue-500",
                  !isSafe && "opacity-60"
                )}
              >
                <CardContent className="p-0">
                  {/* Order Row */}
                  <div className="flex items-center gap-2 md:gap-3 p-3 md:p-4">
                    {/* Checkbox */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSelect(order.id); }}
                      disabled={!isSafe}
                      style={{ width: '16px', height: '16px', minWidth: '16px', minHeight: '16px' }}
                      className={cn(
                        "rounded-sm border flex items-center justify-center shrink-0 transition-all",
                        isSafe && isSelected && "bg-blue-600 border-blue-600",
                        isSafe && !isSelected && "border-slate-400 bg-white hover:border-blue-500",
                        !isSafe && "border-slate-200 bg-slate-100 cursor-not-allowed"
                      )}
                    >
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>

                    {/* Order Badge */}
                    <div className={cn(
                      "h-11 w-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-white text-sm",
                      isSafe && "bg-gradient-to-br from-emerald-400 to-emerald-600",
                      isDeleted && "bg-gradient-to-br from-slate-400 to-slate-500",
                      isLost && "bg-gradient-to-br from-amber-400 to-amber-600"
                    )}>
                      #{order.id % 1000}
                    </div>

                    {/* Order Info */}
                    <div 
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">Order #{order.id}</span>
                        {isSafe && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 rounded-full">
                            Safe ✓
                          </span>
                        )}
                        {isDeleted && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-slate-200 text-slate-600 rounded-full">
                            Deleted
                          </span>
                        )}
                        {isLost && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700 rounded-full">
                            Data Lost
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
                    <div 
                      className="text-right shrink-0 cursor-pointer"
                      onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    >
                      <p className="font-bold text-slate-900">
                        {isLost ? '—' : `Rs.${(order.grand_total || 0).toLocaleString()}`}
                      </p>
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
                          <p className="font-medium">{order.id}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Time</p>
                          <p className="font-medium">{formatTime(order.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Status</p>
                          <p className="font-medium capitalize">{order.status}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Total</p>
                          <p className="font-bold text-lg">
                            {isLost ? '—' : `Rs.${(order.grand_total || 0).toLocaleString()}`}
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-slate-500 text-xs uppercase mb-1">Archive Status</p>
                          <p className={cn(
                            "font-medium",
                            isSafe && "text-emerald-600",
                            isDeleted && "text-slate-500",
                            isLost && "text-amber-600"
                          )}>
                            {isSafe && "✓ Backed up & safe to delete from live DB"}
                            {isDeleted && "Already deleted from live DB"}
                            {isLost && "⚠ Archive data unavailable"}
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

      {/* Info Banner */}
      {safeCount > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-emerald-800">Safe to delete</p>
              <p className="text-sm text-emerald-600">
                These orders are permanently saved in the archive. Deleting them from the live database will free up space.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sticky Delete Button */}
      {safeCount > 0 && (
        <div className="fixed bottom-20 md:bottom-6 left-0 right-0 px-4 z-40">
          <div className="max-w-xl mx-auto">
            <Button 
              onClick={handleDelete}
              disabled={deleting || selectedIds.size === 0}
              className="w-full h-14 text-base font-semibold rounded-2xl shadow-lg bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="h-5 w-5 mr-2" />
                  Delete {selectedIds.size} Orders from Live DB
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
