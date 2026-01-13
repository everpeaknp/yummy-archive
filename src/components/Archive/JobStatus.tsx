"use client";

import React from 'react';
import { archiveApi } from '@/services/api';
import { ArchiveJob } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';
import { Loader2, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface JobStatusProps {
  job: ArchiveJob | null;
  isLoading: boolean;
}

export function JobStatus({ job, isLoading }: JobStatusProps) {
  const [errorDetails, setErrorDetails] = React.useState<any>(null);

  React.useEffect(() => {
    if (job?.status === 'FAILED') {
        // Fetch debug info
        archiveApi.get('/jobs/debug/last-error')
            .then(res => setErrorDetails(res.data))
            .catch(err => {
                console.warn("Could not fetch error details:", err);
                // If 404, backend might not support this debug endpoint yet.
                setErrorDetails({ error: "No specific error details available from backend." });
            });
    }
  }, [job?.status]);

  if (isLoading && !job) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center space-x-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading job status...</span>
        </CardContent>
      </Card>
    );
  }

  if (!job) return null;

  const statusColors = {
    PENDING: "bg-yellow-100 text-yellow-800",
    EXPORTING: "bg-blue-100 text-blue-800",
    EXPORTED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    DELETED: "bg-gray-100 text-gray-800",
  };

  const statusColor = statusColors[job.status as keyof typeof statusColors] || "bg-gray-100";

  return (
    <Card className="mb-6">
      <CardContent className="p-6">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-semibold mb-2">Archive Job Status</h2>
            <div className="flex items-center space-x-4 text-sm text-black">
              <span>Job ID: {job.job_id}</span>
              <span>Created: {job.created_at}</span>
            </div>
          </div>
          <div className={cn("px-4 py-2 rounded-full font-bold flex items-center", statusColor)}>
            {job.status === 'EXPORTING' || job.status === 'PENDING' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : job.status === 'EXPORTED' ? (
              <CheckCircle className="mr-2 h-4 w-4" />
            ) : (
               <XCircle className="mr-2 h-4 w-4" />
            )}
            {job.status}
          </div>
        </div>
        
        {job.status === 'FAILED' && errorDetails && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-900 font-mono overflow-auto">
                <h3 className="font-bold mb-2">Error Details:</h3>
                <pre>{JSON.stringify(errorDetails, null, 2)}</pre>
            </div>
        )}
      </CardContent>
    </Card>
  );
}
