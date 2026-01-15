"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  Loader2, Database, Archive, Search, RefreshCw, ShoppingBag, 
  Filter, X, ChevronDown, ChevronUp, Clock, Calendar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { format } from 'date-fns';

interface OrderRowData {
  id: string | number;
  created_at: string;
  total: number;
  status: string;
  source: 'live' | 'archived' | 'error';
  channel?: string;
  job_id?: string;
  error_message?: string;
}

export default function HistoryPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'archived'>('all');
  const [liveOrders, setLiveOrders] = useState<OrderRowData[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<OrderRowData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [expandedOrderId, setExpandedOrderId] = useState<string | number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId) loadAllData();
  }, [restaurantId]);

  const parseOrdersResponse = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw?.orders && Array.isArray(raw.orders)) return raw.orders;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    if (raw?.data?.orders && Array.isArray(raw.data.orders)) return raw.data.orders;
    return [];
  };

  const loadAllData = async () => {
    const isRefresh = liveOrders.length > 0 || archivedOrders.length > 0;
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const [liveData, archiveData] = await Promise.all([
        fetchAllLiveOrders(),
        fetchAllArchivedOrders()
      ]);
      setLiveOrders(liveData);
      setArchivedOrders(archiveData);
    } catch (err) {
      console.error('[HistoryPage] Load failed:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const fetchAllLiveOrders = async (): Promise<OrderRowData[]> => {
    try {
      const res = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=1000`);
      return parseOrdersResponse(res.data).map(o => ({
        id: o.id || o.order_id,
        created_at: o.created_at,
        total: o.total || o.net_amount || o.grand_total || 0,
        status: o.status,
        source: 'live' as const,
        channel: o.channel || 'dine-in'
      }));
    } catch { return []; }
  };

  const fetchAllArchivedOrders = async (): Promise<OrderRowData[]> => {
    try {
      const today = new Date();
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      const startDay = threeMonthsAgo.toISOString().split('T')[0];
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const endDay = tomorrow.toISOString().split('T')[0];

      const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${startDay}&end_day=${endDay}`);
      const jobs = jobsRes.data?.jobs || [];
      const exportedJobs = jobs.filter((j: any) => ['EXPORTED', 'SYNCED'].includes(j.status));

      if (exportedJobs.length === 0) return [];

      const archivePromises = exportedJobs.map(async (job: any) => {
        try {
          const oRes = await archiveApi.get(`/archive/${job.job_id}/query/orders`);
          return parseOrdersResponse(oRes.data).map((o: any) => ({
            id: o.id || o.order_id,
            created_at: o.created_at,
            total: o.total || o.net_amount || o.grand_total || 0,
            status: o.status || 'archived',
            source: 'archived' as const,
            job_id: job.job_id,
            channel: o.channel || 'dine-in'
          }));
        } catch { return []; }
      });

      return (await Promise.all(archivePromises)).flat();
    } catch { return []; }
  };

  const displayOrders = useMemo(() => {
    let rawOrders: OrderRowData[] = [];
    
    switch (activeTab) {
      case 'live': rawOrders = liveOrders; break;
      case 'archived': rawOrders = archivedOrders; break;
      default:
        const combined = new Map<string, OrderRowData>();
        archivedOrders.forEach(o => combined.set(String(o.id), o));
        liveOrders.forEach(o => combined.set(String(o.id), o));
        rawOrders = Array.from(combined.values());
    }
    
    let orders = rawOrders;

    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      orders = orders.filter(o => o.id.toString().includes(searchLower));
    }

    if (statusFilter !== 'all') {
      orders = orders.filter(o => o.status === statusFilter);
    }

    if (dateFilter) {
      orders = orders.filter(o => {
        if (!o.created_at) return false;
        return o.created_at.startsWith(dateFilter) || 
               new Date(o.created_at).toLocaleDateString('en-CA') === dateFilter;
      });
    }

    return orders.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [activeTab, liveOrders, archivedOrders, debouncedSearch, statusFilter, dateFilter]);

  const stats = useMemo(() => {
    const validArchived = archivedOrders.filter(o => o.source !== 'error');
    return {
      totalCount: liveOrders.length + validArchived.length,
      liveCount: liveOrders.length,
      archivedCount: validArchived.length,
      totalSales: liveOrders.reduce((s, o) => s + o.total, 0) + 
                  validArchived.reduce((s, o) => s + o.total, 0)
    };
  }, [liveOrders, archivedOrders]);

  const formatTime = (dateStr: string) => {
    try { return format(new Date(dateStr), 'HH:mm'); } 
    catch { return '--:--'; }
  };

  const formatDate = (dateStr: string) => {
    try { return format(new Date(dateStr), 'MMM d'); } 
    catch { return dateStr; }
  };

  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'completed' || s === 'paid') return 'bg-emerald-100 text-emerald-700';
    if (s === 'pending' || s === 'ready') return 'bg-amber-100 text-amber-700';
    if (s === 'cancelled') return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-600';
  };

  return (
    <div className="space-y-4 pb-24 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">Order History</h1>
          <p className="text-sm text-slate-500">{stats.totalCount} total orders</p>
        </div>
        <Button 
          onClick={loadAllData} 
          disabled={isRefreshing || isLoading}
          variant="ghost"
          size="sm"
          className="h-10 w-10 rounded-full p-0"
        >
          <RefreshCw className={cn("h-5 w-5", (isRefreshing || isLoading) && "animate-spin")} />
        </Button>
      </div>

      {/* Hero Stats Card */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <div className="bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 p-5 text-white">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-xl md:text-2xl font-bold">{stats.totalCount}</p>
              <p className="text-[10px] md:text-xs opacity-80">Total Orders</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-xl md:text-2xl font-bold text-blue-300">{stats.liveCount}</p>
              <p className="text-[10px] md:text-xs opacity-80">Live</p>
            </div>
            <div className="bg-white/10 rounded-xl p-3">
              <p className="text-xl md:text-2xl font-bold text-purple-300">{stats.archivedCount}</p>
              <p className="text-[10px] md:text-xs opacity-80">Archived</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/20 text-center">
            <p className="text-lg md:text-xl font-bold">Rs. {stats.totalSales.toLocaleString()}</p>
            <p className="text-xs opacity-80">Total Revenue</p>
          </div>
        </div>
      </Card>

      {/* Search & Filter Bar */}
      <div className="space-y-3">
        {/* Search + Date + Filter */}
        <div className="flex gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[150px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Search ID..." 
              className="w-full h-10 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Date Picker */}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input 
              type="date"
              className="h-10 pl-9 pr-3 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none w-[130px]"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
            />
          </div>

          {/* Status Dropdown */}
          <select 
            className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Clear */}
          {(statusFilter !== 'all' || searchQuery || dateFilter) && (
            <button
              onClick={() => { setStatusFilter('all'); setSearchQuery(''); setDateFilter(''); }}
              className="h-10 px-3 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* Source Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl">
          {[
            { key: 'all', label: 'All', count: stats.totalCount, icon: ShoppingBag },
            { key: 'live', label: 'Live', count: stats.liveCount, icon: Database },
            { key: 'archived', label: 'Archive', count: stats.archivedCount, icon: Archive }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs md:text-sm font-medium transition-all",
                activeTab === tab.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              <tab.icon className="h-3.5 w-3.5 md:h-4 md:w-4 shrink-0" />
              <span className="truncate">{tab.label}</span>
              <span className={cn(
                "text-[10px] md:text-xs px-1 md:px-1.5 py-0.5 rounded-full shrink-0",
                activeTab === tab.key ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-10 w-10 animate-spin text-blue-500 mb-3" />
            <p className="text-slate-500">Loading orders...</p>
          </div>
        ) : displayOrders.length === 0 ? (
          <Card className="p-8 text-center">
            <ShoppingBag className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">No orders found</p>
            {(searchQuery || statusFilter !== 'all') && (
              <p className="text-sm text-slate-400 mt-1">Try adjusting your filters</p>
            )}
          </Card>
        ) : (
          displayOrders.slice(0, 100).map(order => {
            const isExpanded = expandedOrderId === order.id;
            const isLive = order.source === 'live';

            return (
              <Card 
                key={`${order.source}-${order.id}`} 
                className="overflow-hidden transition-all duration-200 hover:shadow-md"
              >
                <CardContent className="p-0">
                  {/* Order Row */}
                  <div 
                    className="flex items-center gap-2 md:gap-3 p-3 md:p-4 cursor-pointer"
                    onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                  >
                    {/* Order Badge */}
                    <div className={cn(
                      "h-10 w-10 md:h-11 md:w-11 rounded-xl flex items-center justify-center shrink-0 font-bold text-white text-xs md:text-sm",
                      isLive 
                        ? "bg-gradient-to-br from-blue-400 to-blue-600" 
                        : "bg-gradient-to-br from-purple-400 to-purple-600"
                    )}>
                      #{Number(order.id) % 1000}
                    </div>

                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm md:text-base">Order #{order.id}</span>
                        <span className={cn(
                          "px-2 py-0.5 text-[10px] font-medium rounded-full",
                          getStatusColor(order.status)
                        )}>
                          {order.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs md:text-sm text-slate-500 mt-0.5">
                        <Calendar className="h-3 w-3" />
                        <span>{formatDate(order.created_at)}</span>
                        <Clock className="h-3 w-3 ml-1" />
                        <span>{formatTime(order.created_at)}</span>
                        <span className={cn(
                          "ml-1 px-1.5 py-0.5 text-[10px] rounded",
                          isLive ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"
                        )}>
                          {isLive ? 'Live' : 'Archived'}
                        </span>
                      </div>
                    </div>

                    {/* Amount & Expand */}
                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-900 text-sm md:text-base">Rs. {order.total.toLocaleString()}</p>
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
                          <p className="text-slate-500 text-xs uppercase mb-1">Date & Time</p>
                          <p className="font-medium">{formatDate(order.created_at)} {formatTime(order.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Status</p>
                          <p className="font-medium capitalize">{order.status}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Channel</p>
                          <p className="font-medium capitalize">{order.channel || 'Dine-in'}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Source</p>
                          <p className={cn("font-medium", isLive ? "text-blue-600" : "text-purple-600")}>
                            {isLive ? '● Live Database' : '● Archive Storage'}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-500 text-xs uppercase mb-1">Total</p>
                          <p className="font-bold text-lg">Rs. {order.total.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}

        {/* Load More Indicator */}
        {displayOrders.length > 100 && (
          <div className="text-center py-4 text-sm text-slate-500">
            Showing first 100 of {displayOrders.length} orders
          </div>
        )}
      </div>
    </div>
  );
}
