"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useParams } from 'next/navigation';
import { mainApi, archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { format, parseISO } from 'date-fns';
import { 
  Loader2, Archive, ArrowLeft, CheckCircle, ChevronDown, ChevronUp,
  ShoppingBag, Clock, Receipt, User, CreditCard
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Reuse types or define new refined types
interface OrderItem {
  id?: number;
  name?: string;
  name_snapshot?: string;
  item_name?: string; // fallback
  menu_item_name?: string;
  product_name?: string;
  title?: string;
  dish_name?: string;
  quantity: number;
  qty?: number;
  price: number;
  unit_price?: number;
  modifiers?: string[] | any[]; // could be array of strings or objects
}

interface Order {
  id: number;
  order_id?: number;
  created_at: string;
  total: number;
  net_amount?: number;
  grand_total?: number;
  status: string;
  channel?: string;
  items_count?: number;
  isDeleted?: boolean;
  business_date?: string;
  _source?: 'live' | 'archive' | 'both';
  customer_name?: string;
  customer_phone?: string;
  payment_method?: string;
  items?: OrderItem[]; 
  order_items?: OrderItem[]; // some APIs return this key
}

export default function AnalyticsDayPage() {
  const { restaurantId, isAuthenticated } = useAuth();
  const router = useRouter();
  const params = useParams();
  const day = params.date as string; 

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<number | null>(null);
  const [loadingDetails, setLoadingDetails] = useState<number | null>(null);

  useEffect(() => {
    if (!isAuthenticated) router.push('/login');
  }, [isAuthenticated, router]);

  useEffect(() => {
    if (restaurantId && day) {
      setLoading(true);
      fetchDayData().finally(() => setLoading(false));
    }
  }, [restaurantId, day]);

  const fetchDayData = async () => {
    try {
        // 1. Fetch Live Orders List (Summary)
        const liveRes = await mainApi.get(`/orders/?restaurant_id=${restaurantId}&limit=500`);
        const liveOrders = parseOrdersResponse(liveRes.data).filter((o: any) => {
             const t = o.created_at || o.business_date;
             return t && (t.startsWith(day) || new Date(t).toLocaleDateString('en-CA') === day);
        });

        // 2. Fetch Archive Data (Orders + Items)
        const jobsRes = await archiveApi.get(`/archive/jobs?start_day=${day}&end_day=${day}`);
        const job = jobsRes.data?.jobs?.find((j: any) => j.archive_day === day && ['EXPORTED', 'SYNCED'].includes(j.status));
        
        let archivedOrders: any[] = [];
        let archivedItems: any[] = [];
        
        if (job) {
             try {
                // Fetch Orders Table
                const ordersQuery = await archiveApi.get(`/archive/${job.job_id}/query/orders?limit=1000`);
                if (ordersQuery.data?.data) {
                    archivedOrders = ordersQuery.data.data;
                }

                // Fetch Order Items Table
                const itemsQuery = await archiveApi.get(`/archive/${job.job_id}/query/order_items?limit=2000`);
                if (itemsQuery.data?.data) {
                    archivedItems = itemsQuery.data.data;
                }
             } catch (e) {
                 console.warn("Failed to fetch archive details:", e);
             }
        }

        // 3. Map Archived Items to Orders
        const ordersMap = new Map<string, Order>();
        
        // Process Archived Orders
        archivedOrders.forEach(o => {
             const idStr = String(o.id || o.order_id);
             // Attach items found in archive
             const myItems = archivedItems.filter(i => String(i.order_id) === idStr);
             
             ordersMap.set(idStr, { 
                 ...o, 
                 _source: 'archive', 
                 isDeleted: true,
                 items: myItems 
             });
        });

        // Process Live Orders (Merge or Add)
        liveOrders.forEach((o: any) => {
             const key = String(o.id || o.order_id);
             const existing = ordersMap.get(key);
             
             // If existing (archived), we keep archived items if live doesn't have them yet (live list usually doesn't)
             // But we mark as 'both' or 'live' source.
             ordersMap.set(key, { 
                 ...o, 
                 _source: existing ? 'both' : 'live', 
                 isDeleted: false,
                 // Retrieve items from existing if available (archive might have them, live list probably doesn't)
                 items: existing?.items || o.items || o.order_items || [] 
             });
        });

        const sorted = Array.from(ordersMap.values()).sort((a, b) => 
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        );

        setOrders(sorted);

    } catch (err) {
        console.error("Failed to fetch day data:", err);
    }
  };

  const fetchLiveOrderDetails = async (orderId: number) => {
      // Don't fetch if we already have items or it's purely archived (items should be loaded)
      const currentOrder = orders.find(o => (o.id || o.order_id) === orderId);
      if (!currentOrder || (currentOrder.items && currentOrder.items.length > 0)) return;
      
      // Only fetch for live orders
      if (currentOrder._source === 'archive') return;

      setLoadingDetails(orderId);
      try {
          const res = await mainApi.get(`/orders/${orderId}`);
          const fullOrder = res.data?.data || res.data; // adjust based on actual response structure
          
          if (fullOrder) {
              setOrders(prev => prev.map(o => {
                  if ((o.id || o.order_id) === orderId) {
                      return {
                          ...o,
                          items: fullOrder.items || fullOrder.order_items || [],
                          customer_name: fullOrder.customer_name || o.customer_name,
                          payment_method: fullOrder.payment_method || o.payment_method
                      };
                  }
                  return o;
              }));
          }
      } catch (err) {
          console.error(`Failed to fetch details for order ${orderId}`, err);
      } finally {
          setLoadingDetails(null);
      }
  };

  const handleExpand = (orderId: number) => {
      if (expandedOrderId === orderId) {
          setExpandedOrderId(null);
      } else {
          setExpandedOrderId(orderId);
          fetchLiveOrderDetails(orderId);
      }
  };

  const parseOrdersResponse = (raw: any): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw?.orders) return raw.orders;
    if (raw?.data?.orders) return raw.data.orders;
    if (raw?.data && Array.isArray(raw.data)) return raw.data;
    return [];
  };

  const formattedDate = format(parseISO(day), 'EEEE, MMMM d, yyyy');
  const totalRevenue = orders.reduce((sum, o) => sum + (o.grand_total || o.total || 0), 0);

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
         <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => router.back()} 
            className="h-10 w-10 rounded-full p-0"
        >
            <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Button>
        <div>
            <h1 className="text-xl font-bold text-slate-900">Day Details</h1>
            <p className="text-sm text-slate-500">{formattedDate}</p>
        </div>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white border-0">
             <CardContent className="p-4">
                 <p className="text-blue-100 text-xs uppercase font-medium mb-1">Revenue</p>
                 <p className="text-2xl font-bold">Rs. {totalRevenue.toLocaleString()}</p>
             </CardContent>
        </Card>
        <Card className="bg-white border-slate-200">
             <CardContent className="p-4">
                 <p className="text-slate-500 text-xs uppercase font-medium mb-1">Total Orders</p>
                 <p className="text-2xl font-bold text-slate-900">{orders.length}</p>
             </CardContent>
        </Card>
      </div>

      {/* Orders List */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 mb-3 uppercase tracking-wider px-1">Order History</h2>
        
        {loading ? (
             <div className="flex flex-col items-center py-10">
                 <Loader2 className="h-8 w-8 text-blue-500 animate-spin mb-2" />
                 <p className="text-sm text-slate-400">Loading day data...</p>
             </div>
        ) : orders.length === 0 ? (
             <div className="text-center py-10 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                 <ShoppingBag className="h-10 w-10 text-slate-300 mx-auto mb-2" />
                 <p className="text-slate-400">No orders recorded for this day.</p>
             </div>
        ) : (
             <div className="space-y-3">
                 {orders.map(order => {
                     const isExpanded = expandedOrderId === order.id;
                     const displayItems = order.items || order.order_items || [];

                     return (
                         <div key={order.id} className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
                             <div 
                                className="flex items-center p-4 gap-4 cursor-pointer"
                                onClick={() => handleExpand(order.id)}
                             >
                                 <div className="flex flex-col items-center justify-center h-12 w-12 bg-slate-50 rounded-lg border border-slate-100 shrink-0">
                                     <span className="text-xs text-slate-400 font-medium">#{order.id % 100}</span>
                                     <Clock className="h-3 w-3 text-slate-400 mt-0.5" />
                                 </div>
                                 
                                 <div className="flex-1 min-w-0">
                                     <div className="flex items-center justify-between mb-1">
                                         <p className="font-bold text-slate-900 truncate">
                                             Order #{order.id}
                                         </p>
                                         <p className="font-bold text-slate-900">
                                             Rs. {(order.grand_total || order.total || 0).toLocaleString()}
                                         </p>
                                     </div>
                                     <div className="flex items-center gap-2 text-xs text-slate-500">
                                         <span className={cn(
                                             "capitalize px-1.5 py-0.5 rounded font-medium",
                                             order.status === 'completed' ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                                         )}>
                                             {order.status}
                                         </span>
                                         <span>•</span>
                                         <span>{format(new Date(order.created_at), 'h:mm a')}</span>
                                         <span>•</span>
                                         <span className="capitalize">{order.channel || 'Dine-in'}</span>
                                     </div>
                                 </div>

                                 <div className="text-slate-400">
                                     {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                 </div>
                             </div>

                             {/* Expanded Details */}
                             {isExpanded && (
                                 <div className="border-t border-slate-100 bg-slate-50/50 p-4 animate-in slide-in-from-top-2 duration-200">
                                     <p className="text-sm font-medium text-slate-900 mb-2 flex items-center justify-between">
                                         <span className="flex items-center gap-2"><Receipt className="h-4 w-4 text-slate-500" /> Order Details</span>
                                         {loadingDetails === order.id && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                                     </p>
                                     
                                     <div className="bg-white rounded-lg border border-slate-100 p-3 mb-3">
                                         {displayItems.length > 0 ? (
                                             <div className="space-y-3">
                                                 {displayItems.map((item, idx) => (
                                                     <div key={idx} className="flex justify-between text-sm">
                                                         <div className="flex gap-2">
                                                             <span className="font-semibold text-slate-700">{item.quantity || item.qty || 1}x</span>
                                                             <div className="flex flex-col">
                                                                 <span className="text-slate-900">
                                                                     {item.name_snapshot || item.name || item.item_name || item.menu_item_name || item.product_name || item.title || (item as any).dish_name || 'Unknown Item'}
                                                                 </span>
                                                                 {item.modifiers && Array.isArray(item.modifiers) && item.modifiers.length > 0 && (
                                                                     <span className="text-xs text-slate-400">
                                                                         {item.modifiers.join(', ')}
                                                                     </span>
                                                                 )}
                                                             </div>
                                                         </div>
                                                             <span className="text-slate-600">Rs. {(item.price || item.unit_price || 0).toLocaleString()}</span>
                                                     </div>
                                                 ))}
                                             </div>
                                         ) : (
                                             <div className="text-slate-400 text-xs italic text-center py-2">
                                                 {loadingDetails === order.id ? "Loading items..." : "No items found"}
                                             </div>
                                         )}
                                         
                                         <div className="pt-2 mt-3 border-t border-dashed border-slate-100 flex justify-between font-medium text-slate-900">
                                             <span>Total</span>
                                             <span>Rs. {(order.grand_total || order.total || 0).toLocaleString()}</span>
                                         </div>
                                     </div>

                                     <div className="grid grid-cols-2 gap-3 text-xs">
                                         <div className="bg-white p-3 rounded-lg border border-slate-100">
                                             <p className="text-slate-400 mb-1 flex items-center gap-1"><User className="h-3 w-3" /> Customer</p>
                                             <p className="font-medium text-slate-900">{order.customer_name || 'Walk-in Customer'}</p>
                                         </div>
                                         <div className="bg-white p-3 rounded-lg border border-slate-100">
                                             <p className="text-slate-400 mb-1 flex items-center gap-1"><CreditCard className="h-3 w-3" /> Payment</p>
                                             <p className="font-medium text-slate-900 capitalize">{order.payment_method || 'Cash'}</p>
                                         </div>
                                     </div>

                                     {order._source === 'archive' && (
                                          <div className="mt-3 flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100">
                                              <CheckCircle className="h-3 w-3" />
                                              This order is safely archived.
                                          </div>
                                     )}
                                 </div>
                             )}
                         </div>
                     );
                 })}
             </div>
        )}
      </div>
    </div>
  );
}
