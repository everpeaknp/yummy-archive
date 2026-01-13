"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent } from '@/components/ui/Card';
import { Loader2, Database, Archive, List, Search, FilterX, DollarSign, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/useDebounce';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver';
import { OrderRow, OrderRowData } from '@/components/History/OrderRow';

export default function HistoryPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();

  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'all' | 'live' | 'archived'>('all');
  const [orders, setOrders] = useState<OrderRowData[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  
  // Stats State
  const [stats, setStats] = useState({
    totalCount: 0,
    liveCount: 0,
    archivedCount: 0,
    totalSales: 0,
    liveSales: 0,
    archivedSales: 0
  });

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 600);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');

  // Pagination State
  const [liveOffset, setLiveOffset] = useState(0);
  const [archiveJobs, setArchiveJobs] = useState<any[]>([]); 
  const [archiveJobIndex, setArchiveJobIndex] = useState(0);   
  const LIVE_PAGE_SIZE = 50;

  // Infinite Scroll hook
  const { containerRef, isVisible } = useIntersectionObserver();

  // --- EFFECT: Auth Check ---
  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  // --- EFFECT: Reset on Change ---
  useEffect(() => {
    if (!restaurantId) return;
    
    // Reset Data
    setOrders([]);
    setLiveOffset(0);
    setArchiveJobIndex(0);
    setHasMore(true);
    setStats({ totalCount: 0, liveCount: 0, archivedCount: 0, totalSales: 0, liveSales: 0, archivedSales: 0 }); // Reset stats visuals

    setLoading(true);

    const initialFetch = async () => {
      try {
        if (activeTab === 'archived' || activeTab === 'all') {
          await loadArchiveJobList();
        }
        await loadMoreData(true);
      } catch (err) {
        console.error("Initial load failed", err);
      } finally {
        setLoading(false);
      }
    };

    initialFetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, activeTab, debouncedSearch, statusFilter, channelFilter]); 

  // --- EFFECT: Infinite Scroll ---
  useEffect(() => {
    if (isVisible && hasMore && !loading && !loadingMore) {
      loadMoreData(false);
    }
  }, [isVisible, hasMore, loading, loadingMore]);


  // --- HELPER: Robust Response Parser ---
  const parseOrdersResponse = (raw: any): any[] => {
      let data: any[] = [];
      if (Array.isArray(raw)) data = raw;
      else if (raw?.orders && Array.isArray(raw.orders)) data = raw.orders;
      else if (raw?.data && Array.isArray(raw.data)) data = raw.data;
      else if (raw?.data?.orders && Array.isArray(raw.data.orders)) data = raw.data.orders;
      else if (raw?.results && Array.isArray(raw.results)) data = raw.results;
      else if (raw?.data?.data && Array.isArray(raw.data.data)) data = raw.data.data;
      
      return data || [];
  };

  // --- LOGIC: Fetch Archive Job List ---
  const loadArchiveJobList = async () => {
    try {
      const res = await archiveApi.get(`/archive/jobs?limit=100&reverse=true`);
      if (res.data?.jobs) {
        const sorted = res.data.jobs.sort((a: any, b: any) => 
           new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        setArchiveJobs(sorted);
      }
    } catch (e) {
      setArchiveJobs([]); 
    }
  };


  // --- LOGIC: Load Data ---
  const loadMoreData = async (isReset = false) => {
    if (loadingMore && !isReset) return;
    setLoadingMore(true);

    try {
      let newOrders: OrderRowData[] = [];
      let shouldFetchLive = (activeTab === 'all' || activeTab === 'live');
      let shouldFetchArchived = (activeTab === 'all' || activeTab === 'archived');
      let liveFinished = false;

      // 1. Fetch Live (API)
      if (shouldFetchLive) {
        const currentOffset = isReset ? 0 : liveOffset;
        
        try {
          let url = `/orders/?restaurant_id=${restaurantId}&limit=${LIVE_PAGE_SIZE}&offset=${currentOffset}`;
          
          // Filters for API
          if (debouncedSearch && !isNaN(Number(debouncedSearch))) {
             url += `&order_id=${debouncedSearch}`;
          }
          if (statusFilter !== 'all') {
             url += `&status=${statusFilter}`;
          }
           // Note: API might not support 'channel' filter yet, so we filter locally if needed for now
           // For simplicity, assuming backend support or local filter fallback:
           
          const res = await mainApi.get(url);
          const fetchedLive = parseOrdersResponse(res.data);

          let mappedLive = fetchedLive.map(o => ({
            id: o.id || o.order_id,
            created_at: o.created_at,
            total: o.total || o.net_amount || o.grand_total || 0,
            status: o.status,
            source: 'live' as const,
            channel: o.channel || 'dine-in'
          }));

          // Local Filter Fallback (if backend ignores)
          if (channelFilter !== 'all') {
             mappedLive = mappedLive.filter((o: any) => o.channel === channelFilter);
          }

          newOrders = [...newOrders, ...mappedLive];
          
          if (mappedLive.length < LIVE_PAGE_SIZE) {
            liveFinished = true; 
          }
           
          if (!isReset) setLiveOffset(prev => prev + LIVE_PAGE_SIZE);

        } catch (e) {
          console.error("Live fetch error", e);
          liveFinished = true; 
        }
      }

      // 2. Fetch Archived (Batched)
      const needArchive = shouldFetchArchived && (liveFinished || activeTab === 'archived' || debouncedSearch);

      if (needArchive) {
         if (debouncedSearch) {
             // Search Optimization: Scan only recent jobs for ID? 
             // Or if ID is high, look at recent. If ID low, look old. 
             // Hard to optimize without backend index. 
             // For now, we search first 30 jobs.
         } 
         
         const jobBatchSize = 3; 
         const startIdx = isReset ? 0 : archiveJobIndex;
         const targetJobs = archiveJobs.slice(startIdx, startIdx + jobBatchSize);
         
         if (targetJobs.length > 0) {
            const archivePromises = targetJobs.map(async (job) => {
               try {
                 if (job.status !== 'EXPORTED') return [];
                 const oRes = await archiveApi.get(`/archive/${job.job_id}/query/orders`);
                 let list = parseOrdersResponse(oRes.data);
                 
                 // Apply filters manually since Archive is just file storage
                 if (debouncedSearch) {
                    list = list.filter((o: any) => (o.id || o.order_id).toString().includes(debouncedSearch));
                 }
                 if (statusFilter !== 'all') {
                    list = list.filter((o: any) => o.status === statusFilter);
                 }
                 // Channel filter logic if needed in future (archive might not have channel data yet)

                 return list.map((o: any) => ({
                    id: o.id || o.order_id,
                    created_at: o.created_at,
                    total: o.total || 0,
                    status: 'archived',
                    source: 'archived' as const,
                    job_id: job.job_id
                 }));
               } catch { return []; }
            });
            
            const results = await Promise.all(archivePromises);
            const flattened = results.flat();
            
            newOrders = [...newOrders, ...flattened];
            
            if (!isReset) setArchiveJobIndex(prev => prev + jobBatchSize);
         } else {
           // No more jobs
         }
      }

      // 3. Finalize & Stats Update
      let updatedList = [];
      if (isReset) {
        updatedList = newOrders;
      } else {
        updatedList = [...orders, ...newOrders];
      }
      setOrders(updatedList);
      
      // Update Stats (Client-side estimation based on loaded data for now, ideally backend stats endpoint)
      // Since we paginate, we can't know REAL total without extra API.
      // We will show "Loaded" counts.
      const liveItems = updatedList.filter(o => o.source === 'live');
      const archivedItems = updatedList.filter(o => o.source === 'archived');
      
      setStats({
        totalCount: updatedList.length,
        liveCount: liveItems.length,
        archivedCount: archivedItems.length,
        totalSales: updatedList.reduce((s, o) => s + o.total, 0),
        liveSales: liveItems.reduce((s, o) => s + o.total, 0),
        archivedSales: archivedItems.reduce((s, o) => s + o.total, 0),
      });


      if (newOrders.length === 0 && (liveFinished || activeTab === 'archived')) {
        setHasMore(false);
      }

    } catch (err) {
      console.error("Load more failed", err);
    } finally {
      setLoadingMore(false);
    }
  };


  const tabs = [
    { key: 'all', label: 'All Orders', icon: List },
    { key: 'live', label: 'Live Orders', icon: Database },
    { key: 'archived', label: 'Archived', icon: Archive }
  ] as const;

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header & Controls - Sticky */}
      <div className="flex flex-col gap-4 sticky top-0 bg-white z-20 pb-4 pt-1 shadow-sm px-1">
        
        {/* Title Row */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Order History</h1>
            <p className="text-slate-500 text-sm">Unified view of live and archived orders</p>
          </div>
          
          {/* Quick Stats Mini-Row (Optional simplified view) */}
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-900">Total Loaded: {stats.totalCount}</p>
            <p className="text-xs text-slate-500">Rs. {stats.totalSales.toLocaleString()}</p>
          </div>
        </div>

        {/* Stats Cards Row (Restored) */}
        {!searchQuery && (
          <div className="grid grid-cols-3 gap-4 mb-2">
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

        {/* Controls Row: Search + Filters */}
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

          {/* Channel Filter (Optional) */}
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
               {orders.map((order, idx) => (
                 <OrderRow key={`${order.source}-${order.id}-${idx}`} order={order} />
               ))}
               
               {/* Sentinel */}
               <tr ref={containerRef} className="h-4 w-full">
                 <td colSpan={5} /> 
               </tr>
             </tbody>
           </table>

           {/* Loading States */}
           {(loading || loadingMore) && (
             <div className="flex justify-center p-6 bg-white/50 absolute bottom-0 w-full z-20">
               <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
             </div>
           )}

           {!loading && !loadingMore && orders.length === 0 && (
             <div className="flex flex-col items-center justify-center h-64 text-slate-400">
               <List className="h-12 w-12 mb-2 opacity-20" />
               <p>No orders found</p>
             </div>
           )}
           
           {!hasMore && orders.length > 0 && (
             <div className="text-center p-4 text-xs text-slate-400">
               End of history
             </div>
           )}
        </CardContent>
      </Card>
    </div>
  );
}
