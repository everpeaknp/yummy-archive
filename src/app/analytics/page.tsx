"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { mainApi, archiveApi } from '@/services/api';
import { format, subDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { 
  Loader2, TrendingUp, TrendingDown, Calendar, RefreshCw, 
  ShoppingBag, DollarSign, Users, Archive, ChevronDown, ChevronUp
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function AnalyticsPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dateRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  
  const [dailyStats, setDailyStats] = useState<any[]>([]);
  const [archiveJobs, setArchiveJobs] = useState<any[]>([]);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Auto-scroll to end of chart
  useEffect(() => {
    if (dailyStats.length > 0) {
      setTimeout(() => {
        const container = document.getElementById('revenue-chart-container');
        if (container) {
          container.scrollLeft = container.scrollWidth;
        }
      }, 100);
    }
  }, [dailyStats]);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) fetchData();
  }, [restaurantId, dateRange]);

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [salesRes, jobsRes] = await Promise.allSettled([
        mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`),
        archiveApi.get(`/archive/jobs?start_day=${dateRange.start}&end_day=${dateRange.end}`)
      ]);

      if (salesRes.status === 'fulfilled') {
        const rawData = salesRes.value.data;
        const salesData = rawData?.data || rawData;
        
        if (salesData?.periods) {
          const mapped = salesData.periods.map((p: any) => {
             // Normalize date to YYYY-MM-DD
             const rawDate = p.period || p.date;
             let dateStr = rawDate;
             try {
                if (typeof rawDate === 'string' && rawDate.includes('T')) {
                    dateStr = rawDate.split('T')[0];
                }
             } catch (e) {}
             
             return {
                date: dateStr,
                orders: p.orders || p.order_count || 0,
                revenue: p.sales || p.total_amount || 0
             };
          });
          setDailyStats(mapped);
        } else {
           setDailyStats([]);
        }
      } else {
        console.error('[Analytics] Sales fetch rejected:', salesRes.reason);
      }

      if (jobsRes.status === 'fulfilled') {
        const jobs = jobsRes.value.data?.jobs || [];
        setArchiveJobs(jobs);
        // Kick off deeper stats fetch for accuracy
        // Await this so we don't flash "Live Data" (12.5k) before "Archive Data" (13.5k) arrives
        await fetchArchiveStats(jobs);
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const [archiveStats, setArchiveStats] = useState<Record<string, { revenue: number, orders: number }>>({});

  const fetchArchiveStats = async (jobs: any[]) => {
    // Filter for valid completed jobs in the current date range
    const validJobs = jobs.filter(j => ['EXPORTED', 'SYNCED'].includes(j.status));
    
    // If no valid jobs, we can return early (loading will be false in finally block)
    if (validJobs.length === 0) return;

    try {
      // Parallel fetch of ORDER LISTS to calculate TRUE "Completed" totals.
      // We cannot rely on backend 'summary.archived_total' because it includes "Cancelled" orders.
      // We must fetch the actual rows and filter client-side, just like the Detail page.
      const results = await Promise.allSettled(
        validJobs.map(async (job) => {
             // Fetch up to 2000 orders (reasonable max for a day) to get accurate sum
             const res = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=2000`);
             const allOrders = res.data?.data || [];
             
             // Strict Filter: Only count COMPLETED/PAID orders
             const validOrders = allOrders.filter((o: any) => {
                 const s = o.status?.toLowerCase();
                 return s === 'completed' || s === 'paid';
             });

             const dayRevenue = validOrders.reduce((sum: number, o: any) => sum + (o.grand_total || o.total || 0), 0);
             
             return {
                 date: job.archive_day,
                 id: job.job_id,
                 total: dayRevenue,
                 count: validOrders.length
             };
        })
      );

      const statsMap: Record<string, { revenue: number, orders: number }> = {};
      results.forEach(res => {
        if (res.status === 'fulfilled' && res.value) {
          statsMap[res.value.date] = {
            revenue: res.value.total || 0,
            orders: res.value.count || 0
          };
        }
      });
      
      setArchiveStats(prev => ({ ...prev, ...statsMap }));
    } catch (err) {
      console.warn("Failed to fetch detailed archive stats", err);
    }
  };

  // Calculate insights
  const insights = useMemo(() => {
    // Helper to get Best Data (Archive > Live)
    const getBestStat = (d: any) => {
       const dateStr = d.date;
       const arch = archiveStats[dateStr];
       if (arch) return { revenue: arch.revenue, orders: arch.orders };
       return { revenue: d.revenue, orders: d.orders };
    };

    const today = format(new Date(), 'yyyy-MM-dd');
    const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    
    // We must remap dailyStats to use best data for totals calculation
    const enhancedStats = dailyStats.map(d => ({ ...d, ...getBestStat(d) }));
    
    const last7Days = enhancedStats.slice(0, 7);
    const prev7Days = enhancedStats.slice(7, 14);

    const todayStat = enhancedStats.find(d => d.date === today);
    const yesterdayStat = enhancedStats.find(d => d.date === yesterday);

    const totalRevenue = enhancedStats.reduce((sum, d) => sum + d.revenue, 0);
    const totalOrders = enhancedStats.reduce((sum, d) => sum + d.orders, 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    const last7Revenue = last7Days.reduce((sum, d) => sum + d.revenue, 0);
    const prev7Revenue = prev7Days.reduce((sum, d) => sum + d.revenue, 0);
    const weeklyTrend = prev7Revenue > 0 ? Math.round(((last7Revenue - prev7Revenue) / prev7Revenue) * 100) : 0;

    const archivedDays = archiveJobs.filter(j => ['EXPORTED', 'SYNCED'].includes(j.status)).length;
    const totalDays = eachDayOfInterval({ 
      start: new Date(dateRange.start), 
      end: new Date(dateRange.end) 
    }).length;

    const bestDay = enhancedStats.reduce((best, d) => d.revenue > (best?.revenue || 0) ? d : best, null);

    return {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      todayRevenue: todayStat?.revenue || 0,
      todayOrders: todayStat?.orders || 0,
      yesterdayRevenue: yesterdayStat?.revenue || 0,
      weeklyTrend,
      archivedDays,
      totalDays,
      archivePercent: totalDays > 0 ? Math.round((archivedDays / totalDays) * 100) : 0,
      bestDay
    };
  }, [dailyStats, archiveJobs, archiveStats, dateRange]);

  // Get unified daily data
  const unifiedData = useMemo(() => {
    const days = eachDayOfInterval({ 
      start: new Date(dateRange.start), 
      end: new Date(dateRange.end) 
    });

    return days.map(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const job = archiveJobs.find(j => j.archive_day === dateStr);
      const isArchived = ['EXPORTED', 'SYNCED'].includes(job?.status);
      
      // Source of Truth Hierarchy:
      // 1. Archive Stats (loaded from Compare endpoint) - Contains deleted data
      // 2. Live Stats (from Sales API) - Misses deleted data
      
      const archStat = archiveStats[dateStr];
      const liveStat = dailyStats.find(s => {
          if (s.date === dateStr) return true;
          try { return new Date(s.date).toISOString().split('T')[0] === dateStr; } 
          catch(e) { return false; }
      });

      let finalRevenue = liveStat?.revenue || 0;
      let finalOrders = liveStat?.orders || 0;

      // If we have authoritative archive data, use it (it likely includes deleted orders)
      if (archStat) {
         finalRevenue = archStat.revenue;
         finalOrders = archStat.orders;
      }

      return {
        date: day,
        dateStr,
        revenue: finalRevenue,
        orders: finalOrders,
        archived: isArchived,
        archiveStatus: job?.status || 'NOT_ARCHIVED'
      };
    }).reverse();
  }, [dailyStats, archiveJobs, archiveStats, dateRange]);

  const maxRevenue = Math.max(...unifiedData.map(d => d.revenue), 1);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-12 w-12 animate-spin text-blue-500 mb-4" />
        <p className="text-slate-500">Loading insights...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="text-sm text-slate-500">{format(new Date(dateRange.start), 'MMM d')} - {format(new Date(dateRange.end), 'MMM d, yyyy')}</p>
        </div>
        <Button 
          onClick={() => fetchData(true)} 
          disabled={refreshing}
          variant="ghost"
          size="sm"
          className="h-10 w-10 rounded-full p-0"
        >
          <RefreshCw className={cn("h-5 w-5", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Hero Stats Card */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-5 text-white">
          <div className="flex items-center gap-3 mb-4">
            <TrendingUp className="h-6 w-6" />
            <div>
              <p className="font-bold">Monthly Overview</p>
              <p className="text-sm text-blue-200">{format(new Date(dateRange.start), 'MMMM yyyy')}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-2xl md:text-3xl font-bold">Rs. {(insights.totalRevenue / 1000).toFixed(0)}k</p>
              <p className="text-xs text-blue-200">Total Revenue</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-2xl md:text-3xl font-bold">{insights.totalOrders}</p>
              <p className="text-xs text-blue-200">Orders</p>
            </div>
          </div>
        </div>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center">
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-xs text-slate-500">Avg Order</span>
          </div>
          <p className="text-lg font-bold text-slate-900">Rs. {insights.avgOrderValue.toLocaleString()}</p>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className={cn(
              "h-8 w-8 rounded-lg flex items-center justify-center",
              insights.weeklyTrend >= 0 ? "bg-emerald-100" : "bg-red-100"
            )}>
              {insights.weeklyTrend >= 0 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
            </div>
            <span className="text-xs text-slate-500">Weekly</span>
          </div>
          <p className={cn(
            "text-lg font-bold",
            insights.weeklyTrend >= 0 ? "text-emerald-600" : "text-red-600"
          )}>
            {insights.weeklyTrend >= 0 ? '+' : ''}{insights.weeklyTrend}%
          </p>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-purple-100 flex items-center justify-center">
              <Archive className="h-4 w-4 text-purple-600" />
            </div>
            <span className="text-xs text-slate-500">Archived</span>
          </div>
          <p className="text-lg font-bold text-purple-600">{insights.archivePercent}%</p>
        </Card>

        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-lg bg-amber-100 flex items-center justify-center">
              <Calendar className="h-4 w-4 text-amber-600" />
            </div>
            <span className="text-xs text-slate-500">Best Day</span>
          </div>
          <p className="text-sm font-bold text-slate-900 truncate">
            {insights.bestDay ? format(new Date(insights.bestDay.date), 'MMM d') : '-'}
          </p>
        </Card>
      </div>

      {/* Daily Revenue Chart */}
      <Card className="p-4 md:p-6">
        <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-slate-900">Daily Revenue Trend</h3>
            <div className="flex items-center gap-2 text-xs text-slate-500">
               <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Live</div>
               <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Archived</div>
            </div>
        </div>
        <div 
          id="revenue-chart-container"
          className="h-48 md:h-56 flex items-end gap-2 md:gap-3 overflow-x-auto pb-2 px-1 scroll-smooth"
        >
          {unifiedData
            .filter(d => d.date <= new Date())
            .slice(0, 14)
            .reverse()
            .map((day, i, arr) => {
              const heightPercent = Math.max((day.revenue / maxRevenue) * 100, 4);
              const isLast = i === arr.length - 1;
              
              return (
                <div 
                  key={day.dateStr} 
                  id={isLast ? "last-chart-bar" : undefined}
                  className="flex-1 min-w-[24px] flex flex-col items-center group relative cursor-pointer"
                  onClick={() => setExpandedDay(expandedDay === day.dateStr ? null : day.dateStr)}
                >
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-3 hidden group-hover:block bg-slate-800 text-white text-xs p-2.5 rounded-lg z-10 whitespace-nowrap shadow-xl pointer-events-none transform -translate-x-1/2 left-1/2">
                    <p className="font-bold text-sm">Rs. {day.revenue.toLocaleString()}</p>
                    <p className="text-slate-300 text-xs mt-0.5">{day.orders} orders</p>
                    <div className="w-2 h-2 bg-slate-800 absolute -bottom-1 left-1/2 -translate-x-1/2 rotate-45"></div>
                  </div>
                  
                  {/* Bar */}
                  <div className="w-full relative flex items-end justify-center group-hover:scale-105 transition-transform duration-200">
                    <div 
                        className={cn(
                        "w-full rounded-md transition-all duration-300 relative overflow-hidden",
                        day.archived 
                            ? "bg-gradient-to-t from-emerald-500 to-emerald-400 border-t border-emerald-300" 
                            : "bg-gradient-to-t from-blue-500 to-blue-400 border-t border-blue-300",
                        "shadow-sm group-hover:shadow-md group-hover:brightness-110"
                        )}
                        style={{ height: `${heightPercent}px`, minHeight: '8px' }}
                    />
                  </div>
                  
                  {/* Date Label */}
                  <span className="text-[10px] md:text-xs text-slate-500 font-medium mt-2 whitespace-nowrap">
                    {format(day.date, 'd')}
                  </span>
                  <span className="text-[9px] text-slate-400 whitespace-nowrap hidden sm:block">
                     {format(day.date, 'EEE')}
                  </span>
                </div>
            );
          })}
        </div>
      </Card>

      {/* Daily Breakdown */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b bg-slate-50">
          <h3 className="font-bold text-slate-900">Daily Breakdown</h3>
          <p className="text-xs text-slate-500">Tap a day to see details</p>
        </div>
        <div className="divide-y">
          {unifiedData
            .filter(d => d.date <= new Date())
            .slice(0, 14)
            .map(day => {
            const isExpanded = expandedDay === day.dateStr;
            const isToday = day.dateStr === format(new Date(), 'yyyy-MM-dd');
            
            return (
              <div key={day.dateStr}>
                <div 
                  className={cn(
                    "flex items-center gap-3 p-4 cursor-pointer transition-colors",
                    isExpanded && "bg-blue-50",
                    !isExpanded && "hover:bg-slate-50"
                  )}
                  onClick={() => setExpandedDay(isExpanded ? null : day.dateStr)}
                >
                  {/* Date Badge */}
                  <div className={cn(
                    "h-12 w-12 rounded-xl flex flex-col items-center justify-center shrink-0 text-white shadow-sm",
                    day.archived 
                      ? "bg-gradient-to-br from-emerald-500 to-emerald-600" 
                      : "bg-gradient-to-br from-blue-500 to-blue-600"
                  )}>
                    <span className="text-lg font-bold leading-none">{format(day.date, 'd')}</span>
                    <span className="text-[10px] uppercase font-medium opacity-90 mt-0.5">{format(day.date, 'EEE')}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-900 text-sm md:text-base">
                                {format(day.date, 'MMMM d')}
                            </span>
                            
                            {/* Status Badges - Row */}
                            {isToday && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-blue-100 text-blue-700 rounded border border-blue-200 font-medium whitespace-nowrap">
                                Today
                                </span>
                            )}
                            {day.archived && (
                                <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded border border-emerald-200 font-medium whitespace-nowrap flex items-center gap-0.5">
                                ✓ Archived
                                </span>
                            )}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                            <span>{day.orders} orders</span>
                        </div>
                    </div>
                  </div>

                  {/* Revenue & Expand */}
                  <div className="text-right shrink-0">
                    <p className="font-bold text-slate-900">Rs. {day.revenue.toLocaleString()}</p>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-400 ml-auto mt-1" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400 ml-auto mt-1" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="bg-slate-50 p-4 border-t">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-500 text-xs uppercase mb-1">Revenue</p>
                        <p className="font-bold text-lg">Rs. {day.revenue.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs uppercase mb-1">Orders</p>
                        <p className="font-bold text-lg">{day.orders}</p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs uppercase mb-1">Avg Order</p>
                        <p className="font-medium">
                          Rs. {day.orders > 0 ? Math.round(day.revenue / day.orders).toLocaleString() : 0}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500 text-xs uppercase mb-1">Archive Status</p>
                        <p className={cn(
                          "font-medium",
                          day.archived ? "text-emerald-600" : "text-slate-400"
                        )}>
                          {day.archived ? '✓ Safely Archived' : 'Not Archived'}
                        </p>
                      </div>
                    </div>
                    
                    <Button 
                      onClick={() => router.push(`/analytics/${day.dateStr}`)}
                      variant="outline"
                      className="w-full mt-4"
                    >
                      View Day Details →
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
