"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday, isSameDay } from 'date-fns';
import { 
  Loader2, Archive, Eye, ChevronLeft, ChevronRight, RefreshCw, 
  CheckCircle, XCircle, Clock, FilePlus, Calendar, TrendingUp,
  Database, AlertCircle, Plus, Sparkles
} from 'lucide-react';
import { ArchiveJob } from '@/types';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { restaurantId, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [allRecentOrders, setAllRecentOrders] = useState<any[]>([]); // Store raw orders for flexible filtering
  const [archivedJobIds, setArchivedJobIds] = useState<Map<string, Set<number>>>(new Map()); // JobID -> Set<IDs>
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creatingJobForDate, setCreatingJobForDate] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  const parseOrdersResponse = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw?.orders) return raw.orders;
    if (raw?.data?.orders) return raw.data.orders;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    return [];
  };

  const fetchJobs = async () => {
    if (!restaurantId) return;
    setLoading(true);
    const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    try {
      const resJobs = await archiveApi.get(`/archive/jobs?start_day=${start}&end_day=${end}`);
      setJobs(resJobs.data.jobs || []);
    } catch (err: any) {
      console.error("Failed to fetch jobs", err);
    }

    try {
      const resSales = await mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`);
      const salesData = resSales.data?.data || resSales.data;
      let mappedStats: any[] = [];
      
      if (salesData?.periods && Array.isArray(salesData.periods)) {
        mappedStats = salesData.periods.map((item: any) => ({
          date: item.period || item.date,
          order_count: item.orders || item.order_count || 0,
          total_amount: item.sales || item.total_amount || 0
        }));
      }
      
      if (salesData?.total_orders !== undefined) {
        setTotalOrders(salesData.total_orders || 0);
        setTotalSales(salesData.total_sales || salesData.total_amount || 0);
      }
      
      setDailyStats(mappedStats);
    } catch (err: any) {
      console.warn("Sales endpoint failed", err);
    } finally {
      setLoading(false);
    }

    // Fetch live orders IDs for accurate "New" count
    try {
      const resOrders = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=1000`);
      const orders = parseOrdersResponse(resOrders.data);
      setAllRecentOrders(orders);
    } catch (e) {
      console.warn("Failed to fetch orders list", e);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [restaurantId, currentMonth]);

  // Hydrate jobs with manifest data
  useEffect(() => {
    const fetchJobDetails = async () => {
      const jobsNeedingData = jobs.filter(j => 
        ['EXPORTED', 'SYNCED'].includes(j.status) && 
        ((j.row_counts?.orders === undefined) || !archivedJobIds.has(j.job_id))
      );

      if (jobsNeedingData.length === 0) return;

      const updates = new Map<string, { orders?: number }>();
      const idsUpdate = new Map<string, Set<number>>();
      
      await Promise.all(jobsNeedingData.map(async (job) => {
        const update: { orders?: number } = {};
        
        try {
          const compareRes = await archiveApi.get(`/archive/${job.job_id}/compare`, {
            headers: { 'X-Restaurant-ID': String(job.restaurant_id) }
          });
          
          if (compareRes.data?.summary) {
            update.orders = compareRes.data.summary.archived_orders;
          }
          
          if (Array.isArray(compareRes.data?.order_ids?.safe_to_delete)) {
            // Include both safe_to_delete and already_deleted as "known archived"
            const safe = compareRes.data.order_ids.safe_to_delete || [];
            const deleted = compareRes.data.order_ids.already_deleted || [];
            const allArchived = new Set([...safe, ...deleted]);
            idsUpdate.set(job.job_id, allArchived);
          }
        } catch (e) {
          console.warn(`Failed to fetch comparison for ${job.job_id}`, e);
          // Fallback to manifest if compare fails
          try {
            const manifestRes = await archiveApi.get(`/archive/${job.job_id}/manifest`);
            update.orders = manifestRes.data?.row_counts?.orders || 0;
            if (Array.isArray(manifestRes.data?.order_ids)) {
              idsUpdate.set(job.job_id, new Set(manifestRes.data.order_ids));
            }
          } catch (err) {
            console.warn(`Fallback manifest fetch failed for ${job.job_id}`, err);
          }
        }
        
        if (update.orders !== undefined) {
          updates.set(job.job_id, update);
        }
      }));

      // Update IDs Map
      if (idsUpdate.size > 0) {
        setArchivedJobIds(prev => {
          const next = new Map(prev);
          idsUpdate.forEach((ids, jobId) => next.set(jobId, ids));
          return next;
        });
      }

      // Update Jobs State
      if (updates.size > 0) {
        setJobs(prev => prev.map(j => {
          const update = updates.get(j.job_id);
          if (update) {
            return { 
              ...j, 
              row_counts: { ...j.row_counts, orders: update.orders ?? j.row_counts?.orders }
            } as any;
          }
          return j;
        }));
      }
    };

    fetchJobDetails();
  }, [jobs.length]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  }).reverse(); 

  const getJobForDate = (dateStr: string) => {
    const candidates = jobs.filter(j => j.archive_day === dateStr);
    if (candidates.length === 0) return undefined;
    
    const completeStatuses = ['EXPORTED', 'SYNCED'];
    candidates.sort((a: any, b: any) => {
      const aComplete = completeStatuses.includes(a.status);
      const bComplete = completeStatuses.includes(b.status);
      if (aComplete && !bComplete) return -1;
      if (!aComplete && bComplete) return 1;
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });
    
    return candidates[0];
  };

  const getJobStatus = (job: ArchiveJob) => {
    const configs: Record<string, { color: string; bgColor: string; icon: any; label: string }> = {
      EXPORTED: { color: 'text-emerald-600', bgColor: 'bg-emerald-50', icon: CheckCircle, label: 'Archived' },
      SYNCED: { color: 'text-emerald-600', bgColor: 'bg-emerald-50', icon: CheckCircle, label: 'Synced' },
      FAILED: { color: 'text-red-600', bgColor: 'bg-red-50', icon: XCircle, label: 'Failed' },
      PENDING: { color: 'text-amber-600', bgColor: 'bg-amber-50', icon: Clock, label: 'Pending' },
      APPENDING: { color: 'text-blue-600', bgColor: 'bg-blue-50', icon: Loader2, label: 'Appending' },
      IN_PROGRESS: { color: 'text-blue-600', bgColor: 'bg-blue-50', icon: Loader2, label: 'Processing' },
      EXPORTING: { color: 'text-blue-600', bgColor: 'bg-blue-50', icon: Loader2, label: 'Exporting' }
    };
    return configs[job.status] || configs.PENDING;
  };

  if (!isAuthenticated) return null;

  // Calculate summary stats
  const archivedDaysCount = jobs.filter(j => ['EXPORTED', 'SYNCED'].includes(j.status)).length;
  const totalArchivedOrders = jobs.reduce((sum, j) => {
    const anyJob = j as any;
    return sum + (anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0);
  }, 0);

  return (
    <div className="space-y-4 md:space-y-6 pb-20 md:pb-0">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-5 md:p-8 text-white">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-blue-200 text-sm font-medium mb-1">Welcome back</p>
              <h1 className="text-2xl md:text-3xl font-bold">Archive Dashboard</h1>
            </div>
            <Button 
              onClick={fetchJobs} 
              disabled={loading}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 border-0 text-white p-0"
            >
              <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
            </Button>
          </div>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl md:text-3xl font-bold">{totalOrders}</p>
              <p className="text-xs md:text-sm text-blue-200">Orders</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl md:text-3xl font-bold">{totalArchivedOrders}</p>
              <p className="text-xs md:text-sm text-blue-200">Archived</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              <p className="text-2xl md:text-3xl font-bold">Rs.{(totalSales/1000).toFixed(0)}k</p>
              <p className="text-xs md:text-sm text-blue-200">Revenue</p>
            </div>
          </div>
        </div>
      </div>

      {/* Month Navigator */}
      <div className="sticky top-16 z-40 -mx-4 px-4 py-3 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:border-0">
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigateMonth('prev')} 
            className="h-10 w-10 rounded-full p-0"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-600" />
            <span className="font-semibold text-lg text-slate-900">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
          </div>
          
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigateMonth('next')} 
            className="h-10 w-10 rounded-full p-0"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Days List */}
      <div className="space-y-3">
        {loading && days.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-3" />
            <p className="text-slate-500">Loading archives...</p>
          </div>
        ) : (
          days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const stat = dailyStats.find(s => s.date === dateStr);
            const job = getJobForDate(dateStr);
            const isFuture = day > new Date();
            const today = isToday(day);
            
            // Filter live orders for this day using exact logic from OrdersDayPage
            const dayLiveOrders = allRecentOrders.filter((o: any) => {
              const timestamp = o.created_at || o.business_date;
              if (!timestamp) return false;
              // Strict UTC prefix check OR Local date check
              return timestamp.startsWith(dateStr) || new Date(timestamp).toLocaleDateString('en-CA') === dateStr;
            });

            const archivedIds = job ? archivedJobIds.get(job.job_id) : undefined;
            const totalCount = Math.max(stat?.order_count || 0, dayLiveOrders.length);
            const anyJob = job as any;
            const archivedCount = job ? (anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0) : 0;
            
            // New Orders: Filter day's live orders against known archived IDs
            const newOrdersCount = archivedIds 
              ? dayLiveOrders.filter(o => !archivedIds.has(o.id || o.order_id)).length
              : (job && ['EXPORTED', 'SYNCED'].includes(job.status)) 
                  ? Math.max(0, totalCount - archivedCount)
                  : 0;
            
            const canAppend = job && ['EXPORTED', 'SYNCED'].includes(job.status) && newOrdersCount > 0;
            const hasOrders = totalCount > 0 || archivedCount > 0;

            if (isFuture) return null;

            return (
              <Card 
                key={dateStr} 
                className={cn(
                  "overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300",
                  today && "ring-2 ring-blue-500 ring-offset-2",
                  !hasOrders && "opacity-60"
                )}
              >
                <CardContent className="p-0">
                  <div className="flex items-stretch">
                    {/* Date Badge */}
                    <div className={cn(
                      "flex flex-col items-center justify-center w-16 md:w-20 py-3 shrink-0",
                      today 
                        ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white" 
                        : job && ['EXPORTED', 'SYNCED'].includes(job.status)
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-600"
                    )}>
                      <span className="text-2xl md:text-3xl font-bold">{format(day, 'd')}</span>
                      <span className="text-xs font-medium uppercase">{format(day, 'EEE')}</span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 p-3 md:p-4 flex flex-col justify-center gap-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-slate-900 text-sm md:text-base">
                            {today ? 'Today' : format(day, 'MMMM d')}
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {hasOrders ? (
                              <>
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                                  <Database className="h-3 w-3" />
                                  {totalCount} orders
                                </span>
                                {archivedCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                                    <CheckCircle className="h-3 w-3" />
                                    {archivedCount} archived
                                  </span>
                                )}
                                {newOrdersCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                                    +{newOrdersCount} new
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-slate-400">No orders</span>
                            )}
                          </div>
                        </div>

                        {/* Action/Status */}
                        <div className="shrink-0">
                          {job ? (
                            <div className="flex items-center gap-2">
                              {(() => {
                                const status = getJobStatus(job);
                                const Icon = status.icon;
                                return (
                                  <span className={cn(
                                    "hidden md:inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium",
                                    status.bgColor, status.color
                                  )}>
                                    <Icon className={cn("h-3 w-3", ['APPENDING', 'IN_PROGRESS', 'EXPORTING'].includes(job.status) && "animate-spin")} />
                                    {status.label}
                                  </span>
                                );
                              })()}
                              
                              {canAppend ? (
                                <Button 
                                  size="sm" 
                                  onClick={() => router.push(`/orders/${dateStr}`)}
                                  className="h-9 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-full px-4"
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Append
                                </Button>
                              ) : (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => router.push(`/archive/${job.job_id}`)}
                                  className="h-9 text-sm rounded-full px-4"
                                >
                                  <Eye className="h-4 w-4 mr-1" />
                                  View
                                </Button>
                              )}
                            </div>
                          ) : hasOrders ? (
                            <Button 
                              size="sm"
                              onClick={() => router.push(`/orders/${dateStr}`)}
                              className="h-9 text-sm bg-blue-600 hover:bg-blue-700 rounded-full px-4"
                            >
                              <Archive className="h-4 w-4 mr-1" />
                              Archive
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Empty State */}
      {!loading && days.filter(d => d <= new Date()).length === 0 && (
        <div className="text-center py-12">
          <Sparkles className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No data yet</h3>
          <p className="text-slate-500">Archives will appear here once you have orders.</p>
        </div>
      )}
    </div>
  );
}
