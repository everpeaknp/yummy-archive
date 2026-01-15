"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArrowLeft, Trash2, CheckCircle, Shield, AlertTriangle, Loader2, Database, Server } from 'lucide-react';
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
  
  // Data from new /compare endpoint
  const [archiveDay, setArchiveDay] = useState<string>('');
  const [summary, setSummary] = useState<CompareSummary | null>(null);
  const [orders, setOrders] = useState<CompareOrder[]>([]);
  const [restaurantId, setRestaurantId] = useState<number | null>(null);
  
  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (jobId) {
      fetchComparisonData();
    }
  }, [jobId]);

  const fetchComparisonData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // 1. Get job details first (needed for restaurant_id header)
      const jobRes = await archiveApi.get(`/jobs/archive/${jobId}`);
      const job = jobRes.data;
      setRestaurantId(job.restaurant_id);
      setArchiveDay(job.archive_day);
      
      // 2. Call /compare with required headers
      const res = await archiveApi.get<CompareResponse>(`/archive/${jobId}/compare`, {
        headers: {
          'X-Restaurant-ID': String(job.restaurant_id)
        }
      });
      const data = res.data;
      
      console.log('[Compare] API Response:', data);
      
      // Update state from response (may override archiveDay with more accurate value)
      if (data.archive_day) setArchiveDay(data.archive_day);
      setSummary(data.summary);
      setOrders(data.orders || []);
      
      // Auto-select all deletable orders
      const deletableIds = (data.orders || [])
        .filter((o: CompareOrder) => o._can_delete)
        .map((o: CompareOrder) => o.id);
      setSelectedIds(new Set(deletableIds));

    } catch (err: any) {
      console.error('[Compare] Failed to fetch:', err);
      setError(err.response?.data?.detail || err.message || 'Failed to load comparison data');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: number) => {
    const order = orders.find(o => o.id === id);
    if (!order?._can_delete) return; // Can't select already deleted
    
    const updated = new Set(selectedIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedIds(updated);
  };

  const selectAllSafe = () => {
    const safeIds = orders.filter(o => o._can_delete).map(o => o.id);
    setSelectedIds(new Set(safeIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleDelete = async () => {
    if (selectedIds.size === 0) return;
    
    // Filter to only include deletable orders (safety check)
    const idsToDelete = Array.from(selectedIds).filter(id => 
      orders.find(o => o.id === id)?._can_delete
    );
    
    if (idsToDelete.length === 0) return;
    
    if (!confirm(`Delete ${idsToDelete.length} order(s) from the live database? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      await archiveApi.post('/jobs/delete', {
        archive_job_id: jobId,
        restaurant_id: restaurantId,
        order_ids: idsToDelete
      });
      
      alert(`Successfully deleted ${idsToDelete.length} order(s) from the live database.`);
      // Refresh data to show updated status
      fetchComparisonData();
    } catch (err: any) {
      console.error('Delete failed:', err);
      alert(`Delete failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-8 max-w-2xl">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-red-700 mb-2">Failed to Load Comparison</h2>
            <p className="text-red-600 text-sm mb-4">{error}</p>
            <Button variant="outline" onClick={() => router.push(`/archive/${jobId}`)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Archive
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-8 max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => router.push(`/archive/${jobId}`)} 
            className="mb-2 -ml-2 text-slate-500 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Archive
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Compare & Delete</h1>
          <p className="text-slate-500">
            {archiveDay && format(new Date(archiveDay), 'MMMM d, yyyy')}
          </p>
        </div>

        <Button 
          onClick={handleDelete}
          disabled={deleting || selectedIds.size === 0}
          variant="destructive"
          className="flex-shrink-0"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Delete {selectedIds.size} Selected
        </Button>
      </div>

      {/* Stats Cards - Using summary from API */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="p-4 text-center">
              <Server className="h-6 w-6 text-green-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-green-700">{summary.live_orders}</p>
              <p className="text-sm text-green-600">Live Orders</p>
              <p className="text-xs text-green-500 mt-1">Rs. {summary.live_total.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4 text-center">
              <Database className="h-6 w-6 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-blue-700">{summary.archived_orders}</p>
              <p className="text-sm text-blue-600">Archived Orders</p>
              <p className="text-xs text-blue-500 mt-1">Rs. {summary.archived_total.toLocaleString()}</p>
            </CardContent>
          </Card>

          <Card className="border-emerald-200 bg-emerald-50">
            <CardContent className="p-4 text-center">
              <Shield className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-emerald-700">{summary.safe_to_delete}</p>
              <p className="text-sm text-emerald-600">Safe to Delete</p>
              <p className="text-xs text-emerald-500 mt-1">Backed up in archive</p>
            </CardContent>
          </Card>

          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-4 text-center">
              <CheckCircle className="h-6 w-6 text-amber-600 mx-auto mb-2" />
              <p className="text-2xl font-bold text-amber-700">{summary.already_deleted}</p>
              <p className="text-sm text-amber-600">Already Deleted</p>
              <p className="text-xs text-amber-500 mt-1">Not in live DB anymore</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Selection Controls */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={selectAllSafe}>
          Select All Safe
        </Button>
        <Button variant="ghost" size="sm" onClick={deselectAll}>
          Deselect All
        </Button>
        <span className="text-sm text-slate-500 ml-auto">
          {selectedIds.size} of {orders.filter(o => o._can_delete).length} selected
        </span>
      </div>

      {/* Orders Table */}
      <Card>
        <CardHeader className="border-b bg-slate-50">
          <CardTitle className="text-lg">Order Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="p-3 text-left w-10"></th>
                  <th className="p-3 text-left">Order ID</th>
                  <th className="p-3 text-left">Date/Time</th>
                  <th className="p-3 text-left">Status</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-center">Archive Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((order) => (
                  <tr 
                    key={order.id} 
                    className={cn(
                      "transition-colors",
                      !order._can_delete && "opacity-50 bg-slate-50",
                      order._missing_from_parquet && "bg-amber-50/50",
                      order._can_delete && "hover:bg-slate-50",
                      selectedIds.has(order.id) && order._can_delete && "bg-blue-50"
                    )}
                  >
                    <td className="p-3">
                      <div 
                        className={cn(
                          "h-5 w-5 rounded border-2 flex items-center justify-center transition-colors",
                          !order._can_delete && "opacity-50 cursor-not-allowed border-slate-200 bg-slate-100",
                          order._can_delete && "cursor-pointer",
                          selectedIds.has(order.id) && order._can_delete 
                            ? "bg-blue-600 border-blue-600" 
                            : order._can_delete ? "border-slate-300 hover:border-blue-400" : ""
                        )}
                        onClick={() => order._can_delete && toggleSelect(order.id)}
                      >
                        {selectedIds.has(order.id) && order._can_delete && (
                          <CheckCircle className="h-4 w-4 text-white" />
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-medium">#{order.id}</td>
                    <td className="p-3 text-slate-600">
                      {order._missing_from_parquet ? (
                        <span className="text-amber-600 italic">Data unavailable</span>
                      ) : order.created_at ? (
                        format(new Date(order.created_at), 'MMM d, HH:mm')
                      ) : '-'}
                    </td>
                    <td className="p-3">
                      {order._missing_from_parquet ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                          archived
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700">
                          {order.status}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right font-medium">
                      {order._missing_from_parquet ? (
                        <span className="text-amber-600">—</span>
                      ) : (
                        `Rs. ${(order.grand_total || 0).toLocaleString()}`
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {order._can_delete ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-700">
                          <Shield className="h-3 w-3" />
                          Safe to Delete
                        </span>
                      ) : order._missing_from_parquet ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          Data Lost
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-slate-200 text-slate-500">
                          <CheckCircle className="h-3 w-3" />
                          Already Deleted
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {orders.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              No orders found for comparison
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
        <p className="font-medium mb-1">💡 About Archive Permanence</p>
        <p className="text-blue-600">
          Archived orders are <strong>permanently preserved</strong> in S3. Even after deleting from the main database, 
          order details (items, modifiers, payments) remain queryable from the archive files forever.
        </p>
      </div>
    </div>
  );
}
