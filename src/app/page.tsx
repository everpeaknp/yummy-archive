"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { Loader2, Archive, Eye, ChevronLeft, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock, FilePlus } from 'lucide-react';
import { ArchiveJob } from '@/types';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { restaurantId, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [loading, setLoading] = useState(false);
  const [creatingJobForDate, setCreatingJobForDate] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

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
      // Don't clear jobs here, kept state might be better than empty
    }

    try {
      // Restore the working endpoint that gave 4 orders
      // If this fails, we will try the analytics endpoint
      const resSales = await mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`);
      console.log("Sales response:", resSales.data);
      
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
        console.warn("Sales endpoint failed, trying analytics...", err);
        try {
            // Fallback to analytics endpoint from API docs
            const resAnalytics = await mainApi.get(`/analytics/dashboard?restaurant_id=${restaurantId}`);
            const data = resAnalytics.data;
            if (data?.total_orders) setTotalOrders(data.total_orders);
            if (data?.total_sales) setTotalSales(data.total_sales);
        } catch (analyticsErr) {
             console.error("Analytics also failed", analyticsErr);
        }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [restaurantId, currentMonth]);

  // Hydrate jobs with manifest data (row counts) and compare data (safe_to_delete)
  useEffect(() => {
    const fetchJobDetails = async () => {
        const jobsNeedingData = jobs.filter(j => 
            ['EXPORTED', 'SYNCED'].includes(j.status) && 
            ((j.row_counts?.orders === undefined) || (j as any).safe_to_delete === undefined)
        );

        if (jobsNeedingData.length === 0) return;

        // Fetch manifest and compare data in parallel
        const updates = new Map<string, { orders?: number; safe_to_delete?: number }>();
        
        await Promise.all(jobsNeedingData.map(async (job) => {
            const update: { orders?: number; safe_to_delete?: number } = {};
            
            // Fetch manifest for order count
            try {
                const manifestRes = await archiveApi.get(`/archive/${job.job_id}/manifest`);
                update.orders = manifestRes.data?.row_counts?.orders || 0;
            } catch (e) {
                console.warn(`[Dashboard] Failed to fetch manifest for ${job.job_id}`, e);
            }
            
            // Fetch compare for safe_to_delete count
            try {
                const compareRes = await archiveApi.get(`/archive/${job.job_id}/compare`, {
                    headers: { 'X-Restaurant-ID': String(job.restaurant_id) }
                });
                update.safe_to_delete = compareRes.data?.summary?.safe_to_delete || 0;
            } catch (e) {
                console.warn(`[Dashboard] Failed to fetch compare for ${job.job_id}`, e);
            }
            
            if (update.orders !== undefined || update.safe_to_delete !== undefined) {
                updates.set(job.job_id, update);
            }
        }));

        if (updates.size > 0) {
            setJobs(prev => prev.map(j => {
                const update = updates.get(j.job_id);
                if (update) {
                    return { 
                        ...j, 
                        row_counts: { ...j.row_counts, orders: update.orders ?? j.row_counts?.orders },
                        safe_to_delete: update.safe_to_delete
                    } as any;
                }
                return j;
            }));
        }
    };

    fetchJobDetails();
  }, [jobs.length]); // Only re-run when jobs array length changes

  const handleArchive = async (date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    if (!confirm(`Archive orders for ${dateStr}?`)) return;

    setCreatingJobForDate(dateStr);
    try {
      const payload = {
        restaurant_id: restaurantId,
        start_date: `${dateStr}T00:00:00Z`,
        end_date: `${dateStr}T23:59:59Z`
      };
      await archiveApi.post('/jobs/archive', payload);
      await fetchJobs();
    } catch (err) {
      console.error("Failed to create archive", err);
      alert("Failed to create archive job");
    } finally {
      setCreatingJobForDate(null);
    }
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => direction === 'prev' ? subMonths(prev, 1) : addMonths(prev, 1));
  };

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  });

  const getJobForDate = (dateStr: string) => {
    // Find all jobs for this day
    const candidates = jobs.filter(j => j.archive_day === dateStr);
    
    if (candidates.length === 0) return undefined;
    
    // Sort logic:
    // 1. Prefer complete statuses (EXPORTED, SYNCED) over others
    // 2. Prefer latest created_at
    const completeStatuses = ['EXPORTED', 'SYNCED'];
    candidates.sort((a: any, b: any) => {
        const aComplete = completeStatuses.includes(a.status);
        const bComplete = completeStatuses.includes(b.status);
        if (aComplete && !bComplete) return -1;
        if (!aComplete && bComplete) return 1;
        
        // If status same, sort by date desc
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
    });
    
    return candidates[0];
  };

  const getStatusBadge = (job: ArchiveJob) => {
    const statusConfig: Record<string, { bg: string; text: string; icon: any }> = {
      EXPORTED: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
      SYNCED: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
      FAILED: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
      APPENDING: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 },
      IN_PROGRESS: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 },
      EXPORTING: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 }
    };
    const config = statusConfig[job.status] || statusConfig.PENDING;
    const Icon = config.icon;
    return (
      <span className={cn("inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium", config.bg, config.text)}>
        <Icon className={cn("h-3 w-3", job.status === 'EXPORTING' && "animate-spin")} />
        {job.status}
      </span>
    );
  };

  if (!isAuthenticated) return null;

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Archive Dashboard</h1>
          <p className="text-slate-500 text-sm md:text-base mt-1">Manage your daily order archives</p>
        </div>
        
        {/* Month Navigator */}
        <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 shadow-sm p-1">
          <Button variant="ghost" size="sm" onClick={() => navigateMonth('prev')} className="h-9 w-9 p-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-slate-900 w-28 md:w-36 text-center text-sm md:text-base">
            {format(currentMonth, 'MMMM yyyy')}
          </span>
          <Button variant="ghost" size="sm" onClick={() => navigateMonth('next')} className="h-9 w-9 p-0">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={fetchJobs} disabled={loading} className="h-9 w-9 p-0">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-4 md:p-6">
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Total Revenue</p>
            <p className="text-xl md:text-2xl font-bold text-slate-900">
              Rs. {totalSales.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-4 md:p-6">
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Total Orders</p>
            <p className="text-xl md:text-2xl font-bold text-slate-900">
              {totalOrders}
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-4 md:p-6">
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Archived Orders</p>
            <p className="text-xl md:text-2xl font-bold text-green-600">
              {jobs.reduce((sum, j) => {
                 const anyJob = j as any;
                 const count = anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0;
                 return sum + count;
              }, 0).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-4 md:p-6">
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Pending/Failed</p>
            <p className="text-xl md:text-2xl font-bold text-amber-600">
              {jobs.filter(j => !['EXPORTED', 'SYNCED'].includes(j.status)).length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Days List */}
      <Card className="overflow-hidden">
        <CardHeader className="bg-slate-50 border-b px-4 md:px-6 py-3 md:py-4">
          <CardTitle className="text-base md:text-lg font-semibold text-slate-900">Daily Overview</CardTitle>
        </CardHeader>
        <div className="divide-y divide-slate-100">
          {loading && days.length === 0 ? (
            <div className="p-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto text-blue-500" />
              <p className="mt-2 text-slate-500">Loading...</p>
            </div>
          ) : (
            days.map(day => {
              const dateStr = format(day, 'yyyy-MM-dd');
              const stat = dailyStats.find(s => s.date === dateStr);
              const job = getJobForDate(dateStr);
              const isFuture = day > new Date();
              
              const totalCount = stat?.order_count || 0;
              const anyJob = job as any;
              
              // archivedCount = total orders in archive (includes deleted from live)
              const archivedCount = job ? (anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0) : 0;
              
              // safe_to_delete = orders in BOTH live AND archive (from /compare endpoint)
              // If we have accurate safe_to_delete from /compare, use it
              // Otherwise fall back to approximation
              const safeToDelete = anyJob?.safe_to_delete;
              
              // New orders = total in live - orders already archived (safe_to_delete)
              // If safe_to_delete is known: new = total - safe_to_delete
              // If not known: approximate with min(total, archived)
              const newOrdersCount = safeToDelete !== undefined 
                ? Math.max(0, totalCount - safeToDelete)
                : Math.max(0, totalCount - Math.min(totalCount, archivedCount));
              
              const canAppend = job && ['EXPORTED', 'SYNCED'].includes(job.status) && newOrdersCount > 0;

              return (
                <div 
                  key={dateStr} 
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 gap-3 hover:bg-slate-50/50 transition-colors border-b last:border-0",
                    isFuture && "opacity-50"
                  )}
                >
                  <div className="flex items-center gap-3 md:gap-4 flex-1">
                    <div className="h-10 w-10 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm md:text-base shadow-sm shrink-0">
                      {format(day, 'd')}
                    </div>
                    <div className="flex flex-col gap-1 w-full">
                      <p className="font-medium text-slate-900 text-sm md:text-base flex items-center gap-2">
                          {format(day, 'EEEE, MMM d')}
                          {isFuture && <span className="text-xs font-normal text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Future</span>}
                      </p>
                      
                      {!isFuture && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:text-sm">
                            <span className="text-slate-600 font-medium" title="Total Orders in Sales">
                                Total: <span className="text-slate-900">{totalCount}</span>
                            </span>
                            <span className="text-slate-300">|</span>
                            <span className={cn("font-medium", archivedCount > 0 ? "text-green-600" : "text-slate-400")} title="Archived Orders">
                                Archived: {archivedCount}
                            </span>
                             <span className="text-slate-300">|</span>
                             <span className={cn("font-medium", newOrdersCount > 0 ? "text-amber-600" : "text-slate-400")} title="New Orders">
                                New: {newOrdersCount}
                             </span>
                             <span className="text-slate-300 hidden sm:inline">•</span>
                             <span className="text-slate-500">Rs. {stat?.total_amount?.toLocaleString() || 0}</span>
                          </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center ml-12 sm:ml-0 shrink-0">
                    {job ? (
                      <>
                        {getStatusBadge(job)}
                        
                        {canAppend ? (
                            <Button 
                                size="sm" 
                                onClick={() => router.push(`/orders/${dateStr}`)}
                                className="h-8 text-xs md:text-sm bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                            >
                                <FilePlus className="h-3.5 w-3.5 mr-1" />
                                Append ({newOrdersCount})
                            </Button>
                        ) : (
                            <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => router.push(`/archive/${job.job_id}`)}
                                className="h-8 text-xs md:text-sm"
                            >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                View
                            </Button>
                        )}
                      </>
                    ) : !isFuture ? (
                      <Button 
                        size="sm"
                        onClick={() => router.push(`/orders/${dateStr}`)}
                        className="h-8 text-xs md:text-sm bg-blue-600 hover:bg-blue-700"
                      >
                        <Archive className="h-3.5 w-3.5 mr-1" />
                        Archive All
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400 italic px-2">
                        Future
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
