"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { archiveApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ArchiveJob } from '@/types';
import { ArrowLeft, Trash2, CheckCircle, XCircle, Clock, Loader2, Database, FileText, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ManifestData {
  row_counts?: Record<string, number>;
  restaurant_timezone?: string;
  total_checksum?: string;
  datasets?: Record<string, any>;
  updated_at?: string;
  criteria?: {
    order_ids?: number[];
    delete_order_ids?: number[] | null;  // Orders marked for deletion
    start_date?: string;
    end_date?: string;
  };
}

export default function ArchiveDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<ArchiveJob | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTable, setActiveTable] = useState<string>('orders');
  const [tableData, setTableData] = useState<any[]>([]);
  const [tableMeta, setTableMeta] = useState<any>({});
  const [tableLoading, setTableLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [missingFile, setMissingFile] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const HIDDEN_COLUMNS = new Set(['group_id', 'customer_name', 'customer_phone']);

  // Initialize selected IDs from manifest
  useEffect(() => {
    if (manifest?.criteria?.delete_order_ids) {
      setSelectedIds(new Set(manifest.criteria.delete_order_ids));
    }
  }, [manifest]);

  const LIMIT = 50;

  useEffect(() => {
    if (jobId && jobId !== 'undefined') {
      console.log('[ArchiveDetails] Loading job from URL param:', jobId);
      fetchJobDetails();
    }
  }, [jobId]);

  useEffect(() => {
    if (job?.status === 'EXPORTED') {
      fetchTableData();
    }
  }, [job, activeTable, page]);

  // Poll for status updates if exporting
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (job?.status === 'EXPORTING' || job?.status === 'PENDING') {
      interval = setInterval(() => {
        fetchJobDetails(true); // silent update
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [job?.status]);

  const fetchJobDetails = async (isPolling = false) => {
    if (!isPolling) setLoading(true);
    try {
      // 1. Fetch Job Status
      const jobRes = await archiveApi.get(`/jobs/archive/${jobId}`);
      const jobData = jobRes.data;
      setJob(jobData);
      
      console.log(`[ArchiveDetails] Job status: ${jobData.status}`);

      // 2. If EXPORTED, fetch Manifest
      if (jobData.status === 'EXPORTED') {
          try {
             const manifestRes = await archiveApi.get(`/archive/${jobId}/manifest`);
             setManifest(manifestRes.data);
          } catch(e) {
             console.warn("Manifest fetch failed (might be retrying)", e);
          }
      }
    } catch (err: any) {
      console.error("Failed to fetch job details", err);
      
      const status = err.response?.status;
      if (status === 404) {
        setNotFound(true);
      } else if (status === 410 || status === 500) {
        setMissingFile(true); 
      }
    } finally {
      if (!isPolling) setLoading(false);
    }
  };

  const fetchTableData = async () => {
    setTableLoading(true);
    try {
      const offset = page * LIMIT;
      const res = await archiveApi.get(`/archive/${jobId}/query/${activeTable}?limit=${LIMIT}&offset=${offset}&sort_desc=true`);
      console.log(`[ArchiveDetails] Table ${activeTable} data (first 3):`, res.data.data?.slice(0, 3));
      setTableData(res.data.data || []);
      setTableMeta(res.data.meta || {});
    } catch (err: any) {
      if (err.response?.status === 410 || err.response?.status === 500) {
        setMissingFile(true);
        console.warn("Archive files missing (410/500) - Handled:", err.message);
      } else {
        console.error("Failed to fetch table data", err);
      }
      setTableData([]); // clear data
    } finally {
      setTableLoading(false);
    }
  };

  const handleDelete = async () => {
    // Priority: User Selection (Checkboxes) -> Manifest -> All
    const currentSelection = Array.from(selectedIds);
    const hasSelection = currentSelection.length > 0;
    
    // If user changed selection, we use that. If not, we fall back to manifest 
    // BUT since we initialize selectedIds from manifest, selection IS the source of truth now.
    
    const confirmMsg = hasSelection
      ? `⚠️ PERMANENT ACTION!\n\nThis will DELETE ${currentSelection.length} selected order(s) from the main database.\n\nAre you absolutely sure?`
      : `⚠️ PERMANENT ACTION!\n\nThis will DELETE ALL archived orders from the main database.\n\nAre you absolutely sure?`;
    
    if (!confirm(confirmMsg)) return;
    if (!confirm("Final confirmation: Click OK to proceed with PERMANENT deletion.")) return;

    setDeleting(true);
    try {
      const payload: any = {
        archive_job_id: jobId,
        restaurant_id: job?.restaurant_id
      };
      
      // If we have specific selection, send it to override backend
      if (hasSelection) {
        payload.order_ids = currentSelection;
      }
      
      await archiveApi.post('/jobs/delete', payload);
      
      const successMsg = hasSelection
        ? `Deletion complete. ${currentSelection.length} order(s) removed from the main database.`
        : "Deletion complete. All archived orders removed from the main database.";
      alert(successMsg);
      router.push('/');
    } catch (err: any) {
      console.error("Delete failed", err);
      if (err.response?.status === 500 || err.response?.status === 410) {
         if (confirm("Source deletion failed (files missing on server). \n\nDo you want to force delete just THIS archive record to clean up?")) {
            await handleDeleteJob();
            return;
         }
      } else {
        const errDetail = err.response?.data?.detail || err.message;
        alert(`Failed to delete source data: ${errDetail}`);
      }
    } finally {
      setDeleting(false);
    }
  };

  // Delete the archive JOB itself (not source data) - for failed/stale jobs
  const handleDeleteJob = async () => {
    if (!confirm("Delete this archive job?\n\nThis will NOT delete any orders from the main database.\nIt just removes this job record so you can re-archive.")) return;

    setDeleting(true);
    try {
      await archiveApi.delete(`/jobs/archive/${jobId}`);
      alert("Archive job deleted. You can now re-archive this day.");
      router.push('/');
    } catch (err) {
      console.error("Failed to delete job", err);
      alert("Failed to delete job. Please try again or contact support.");
    } finally {
      setDeleting(false);
    }
  };

  const getStatusConfig = (status: string) => {
    const configs: Record<string, { bg: string; text: string; icon: any }> = {
      EXPORTED: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
      FAILED: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
      PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: Clock },
      EXPORTING: { bg: 'bg-blue-100', text: 'text-blue-700', icon: Loader2 }
    };
    return configs[status] || configs.PENDING;
  };

  const tableNames = manifest?.row_counts ? Object.keys(manifest.row_counts) : ['orders', 'order_items'];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto" />
          <p className="mt-3 text-slate-500">Loading archive details...</p>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Archive Job Not Found</h2>
          <p className="text-slate-500 mb-6">
            {notFound 
              ? "This archive job doesn't exist. It may have been deleted, or the server was restarted causing data loss (common on free hosting tiers)."
              : "Unable to load archive details. Please try again."}
          </p>
          <Button onClick={() => router.push('/')} className="bg-blue-600 hover:bg-blue-700 text-white">
            Go to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  const statusConfig = getStatusConfig(job.status);
  const StatusIcon = statusConfig.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="mb-2 -ml-2 text-slate-500 hover:text-slate-900">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">Archive Details</h1>
        </div>
        
        {job.status === 'EXPORTED' && tableData.length > 0 && (
          <Button 
            variant="destructive" 
            onClick={handleDelete}
            disabled={deleting || missingFile}
            className="flex-shrink-0"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-2" />
            )}
            {selectedIds.size > 0
              ? `Delete ${selectedIds.size} Order(s) from DB`
              : 'Delete All from DB'
            }
          </Button>
        )}
      </div>

      {/* Selected Orders to Delete Info */}
      {selectedIds.size > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <Trash2 className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-800">
                  {selectedIds.size} order(s) marked for deletion
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {Array.from(selectedIds).slice(0, 10).map(id => (
                     <span key={id} className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">{id}</span>
                  ))}
                  {selectedIds.size > 10 && <span className="text-xs text-amber-600 self-center">...and {selectedIds.size - 10} more</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job Info Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Status Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium text-slate-600">Job Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center", statusConfig.bg)}>
                <StatusIcon className={cn("h-6 w-6", statusConfig.text, job.status === 'EXPORTING' && "animate-spin")} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className={cn("font-semibold text-lg", statusConfig.text)}>{job.status}</p>
                  {manifest?.updated_at && new Date(manifest.updated_at).getTime() > new Date(job.created_at).getTime() + 60000 && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full border border-blue-200">
                      Appended
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">Job ID: {job.job_id?.slice(0, 8)}...</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-slate-500">Created</p>
                <p className="font-medium text-slate-900">{new Date(job.created_at).toLocaleString()}</p>
              </div>
              {manifest?.updated_at ? (
                <div>
                  <p className="text-slate-500">Last Updated</p>
                  <p className="font-medium text-slate-900">{new Date(manifest.updated_at).toLocaleString()}</p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-500">Restaurant</p>
                  <p className="font-medium text-slate-900">#{job.restaurant_id}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Manifest Card */}
        {manifest && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium text-slate-600">Manifest Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-slate-500">Timezone</p>
                  <p className="font-medium text-slate-900">{manifest.restaurant_timezone || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-slate-500">Checksum</p>
                  <p className="font-mono text-xs text-slate-900 break-all">{manifest.total_checksum?.slice(0, 16)}...</p>
                </div>
              </div>
              
              {manifest.row_counts && (
                <div className="mt-4">
                  <p className="text-slate-500 text-sm mb-2">Row Counts</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(manifest.row_counts).map(([table, count]) => (
                      <div key={table} className="px-3 py-1.5 bg-slate-100 rounded-lg">
                        <span className="text-xs text-slate-500 uppercase">{table.replace(/_/g, ' ')}</span>
                        <p className="font-bold text-slate-900">{count as number}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Missing File Error State */}
      {missingFile && (
        <Card className="border-red-200 bg-red-50/50 mt-4">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-700">Archive File Missing or Expired (410)</h3>
                <p className="text-sm text-red-600 mt-1">
                  The archive files for this job are no longer available on the server. This often happens after new deployments if files were stored locally and not in S3.
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="mt-3 border-red-300 text-red-700 hover:bg-red-100"
                  onClick={handleDeleteJob}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Delete This Job
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Viewer */}
      {job.status === 'EXPORTED' && !missingFile && (
        <Card className="overflow-hidden">
          <CardHeader className="bg-slate-50 border-b">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <CardTitle className="text-base font-medium text-slate-900 flex items-center gap-2">
                <Database className="h-4 w-4 text-blue-500" />
                Data Viewer
              </CardTitle>
              
              {/* Table Tabs */}
              <div className="flex gap-1 p-1 bg-slate-200 rounded-lg overflow-x-auto">
                {tableNames.slice(0, 6).map(table => (
                  <button
                    key={table}
                    onClick={() => { setActiveTable(table); setPage(0); }}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap",
                      activeTable === table 
                        ? "bg-white text-slate-900 shadow-sm" 
                        : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    {table.replace(/_/g, ' ').toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          
          <div className="overflow-x-auto">
            {tableLoading ? (
              <div className="p-8 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" />
              </div>
            ) : tableData.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No data in {activeTable}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-left">
                  <tr>
                    {activeTable === 'orders' && (
                      <th className="px-4 py-3 w-[50px]"></th>
                    )}
                    {(() => {
                       const allKeys = Object.keys(tableData[0] || {});
                       const visibleKeys = allKeys.filter(k => !HIDDEN_COLUMNS.has(k)).slice(0, 12);
                       return visibleKeys.map(key => (
                         <th key={key} className="px-4 py-3 font-medium whitespace-nowrap">
                           {key.replace(/_/g, ' ').toUpperCase()}
                         </th>
                       ));
                    })()}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(() => {
                    const allKeys = Object.keys(tableData[0] || {});
                    const visibleKeys = allKeys.filter(k => !HIDDEN_COLUMNS.has(k)).slice(0, 12);
                    
                    return tableData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        {activeTable === 'orders' && (
                          <td className="px-4 py-3">
                            <input 
                              type="checkbox" 
                              checked={selectedIds.has(row.id)}
                              onChange={(e) => {
                                const newSet = new Set(selectedIds);
                                if (e.target.checked) newSet.add(row.id);
                                else newSet.delete(row.id);
                                setSelectedIds(newSet);
                              }}
                              className="rounded border-slate-300"
                            />
                          </td>
                        )}
                        {visibleKeys.map((key) => {
                          const val = row[key];
                          return (
                            <td key={key} className="px-4 py-3 text-slate-900 max-w-[200px] truncate" title={String(val)}>
                              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? '-')}
                            </td>
                          );
                        })}
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )}
          </div>
          
          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t bg-slate-50">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setPage(p => Math.max(0, p - 1))} 
              disabled={page === 0}
            >
              Previous
            </Button>
            <span className="text-sm text-slate-600">Page {page + 1}</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setPage(p => p + 1)} 
              disabled={tableData.length < LIMIT}
            >
              Next
            </Button>
          </div>
        </Card>
      )}

      {/* Failed State */}
      {job.status === 'FAILED' && (
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-red-700">Archive Failed</h3>
                <p className="text-sm text-red-600 mt-1">
                  This archive job failed to complete. Delete this job and try archiving again.
                </p>
                <div className="flex gap-2 mt-4">
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleDeleteJob}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                    Delete This Job
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => router.push('/')}
                  >
                    Go Back
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stale/500 Error State - show delete option */}
      {(job.status === 'EXPORTED' && tableData.length === 0 && !tableLoading) && (
        <Card className="border-amber-200 bg-amber-50/50 mt-4">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-700">No Data Found / Potential Corruption</h3>
                <p className="text-sm text-amber-600 mt-1">
                  We could not read data for this archive. The files might be missing from the server (500 Error).
                  <br/>
                  Recommended: Delete this archive job and re-archive the day.
                </p>
                <Button 
                  variant="outline" 
                  size="sm"
                  className="mt-3 border-amber-300 text-amber-700 hover:bg-amber-100"
                  onClick={handleDeleteJob}
                  disabled={deleting}
                >
                  {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Delete & Re-archive
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
