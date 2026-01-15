"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { ArchiveJob } from '@/types';
import { format } from 'date-fns';
import { 
  ArrowLeft, Trash2, CheckCircle, XCircle, Clock, Loader2, 
  Database, FileText, AlertCircle, ShoppingBag, Calendar,
  ChevronDown, ChevronUp, RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ManifestData {
  row_counts?: Record<string, number>;
  restaurant_timezone?: string;
  total_checksum?: string;
  updated_at?: string;
  criteria?: {
    order_ids?: number[];
    delete_order_ids?: number[] | null;
    start_date?: string;
    end_date?: string;
  };
}

interface OrderData {
  id: number;
  order_id?: number;
  created_at: string;
  status: string;
  channel?: string;
  grand_total?: number;
  total?: number;
  net_amount?: number;
}

export default function ArchiveDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<ArchiveJob | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [missingFile, setMissingFile] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    if (jobId && jobId !== 'undefined') {
      fetchJobDetails();
    }
  }, [jobId]);

  useEffect(() => {
    if (['EXPORTED', 'SYNCED'].includes(job?.status || '')) {
      fetchOrders();
    }
  }, [job, page]);

  // Poll for status updates if processing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    const activeStatuses = ['PENDING', 'APPENDING', 'IN_PROGRESS', 'EXPORTING'];
    if (activeStatuses.includes(job?.status || '')) {
      interval = setInterval(() => fetchJobDetails(true), 3000);
    }
    return () => clearInterval(interval);
  }, [job?.status]);

  const fetchJobDetails = async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      const jobRes = await archiveApi.get(`/jobs/archive/${jobId}`);
      setJob(jobRes.data);

      if (['EXPORTED', 'SYNCED'].includes(jobRes.data.status)) {
        try {
          const manifestRes = await archiveApi.get(`/archive/${jobId}/manifest`);
          setManifest(manifestRes.data);
        } catch {}
      }
    } catch (err: any) {
      if (err.response?.status === 404) setNotFound(true);
      else if (err.response?.status === 410 || err.response?.status === 500) setMissingFile(true);
    } finally {
      if (!isPolling) setLoading(false);
    }
  };

  const fetchOrders = async () => {
    setOrdersLoading(true);
    try {
      const offset = page * LIMIT;
      const res = await archiveApi.get(`/archive/${jobId}/query/orders?limit=${LIMIT}&offset=${offset}&sort_desc=true`);
      setOrders(res.data.data || []);
    } catch (err: any) {
      if (err.response?.status === 410 || err.response?.status === 500) {
        setMissingFile(true);
      }
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleDeleteJob = async () => {
    if (!confirm("Delete this archive job?\n\nThis will NOT delete any orders from the main database.\nIt just removes this job record so you can re-archive.")) return;
    setDeleting(true);
    try {
      await archiveApi.delete(`/jobs/archive/${jobId}`);
      alert("Archive job deleted. You can now re-archive this day.");
      router.push('/');
    } catch {
      alert("Failed to delete job. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  const getOrderTotal = (order: OrderData) => order.grand_total || order.total || order.net_amount || 0;

  const formatTime = (dateStr: string) => {
    try { return format(new Date(dateStr), 'HH:mm'); } 
    catch { return '--:--'; }
  };

  const formatDate = (dateStr: string) => {
    try { return format(new Date(dateStr), 'MMM d, yyyy'); } 
    catch { return dateStr; }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
        <p className="text-slate-500">Loading archive...</p>
      </div>
    );
  }

  if (!job || notFound) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mb-6">
          <XCircle className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900 mb-3">Archive Not Found</h2>
        <p className="text-slate-500 max-w-md mb-8">
          This archive doesn't exist or has been deleted. It may have expired on the server.
        </p>
        <Button onClick={() => router.push('/')} className="bg-blue-600 hover:bg-blue-700">
          Go to Dashboard
        </Button>
      </div>
    );
  }

  const isComplete = ['EXPORTED', 'SYNCED'].includes(job.status);
  const isProcessing = ['PENDING', 'APPENDING', 'IN_PROGRESS', 'EXPORTING'].includes(job.status);
  const isFailed = job.status === 'FAILED';
  const ordersCount = manifest?.row_counts?.orders || orders.length;
  const totalRevenue = orders.reduce((sum, o) => sum + getOrderTotal(o), 0);

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
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">
            {job.archive_day ? formatDate(job.archive_day) : 'Archive Details'}
          </h1>
          <p className="text-sm text-slate-500">Archive #{jobId.slice(0, 8)}</p>
        </div>
        {isComplete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fetchJobDetails()}
            className="h-10 w-10 rounded-full p-0"
          >
            <RefreshCw className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Status Hero Card */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className={cn(
          "p-5 text-white",
          isComplete && "bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700",
          isProcessing && "bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700",
          isFailed && "bg-gradient-to-br from-red-500 via-red-600 to-rose-700",
          missingFile && "bg-gradient-to-br from-amber-500 via-amber-600 to-orange-700"
        )}>
          {/* Status */}
          <div className="flex items-center gap-4 mb-4">
            <div className="h-14 w-14 rounded-2xl bg-white/20 flex items-center justify-center">
              {isComplete && <CheckCircle className="h-7 w-7" />}
              {isProcessing && <Loader2 className="h-7 w-7 animate-spin" />}
              {isFailed && <XCircle className="h-7 w-7" />}
              {missingFile && <AlertCircle className="h-7 w-7" />}
            </div>
            <div>
              <p className="text-lg font-bold">
                {isComplete && "Archive Complete"}
                {isProcessing && "Archiving..."}
                {isFailed && "Archive Failed"}
                {missingFile && !isFailed && "Files Missing"}
              </p>
              <p className="text-sm opacity-80">
                {isComplete && "All orders safely backed up"}
                {isProcessing && "Please wait, this may take a moment"}
                {isFailed && "Something went wrong"}
                {missingFile && !isFailed && "Files expired or unavailable"}
              </p>
            </div>
          </div>

          {/* Basic Info - Always visible */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white/10 rounded-xl p-2 md:p-3">
              <p className="text-sm md:text-base font-bold truncate">{job.status}</p>
              <p className="text-[10px] md:text-xs opacity-80">Status</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2 md:p-3">
              <p className="text-sm md:text-base font-bold">{job.restaurant_id}</p>
              <p className="text-[10px] md:text-xs opacity-80">Restaurant</p>
            </div>
            <div className="bg-white/10 rounded-xl p-2 md:p-3">
              <p className="text-sm md:text-base font-bold">{new Date(job.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</p>
              <p className="text-[10px] md:text-xs opacity-80">Created</p>
            </div>
          </div>

          {/* Stats - Only when complete */}
          {isComplete && !missingFile && (
            <div className="grid grid-cols-2 gap-2 text-center mt-3 pt-3 border-t border-white/20">
              <div className="bg-white/10 rounded-xl p-2 md:p-3">
                <p className="text-xl md:text-2xl font-bold">{ordersCount}</p>
                <p className="text-[10px] md:text-xs opacity-80">Orders</p>
              </div>
              <div className="bg-white/10 rounded-xl p-2 md:p-3">
                <p className="text-lg md:text-2xl font-bold truncate">Rs.{totalRevenue >= 1000 ? `${(totalRevenue/1000).toFixed(0)}k` : totalRevenue}</p>
                <p className="text-[10px] md:text-xs opacity-80">Revenue</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Action Buttons */}
      {isComplete && !missingFile && (
        <div className="flex gap-3">
          <Button 
            onClick={() => router.push(`/archive/${jobId}/compare`)}
            className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl"
          >
            <Database className="h-5 w-5 mr-2" />
            Compare with Live DB
          </Button>
        </div>
      )}

      {/* Error States */}
      {(missingFile || isFailed) && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">
                  {isFailed ? "Archive Failed" : "Archive Files Unavailable"}
                </p>
                <p className="text-sm text-red-600 mt-1">
                  {isFailed 
                    ? "This archive job failed to complete. Delete and try again."
                    : "The archive files are missing from the server. This happens after server restarts on free hosting."}
                </p>
                <Button 
                  onClick={handleDeleteJob}
                  disabled={deleting}
                  className="mt-3 bg-red-600 hover:bg-red-700 text-white"
                  size="sm"
                >
                  {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete & Re-archive
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Orders List (Simplified Data Viewer) */}
      {isComplete && !missingFile && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-lg font-semibold text-slate-900">Archived Orders</h2>
            <span className="text-sm text-slate-500">{ordersCount} total</span>
          </div>

          {ordersLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-3" />
              <p className="text-slate-500">Loading orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <Card className="p-8 text-center">
              <ShoppingBag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">No orders in this archive</p>
            </Card>
          ) : (
            <>
              {orders.map(order => {
                const orderId = order.id || order.order_id!;
                const isExpanded = expandedOrderId === orderId;

                return (
                  <Card 
                    key={orderId} 
                    className="overflow-hidden transition-all duration-200 hover:shadow-md"
                  >
                    <CardContent className="p-0">
                      {/* Order Row */}
                      <div 
                        className="flex items-center gap-3 p-4 cursor-pointer"
                        onClick={() => setExpandedOrderId(isExpanded ? null : orderId)}
                      >
                        {/* Order Badge */}
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shrink-0 font-bold text-white">
                          #{orderId % 1000}
                        </div>

                        {/* Order Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">Order #{orderId}</span>
                            <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700 rounded-full">
                              ✓ Archived
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
                            <Clock className="h-3 w-3" />
                            <span>{formatTime(order.created_at)}</span>
                            <span>•</span>
                            <span className="capitalize">{order.status}</span>
                            {order.channel && (
                              <>
                                <span>•</span>
                                <span className="capitalize">{order.channel}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Amount */}
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
                              <p className="font-medium">{formatTime(order.created_at)}</p>
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
                              <p className="font-bold text-lg text-emerald-600">Rs. {getOrderTotal(order).toLocaleString()}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Pagination */}
              {orders.length >= LIMIT && (
                <div className="flex items-center justify-between pt-4">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => Math.max(0, p - 1))} 
                    disabled={page === 0}
                    className="rounded-full"
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-slate-500">Page {page + 1}</span>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setPage(p => p + 1)} 
                    disabled={orders.length < LIMIT}
                    className="rounded-full"
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Processing State - removed duplicate spinner, it's already in hero */}


    </div>
  );
}
