
export interface ArchiveJob {
  job_id: string;
  archive_day: string; // "YYYY-MM-DD"
  status: 'PENDING' | 'EXPORTING' | 'EXPORTED' | 'FAILED' | 'DELETED';
  created_at: string;
  restaurant_id?: number;
  // manifest_path is in job detail
}

export interface Manifest {
  archive_day: string;
  datasets: Record<string, any>;
  row_counts: Record<string, number>;
  total_checksum: string;
  restaurant_timezone: string;
}

export interface DayStatus {
  date: string; // YYYY-MM-DD
  job?: ArchiveJob;
}

export interface Order {
  id: number;
  created_at: string;
  total: number;
  status: string;
  [key: string]: any;
}
