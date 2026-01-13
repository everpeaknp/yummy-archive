"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths } from 'date-fns';
import { Loader2, Archive, Eye, ChevronLeft, ChevronRight, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
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
    }

    try {
      // Use /sales/?filter=monthly endpoint - returns total_sales, total_orders, periods[]
      const resSales = await mainApi.get(`/sales/?restaurant_id=${restaurantId}&filter=daily`);
      console.log("Sales response:", resSales.data);
      
      const salesData = resSales.data?.data || resSales.data;
      let mappedStats: any[] = [];
      
      // The response has: { total_sales, total_orders, periods: [{ period, sales, orders }] }
      if (salesData?.periods && Array.isArray(salesData.periods)) {
        // Monthly periods (like "2026-01") - we'll use this for summary but need daily for list
        mappedStats = salesData.periods.map((item: any) => ({
          date: item.period || item.date,
          order_count: item.orders || item.order_count || 0,
          total_amount: item.sales || item.total_amount || 0
        }));
      }
      
      // Also store totals for the summary cards directly from API
      if (salesData?.total_orders !== undefined) {
        setTotalOrders(salesData.total_orders || 0);
        setTotalSales(salesData.total_sales || salesData.total_amount || 0);
      }
      
      console.log("Mapped stats:", mappedStats);
      setDailyStats(mappedStats);
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || err.message || "Network error";
      console.warn("Stats API unavailable:", errorMsg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [restaurantId, currentMonth]);

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
    return jobs.find(j => j.archive_day === dateStr);
  };

  const getStatusBadge = (job: ArchiveJob) => {
    const statusConfig = {
      EXPORTED: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
      FAILED: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
      EXPORTING: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 }
    };
    const config = statusConfig[job.status as keyof typeof statusConfig] || statusConfig.PENDING;
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
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Archived</p>
            <p className="text-xl md:text-2xl font-bold text-green-600">
              {jobs.filter(j => j.status === 'EXPORTED').length}
            </p>
          </CardContent>
        </Card>
        <Card className="hover:shadow-lg transition-shadow">
          <CardContent className="p-4 md:p-6">
            <p className="text-xs md:text-sm font-medium text-slate-500 mb-1">Pending/Failed</p>
            <p className="text-xl md:text-2xl font-bold text-amber-600">
              {jobs.filter(j => j.status !== 'EXPORTED').length}
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
              const isCreating = creatingJobForDate === dateStr;

              return (
                <div 
                  key={dateStr} 
                  className={cn(
                    "flex flex-col sm:flex-row sm:items-center justify-between p-3 md:p-4 gap-3 hover:bg-slate-50/50 transition-colors",
                    isFuture && "opacity-50"
                  )}
                >
                  {/* Date & Stats */}
                  <div className="flex items-center gap-3 md:gap-4">
                    <div className="h-10 w-10 md:h-12 md:w-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white flex items-center justify-center font-bold text-sm md:text-base shadow-sm">
                      {format(day, 'd')}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900 text-sm md:text-base">{format(day, 'EEEE, MMM d')}</p>
                      <p className="text-xs md:text-sm text-slate-500">
                        {stat ? (
                          <span className="flex items-center gap-2">
                            <span className="font-medium text-slate-700">{stat.order_count}</span> orders
                            <span className="text-slate-300">•</span>
                            Rs. {stat.total_amount?.toLocaleString()}
                          </span>
                        ) : (
                          <span className="italic">No data</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-13 sm:ml-0">
                    {job ? (
                      <>
                        {getStatusBadge(job)}
                        {/* Show View button for ALL jobs - so users can delete failed ones */}
                        <Button 
                          size="sm" 
                          variant="outline"
                          onClick={() => router.push(`/archive/${job.job_id}`)}
                          className="h-8 text-xs md:text-sm"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      </>
                    ) : !isFuture ? (
                      <Button 
                        size="sm"
                        onClick={() => router.push(`/orders/${dateStr}`)}
                        className="h-8 text-xs md:text-sm bg-blue-600 hover:bg-blue-700"
                      >
                        <Archive className="h-3.5 w-3.5 mr-1" />
                        Select Orders
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400 italic px-2">
                        {isFuture ? 'Future' : 'Not archived'}
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
