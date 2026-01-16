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
  const [debugBanner, setDebugBanner] = useState<string>('');

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

  const fetchDashboardData = async () => {
    if (!restaurantId) return;
    setLoading(true);
    
    try {
      const start = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const end = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

      // 1. Parallel Fetch: Jobs, Sales, Live Orders
      let recentOrders: any[] = [];
      let fetchDebug = "Init";
      
      try {
        // Try to fetch with date range to ensure we get all orders for the view
        const ordersRes = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&start_date=${start}&end_date=${end}&limit=1000`);
        if (Array.isArray(ordersRes.data)) {
           recentOrders = ordersRes.data;
           fetchDebug = `Array (${ordersRes.data.length})`;
        } else if (ordersRes.data?.data?.orders && Array.isArray(ordersRes.data.data.orders)) {
           recentOrders = ordersRes.data.data.orders;
           fetchDebug = `Obj.data.orders (${recentOrders.length})`;
        } else if (ordersRes.data && Array.isArray(ordersRes.data.data)) {
           recentOrders = ordersRes.data.data;
           fetchDebug = `Obj.data (${recentOrders.length})`;
        } else if (ordersRes.data && Array.isArray(ordersRes.data.orders)) {
           recentOrders = ordersRes.data.orders;
           fetchDebug = `Obj.orders (${recentOrders.length})`;
        } else if (ordersRes.data && Array.isArray(ordersRes.data.results)) {
           recentOrders = ordersRes.data.results;
           fetchDebug = `Obj.results (${recentOrders.length})`;
        } else if (ordersRes.data && Array.isArray(ordersRes.data.items)) {
           recentOrders = ordersRes.data.items;
           fetchDebug = `Obj.items (${recentOrders.length})`;
        } else {
           const keys = ordersRes.data ? Object.keys(ordersRes.data).join(', ') : 'null';
           fetchDebug = `Keys: [${keys}]`;
           console.log("Unknown orders response:", ordersRes.data);
        }
      } catch (err: any) {
        fetchDebug = `Err: ${err.message}`;
        console.error("Orders Fetch Error:", err);
      }

      const [resJobs, resSales] = await Promise.all([
        archiveApi.get(`/archive/jobs?start_day=${start}&end_day=${end}`).catch(e => ({ data: { jobs: [] } })),
        mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`).catch(e => ({ data: {} })),
      ]); // orders fetched separately above

      // Process Jobs
      let fetchedJobs = resJobs.data.jobs || [];
      
      // Process Sales
      const salesData = resSales.data?.data || resSales.data;
      if (salesData?.periods && Array.isArray(salesData.periods)) {
        const mappedStats = salesData.periods.map((item: any) => ({
          date: item.period || item.date,
          order_count: item.orders || item.order_count || 0,
          total_amount: item.sales || item.total_amount || 0
        }));
        setDailyStats(mappedStats);
      }
      
      if (salesData?.total_orders !== undefined) {
        setTotalOrders(salesData.total_orders || 0);
        setTotalSales(salesData.total_sales || salesData.total_amount || 0);
      }

      // Process Live Orders
      // console.log('DEBUG: resOrders raw:', recentOrders);
      const orders = parseOrdersResponse(recentOrders).filter((o: any) => {
        const s = o.status?.toLowerCase();
        return s === 'completed' || s === 'paid';
      });
      console.log('DEBUG: Filtered completed/paid orders:', orders.length, orders.slice(0, 5));
      setAllRecentOrders(orders);

      // 2. Hydration: Fetch Compare/Manifest for relevant jobs
      // We do this BEFORE setting loading to false to prevent UI flash
      const jobsNeedingData = fetchedJobs.filter((j: any) => 
        ['EXPORTED', 'SYNCED'].includes(j.status)
      );

      const updates = new Map<string, { orders?: number }>();
      const idsUpdate = new Map<string, Set<number>>();

      if (jobsNeedingData.length > 0) {
        await Promise.all(jobsNeedingData.map(async (job: any) => {
          const update: { orders?: number } = {};
          
          try {
            // 1. Fetch COMPARE (for new/safe-to-delete logic)
            const compareRes = await archiveApi.get(`/archive/${job.job_id}/compare`, {
              headers: { 'X-Restaurant-ID': String(job.restaurant_id) }
            });
            
            if (Array.isArray(compareRes.data?.order_ids?.safe_to_delete)) {
              const safe = compareRes.data.order_ids.safe_to_delete || [];
              const deleted = compareRes.data.order_ids.already_deleted || [];
              const allArchived = new Set([...safe, ...deleted]);
              idsUpdate.set(job.job_id, allArchived); 
            }

            // 2. Fetch QUERY (for strict count of COMPLETED orders only)
            // We cannot rely on metadata row_counts because it includes PENDING/CANCELLED
            const queryRes = await archiveApi.get(`/archive/${job.job_id}/query/orders`);
            const allArchivedRaw = parseOrdersResponse(queryRes.data);
            
            // FILTER strict valid orders
            const validArchivedOrders = allArchivedRaw.filter((o: any) => {
              const s = o.status?.toLowerCase();
              return s === 'completed' || s === 'paid';
            });

            update.orders = validArchivedOrders.length;

            // CRITICAL FIX: Update idsUpdate to ONLY include the IDs of strictly completed orders.
            // Previously, we used 'compareRes' which included ALL archived IDs (even pending).
            // This caused 'Pending-in-Archive' orders to be excluded from 'New' counts, masking them completely.
            // By using strict IDs here, 'Pending-in-Archive' + 'Completed-in-Live' orders will appear as 'New'.
            const validIds = new Set(validArchivedOrders.map((o: any) => o.id || o.order_id));
            idsUpdate.set(job.job_id, validIds);

          } catch (e) {
            console.warn(`Failed to fetch details for ${job.job_id}`, e);
            // Fallback to metadata if query fails
            update.orders = job.row_counts?.orders || 0;
          }
          
          if (update.orders !== undefined) {
            updates.set(job.job_id, update);
          }
        }));
      }

      // Process Orders
      const allOrders = recentOrders;

      // Helper: Strict Nepal Date (UTC + 5:45)
      const getNepalDate = (isoString: string) => {
          const date = new Date(isoString);
          if (isNaN(date.getTime())) return "";
          // Nepal is UTC + 5:45
          // Add offset in milliseconds: (5 * 60 + 45) * 60 * 1000 = 20700000
          const nepalTime = date.getTime() + 20700000;
          return new Date(nepalTime).toISOString().split('T')[0];
      };

      // 3. STRICT TOTALS CALCULATION
      // We ignore backend 'total_orders' because it includes cancelled orders.
      // We reconstruct the total by summing up the strict daily counts.
      let calcTotalOrders = 0;

      const updatedJobs = fetchedJobs.map((job: any) => {
        const update = updates.get(job.job_id);
        if (update) {
          return {
            ...job,
            row_counts: {
              ...job.row_counts,
              orders: update.orders
            }
          };
        }
        return job;
      });

      const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentMonth),
        end: endOfMonth(currentMonth)
      });

      daysInMonth.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        
        // Find Job in UPDATED list
        const job = updatedJobs.find((j: any) => j.archive_day === dateStr && ['EXPORTED', 'SYNCED'].includes(j.status));
        const jobCount = job ? (job.row_counts?.orders || 0) : 0;
        
        // Find Live Strict (Local Date Only)
        const dayStrictLive = orders.filter((o: any) => {
            const t = o.created_at || o.business_date;
            if (!t) return false;
            const nd = getNepalDate(t);
            // DEBUG: Specific check for Jan 15 anomalies
            if (dateStr === '2026-01-15' && nd === '2026-01-15') {
                 console.log(`[Jan15 LEAK] Found order ${o.id} Time=${t} NepalDate=${nd}`);
            }
            return nd === dateStr;
        });

        // Calculate Day Total (Logic matches Card)
        let dayTotal = 0;

        if (job) {
             // New = Live strict that are NOT in archive IDs
             const jobIds = idsUpdate.get(job.job_id);
             const newOrders = jobIds 
                ? dayStrictLive.filter((o: any) => !jobIds.has(o.id || o.order_id))
                : dayStrictLive; 
             
             // For count:
             const newCount = jobIds 
                ? newOrders.length
                : Math.max(0, dayStrictLive.length - jobCount);
             
             dayTotal = jobCount + newCount;
             
        } else {
             dayTotal = dayStrictLive.length;
        }
        
        calcTotalOrders += dayTotal;
      });

      // Update State
      setTotalOrders(calcTotalOrders);
      setJobs(updatedJobs);
      setArchivedJobIds(prev => {
        const next = new Map(prev);
        idsUpdate.forEach((ids, jobId) => next.set(jobId, ids));
        return next;
      });

    } catch (err) {
      console.error("Dashboard fetch failed", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, [restaurantId, currentMonth]);

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
  // FIX: Only count successful jobs
  const totalArchivedOrders = jobs
    .filter(j => ['EXPORTED', 'SYNCED'].includes(j.status))
    .reduce((sum, j) => {
      const anyJob = j as any;
      return sum + (anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0);
  }, 0);

  return (
    <div className="space-y-4 md:space-y-6 pb-20 md:pb-0">
      {/* Debug Banner */}
      {debugBanner && (
        <div className="mb-4 p-2 bg-red-100 border border-red-300 rounded text-red-700 font-mono text-sm">
          <strong>DEBUG INFO:</strong> {debugBanner}
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-8">
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
              onClick={fetchDashboardData} 
              disabled={loading}
              className="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 border-0 text-white p-0"
            >
              <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
            </Button>
          </div>
          
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              {loading ? (
                <div className="h-8 w-16 bg-white/20 rounded mx-auto mb-1 animate-pulse" />
              ) : (
                <p className="text-2xl md:text-3xl font-bold">{totalOrders}</p>
              )}
              <p className="text-xs md:text-sm text-blue-200">Orders</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              {loading ? (
                <div className="h-8 w-16 bg-white/20 rounded mx-auto mb-1 animate-pulse" />
              ) : (
                <p className="text-2xl md:text-3xl font-bold">{totalArchivedOrders}</p>
              )}
              <p className="text-xs md:text-sm text-blue-200">Archived</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-3 text-center">
              {loading ? (
                <div className="h-8 w-24 bg-white/20 rounded mx-auto mb-1 animate-pulse" />
              ) : (
                <p className="text-2xl md:text-3xl font-bold">Rs.{(totalSales/1000).toFixed(0)}k</p>
              )}
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
        {loading ? (
          // Skeleton Loading State
          Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="overflow-hidden border-slate-100">
              <CardContent className="p-0">
                <div className="flex items-stretch h-24">
                  <div className="w-16 md:w-20 bg-slate-50 shrink-0 flex items-center justify-center border-r border-slate-100">
                    <div className="h-8 w-8 bg-slate-200 rounded animate-pulse" />
                  </div>
                  <div className="flex-1 p-3 md:p-4 flex flex-col justify-center gap-3">
                    <div className="h-4 w-32 bg-slate-100 rounded animate-pulse" />
                    <div className="flex items-center justify-between">
                      <div className="h-3 w-24 bg-slate-100 rounded animate-pulse" />
                      <div className="h-8 w-20 bg-slate-100 rounded-full animate-pulse" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const stat = dailyStats.find(s => s.date === dateStr);
            const job = getJobForDate(dateStr);
            const isFuture = day > new Date();
            // ... (rest of logic)
            const today = isToday(day);
            
            // Filter live orders for this day using exact logic from OrdersDayPage
            const dayLiveOrders = allRecentOrders.filter((o: any) => {
              const timestamp = o.created_at || o.business_date;
              if (!timestamp) return false;
              // Strict UTC prefix check OR Local date check
              const match = timestamp.startsWith(dateStr) || new Date(timestamp).toLocaleDateString('en-CA') === dateStr;
              if (dateStr === '2026-01-15' && !match) {
                 // console.log('DEBUG: Skipped Jan 15 order:', o.id, timestamp);
              }
              return match;
            });
            if (dateStr === '2026-01-15') {
               console.log('DEBUG: Jan 15 Live Orders:', dayLiveOrders.length, dayLiveOrders.map((o:any) => o.id));
            }

            const archivedIds = job ? archivedJobIds.get(job.job_id) : undefined;
            const anyJob = job as any;
            const archivedCount = job ? (anyJob.row_counts?.orders || anyJob.row_count || anyJob.orders_count || 0) : 0;

            // New Orders: Filter day's live orders against known archived IDs
            const newOrdersCount = archivedIds 
              ? dayLiveOrders.filter(o => !archivedIds.has(o.id || o.order_id)).length
              : (job && ['EXPORTED', 'SYNCED'].includes(job.status)) 
                ? Math.max(0, dayLiveOrders.length - archivedCount) // Fallback if IDs missing
                : dayLiveOrders.length;
            
            // Total Count: Prioritize our filtered counts over backend stats (which might include cancelled)
            const totalCount = job && ['EXPORTED', 'SYNCED'].includes(job.status)
              ? archivedCount + newOrdersCount
              : dayLiveOrders.length;
            
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
                                <span className="inline-flex items-center gap-1 text-xs text-slate-500 whitespace-nowrap">
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
    </div>
  );
}
