"use client";

import React, { useState } from 'react';
import { Order } from '@/types';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox'; // Need to create this
import { format } from 'date-fns';

interface OrderListProps {
  orders: Order[];
  selectedOrderIds: number[];
  onSelectionChange: (ids: number[]) => void;
  isLoading: boolean;
}

export function OrderList({ orders, selectedOrderIds, onSelectionChange, isLoading }: OrderListProps) {
  const handleSelectAll = () => {
    if (selectedOrderIds.length === orders.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(orders.map(o => o.id));
    }
  };

  const handleSelectOne = (id: number) => {
    if (selectedOrderIds.includes(id)) {
      onSelectionChange(selectedOrderIds.filter(oid => oid !== id));
    } else {
      onSelectionChange([...selectedOrderIds, id]);
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center">Loading orders...</div>;
  }

  if (orders.length === 0) {
    return <div className="p-8 text-center text-black">No orders found for this date.</div>;
  }

  return (
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full text-sm text-left text-black">
        <thead className="text-xs text-black uppercase bg-gray-50">
          <tr>
            <th scope="col" className="p-4">
              <input 
                type="checkbox" 
                checked={selectedOrderIds.length > 0 && selectedOrderIds.length === orders.length}
                onChange={handleSelectAll}
                className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
              />
            </th>
            <th scope="col" className="px-6 py-3">Order ID</th>
            <th scope="col" className="px-6 py-3">Created At</th>
            <th scope="col" className="px-6 py-3">Status</th>
            <th scope="col" className="px-6 py-3">Total</th>
            <th scope="col" className="px-6 py-3">Items</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="bg-white border-b hover:bg-gray-50">
              <td className="w-4 p-4">
                <input 
                  type="checkbox"
                  checked={selectedOrderIds.includes(order.id)}
                  onChange={() => handleSelectOne(order.id)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                />
              </td>
              <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">#{order.id}</td>
              <td className="px-6 py-4">{format(new Date(order.created_at), 'MMM d, HH:mm')}</td>
              <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs ${order.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {order.status}
                  </span>
              </td>
              <td className="px-6 py-4">${order.total}</td>
              <td className="px-6 py-4">{order.order_items?.length || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
