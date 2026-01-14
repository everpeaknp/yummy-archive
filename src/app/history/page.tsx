"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { Loader2, Database, Archive, List, Search, FilterX, RefreshCw, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { OrderRow, OrderRowData } from '@/components/History/OrderRow';
import MultiRangeSlider from '@/components/ui/MultiRangeSlider';

export default function HistoryPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();

  // --- SIMPLIFIED STATE ---
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'archived'>('all');
  const [liveOrders, setLiveOrders] = useState<OrderRowData[]>([]);
  const [archivedOrders, setArchivedOrders] = useState<OrderRowData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  
  // Amount Filter State
  const [priceRange, setPriceRange] = useState({ min: 0, max: 10000 });
  const [globalMaxAmount, setGlobalMaxAmount] = useState(10000);

  // --- AUTH CHECK ---
  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  // --- INITIAL DATA LOAD ---
  useEffect(() => {
    if (restaurantId) {
      loadAllData();
    }
  }, [restaurantId]);

  // --- HELPER: Parse Orders Response ---
  const parseOrdersResponse = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw?.orders && Array.isArray(raw.orders)) return raw.orders;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    if (raw?.data?.orders && Array.isArray(raw.data.orders)) return raw.data.orders;
    if (raw?.results && Array.isArray(raw.results)) return raw.results;
    if (raw?.data?.data && Array.isArray(raw.data.data)) return raw.data.data;
    return [];
  };

  // --- MAIN LOAD FUNCTION ---
  const loadAllData = async () => {
    const isRefresh = liveOrders.length > 0 || archivedOrders.length > 0;
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      console.log('[HistoryPage] Starting data load...');
      
      // Fetch live and archive in parallel
      const [liveData, archiveData] = await Promise.all([
        fetchAllLiveOrders(),
        fetchAllArchivedOrders()
      ]);

      setLiveOrders(liveData);
      setArchivedOrders(archiveData);
      setLiveOrders(liveData);
      setArchivedOrders(archiveData);
      setLastRefreshed(new Date());

      // Calculate Global Max for Slider
      const allOrders = [...liveData, ...archiveData];
      const maxTotal = allOrders.reduce((max, o) => Math.max(max, o.total), 1000);
      setGlobalMaxAmount(Math.ceil(maxTotal / 100) * 100); // Round up to nearest 100
      setPriceRange({ min: 0, max: Math.ceil(maxTotal / 100) * 100 });
      
      console.log('[HistoryPage] Load complete. Live:', liveData.length, 'Archived:', archiveData.length);
    } catch (err) {
      console.error('[HistoryPage] Load failed:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  // --- FETCH: All Live Orders ---
  const fetchAllLiveOrders = async (): Promise<OrderRowData[]> => {
    try {
      // Fetch with large limit to get all orders
      const url = `/orders/?restaurant_id=${restaurantId}&limit=1000`;
      const res = await mainApi.get(url);
      
      const rawOrders = parseOrdersResponse(res.data);
      console.log('[HistoryPage] Fetched', rawOrders.length, 'live orders');

      return rawOrders.map(o => ({
        id: o.id || o.order_id,
        created_at: o.created_at,
        total: o.total || o.net_amount || o.grand_total || 0,
        status: o.status,
        source: 'live' as const,
        channel: o.channel || 'dine-in'
      }));
    } catch (err) {
      console.error('[HistoryPage] Live fetch failed:', err);
      return [];
    }
  };

  // --- FETCH: All Archived Orders ---
  const fetchAllArchivedOrders = async (): Promise<OrderRowData[]> => {
    try {
      // 1. Get archive jobs from last 3 months
      const today = new Date();
      const threeMonthsAgo = new Date(today);
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      
      const startDay = threeMonthsAgo.toISOString().split('T')[0];
      const endDay = today.toISOString().split('T')[0];
      
      console.log('[HistoryPage] Fetching archive jobs from', startDay, 'to', endDay);
      const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${startDay}&end_day=${endDay}`);
      
      const jobs = jobsRes.data?.jobs || [];
      const exportedJobs = jobs.filter((j: any) => j.status === 'EXPORTED');
      
      console.log('[HistoryPage] Found', exportedJobs.length, 'exported jobs');

      if (exportedJobs.length === 0) return [];

      // 2. Fetch orders from each job in parallel
      const archivePromises = exportedJobs.map(async (job: any) => {
        try {
          const oRes = await archiveApi.get(`/archive/${job.job_id}/query/orders`);
          const orders = parseOrdersResponse(oRes.data);
          
          return orders.map((o: any) => ({
            id: o.id || o.order_id,
            created_at: o.created_at,
            total: o.total || o.net_amount || o.grand_total || 0,
            status: o.status || 'archived',
            source: 'archived' as const,
            job_id: job.job_id,
            channel: o.channel || 'dine-in'
          }));
        } catch (e: any) {
          console.warn('[HistoryPage] Failed to fetch job', job.job_id, ':', e.message);
          
          // Return error row for this job
          if (e.response?.status === 500) {
            return [{
              id: `err-${job.job_id}`,
              created_at: job.created_at || job.start_date,
              total: 0,
              status: 'error',
              source: 'error' as const,
              job_id: job.job_id,
              error_message: 'Archive Files Missing (500)'
            }];
          }
          return [];
        }
      });

      const results = await Promise.all(archivePromises);
      const allArchived = results.flat();
      
      console.log('[HistoryPage] Fetched', allArchived.length, 'archived orders');
      return allArchived;
    } catch (err) {
      console.error('[HistoryPage] Archive fetch failed:', err);
      return [];
    }
  };

  // --- COMPUTED: Filtered & Displayed Orders ---
  const displayOrders = useMemo(() => {
    // 1. Select source based on tab
    let orders: OrderRowData[] = [];
    
    switch (activeTab) {
      case 'live':
        orders = liveOrders;
        break;
      case 'archived':
        orders = archivedOrders;
        break;
      case 'all':
      default:
        orders = [...liveOrders, ...archivedOrders];
        break;
    }

    // 2. Apply search filter (order ID)
    if (debouncedSearch) {
      const searchLower = debouncedSearch.toLowerCase();
      orders = orders.filter(o => 
        o.id.toString().includes(searchLower) ||
        (o.source === 'error' ? false : o.status.toLowerCase().includes(searchLower))
      );
    }

    // 3. Apply status filter
    if (statusFilter !== 'all') {
      orders = orders.filter(o => o.source !== 'error' && o.status === statusFilter);
    }

    // 4. Apply channel filter
    if (channelFilter !== 'all') {
      orders = orders.filter(o => o.source !== 'error' && o.channel === channelFilter);
    }

    // 5. Apply Date filter
    if (dateFilter) {
      orders = orders.filter(o => o.created_at.startsWith(dateFilter));
    }

    // 6. Apply Amount filter (Slider)
    orders = orders.filter(o => o.total >= priceRange.min && o.total <= priceRange.max);

    // 5. Sort by date (newest first)
    return orders.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [activeTab, liveOrders, archivedOrders, debouncedSearch, statusFilter, channelFilter, dateFilter, priceRange]);

  // --- COMPUTED: Stats (from FULL dataset, ignoring filters) ---
  const stats = useMemo(() => {
    const validArchived = archivedOrders.filter(o => o.source !== 'error');
    
    const liveSales = liveOrders.reduce((s, o) => s + o.total, 0);
    const archivedSales = validArchived.reduce((s, o) => s + o.total, 0);
    
    return {
      totalCount: liveOrders.length + validArchived.length,
      liveCount: liveOrders.length,
      archivedCount: validArchived.length,
      totalSales: liveSales + archivedSales,
      liveSales,
      archivedSales
    };
  }, [liveOrders, archivedOrders]);

  const tabs = [
    { key: 'all', label: 'All Orders', icon: List },
    { key: 'live', label: 'Live Orders', icon: Database },
    { key: 'archived', label: 'Archived', icon: Archive }
  ] as const;

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sticky top-0 bg-white z-20 pb-4 pt-1 shadow-sm px-1">
        
        {/* Title Row */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Order History</h1>
            <p className="text-slate-500 text-sm">
              {lastRefreshed 
                ? `Last updated: ${lastRefreshed.toLocaleTimeString()}`
                : 'Loading...'
              }
            </p>
          </div>
          
          <Button 
            onClick={loadAllData} 
            disabled={isRefreshing || isLoading}
            variant="outline"
            size="sm"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", (isRefreshing || isLoading) && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        {!isLoading && (
          <div className="grid grid-cols-3 gap-4">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <ShoppingBag className="w-4 h-4 text-slate-600" />
                  <span className="text-xs font-semibold uppercase text-slate-500">Total</span>
                </div>
                <p className="text-xl font-bold text-slate-900">{stats.totalCount}</p>
                <p className="text-xs text-slate-500 mt-1">Rs. {stats.totalSales.toLocaleString()}</p>
              </CardContent>
            </Card>
            
            <Card className="bg-blue-50 border-blue-100">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Database className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-semibold uppercase text-blue-500">Live</span>
                </div>
                <p className="text-xl font-bold text-blue-700">{stats.liveCount}</p>
                <p className="text-xs text-blue-600 mt-1">Rs. {stats.liveSales.toLocaleString()}</p>
              </CardContent>
            </Card>

            <Card className="bg-purple-50 border-purple-100">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Archive className="w-4 h-4 text-purple-600" />
                  <span className="text-xs font-semibold uppercase text-purple-500">Archived</span>
                </div>
                <p className="text-xl font-bold text-purple-700">{stats.archivedCount}</p>
                <p className="text-xs text-purple-600 mt-1">Rs. {stats.archivedSales.toLocaleString()}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Controls Row: Search + Filters + Tabs */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Search Order ID..." 
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <FilterX className="h-4 w-4" />
              </button>
            )}
          </div>
          
          {/* Status Filter */}
          <select 
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-black focus:ring-2 focus:ring-blue-500"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Channel Filter */}
          <select 
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-black focus:ring-2 focus:ring-blue-500"
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="all">All Channels</option>
            <option value="dine-in">Dine-in</option>
            <option value="takeaway">Takeaway</option>
            <option value="delivery">Delivery</option>
          </select>

          {/* Date Filter */}
          <Input 
            type="date"
            className="w-auto h-10"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
          />

          {/* Amount Slider */}
          <div className="flex flex-col justify-center w-full sm:w-64 px-2">
             <div className="flex justify-between text-xs text-slate-500 mb-2">
               <span className="font-medium">Amount</span>
               <span>Rs. {priceRange.min} - {priceRange.max}</span>
             </div>
             <MultiRangeSlider
               min={0}
               max={globalMaxAmount}
               minVal={priceRange.min}
               maxVal={priceRange.max}
               onChange={({ min, max }) => setPriceRange({ min, max })}
             />
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-lg">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                  activeTab === tab.key
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                )}
              >
                <tab.icon className="h-4 w-4" />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table Content */}
      <Card className="flex-1 overflow-hidden flex flex-col min-h-[500px]">
        <CardContent className="p-0 flex-1 overflow-y-auto relative">
          {/* Loading State */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-2" />
              <p className="text-slate-500">Loading order history...</p>
            </div>
          )}

          {/* Table */}
          {!isLoading && (
            <>
              {/* Table Header */}
              <div className="grid grid-cols-1 divide-y sticky top-0 bg-slate-50 z-10 border-b font-medium text-xs text-slate-500 uppercase shadow-sm">
                <div className="flex">
                  <div className="px-4 py-3 flex-1 max-w-[100px]">ID</div>
                  <div className="px-4 py-3 flex-1">Date</div>
                  <div className="px-4 py-3 flex-1">Total</div>
                  <div className="px-4 py-3 flex-1">Status</div>
                  <div className="px-4 py-3 flex-1">Source</div>
                </div>
              </div>

              {/* Table Body */}
              <table className="w-full">
                <tbody className="divide-y divide-slate-100">
                  {displayOrders.map((order, idx) => (
                    <OrderRow key={`${order.source}-${order.id}-${idx}`} order={order} />
                  ))}
                </tbody>
              </table>

              {/* Empty State */}
              {displayOrders.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                  <List className="h-12 w-12 mb-2 opacity-20" />
                  <p>No orders found</p>
                  <p>No orders found</p>
                  {(searchQuery || statusFilter !== 'all' || channelFilter !== 'all' || dateFilter || priceRange.min > 0 || priceRange.max < globalMaxAmount) && (
                    <p className="text-xs mt-1">Try adjusting your filters</p>
                  )}
                </div>
              )}

              {/* Result Count */}
              {displayOrders.length > 0 && (
                <div className="text-center p-4 text-xs text-slate-400 border-t">
                  Showing {displayOrders.length} of {stats.totalCount} orders
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
