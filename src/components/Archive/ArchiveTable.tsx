"use client";

import React, { useState, useEffect } from 'react';
import { archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Loader2 } from 'lucide-react';

interface ArchiveTableProps {
  jobId: string;
  tableName: string;
}

export function ArchiveTable({ jobId, tableName }: ArchiveTableProps) {
  const [data, setData] = useState<any[]>([]);
  const [meta, setMeta] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const offset = page * LIMIT;
        const res = await archiveApi.get(`/archive/${jobId}/query/${tableName}?limit=${LIMIT}&offset=${offset}&sort_desc=true`);
        setData(res.data.data || []);
        setMeta(res.data.meta || {});
      } catch (err: any) {
        console.error("Failed to fetch archive data", err);
        const status = err.response?.status;
        if (status === 500) {
            alert("500 Error: Archive file missing (likely due to free hosting restart). Delete and re-archive.");
        } else if (status === 404) {
             alert("Data not found. Please re-archive.");
        } else {
             alert(`Error: ${err.message}`);
        }
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [jobId, tableName, page]);

  const handleNext = () => setPage(p => p + 1);
  const handlePrev = () => setPage(p => Math.max(0, p - 1));

  if (loading && data.length === 0) return <div className="p-4"><Loader2 className="animate-spin" /></div>;

  if (data.length === 0) return <div className="p-4 text-black">No data found in {tableName}</div>;

  const headers = Object.keys(data[0]);

  return (
    <div className="space-y-4">
       <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm text-left text-black">
          <thead className="bg-gray-50 text-xs text-black uppercase">
             <tr>
               {headers.map(h => <th key={h} className="px-6 py-3">{h}</th>)}
             </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <tr key={idx} className="bg-white border-b hover:bg-gray-50">
                {headers.map(h => (
                  <td key={h} className="px-6 py-4 whitespace-nowrap overflow-hidden max-w-xs text-ellipsis">
                    {typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
       </div>
       <div className="flex justify-between items-center">
         <Button variant="outline" onClick={handlePrev} disabled={page === 0}>Previous</Button>
         <span className="text-sm text-black">Page {page + 1}</span>
         <Button variant="outline" onClick={handleNext} disabled={data.length < LIMIT}>Next</Button>
       </div>
    </div>
  );
}
