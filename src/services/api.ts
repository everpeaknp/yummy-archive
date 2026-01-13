
import axios from 'axios';

// Main Backend (Auth & Orders)
// User provided: https://yummy-321287803064.asia-south1.run.app/docs
const MAIN_API_URL = process.env.NEXT_PUBLIC_MAIN_API_URL || 'https://yummy-321287803064.asia-south1.run.app';

// Archive Backend
// Archive Backend (Proxied)
const ARCHIVE_API_URL = '/api/proxy/archive';

// For Auth and Orders (Main Backend)
export const mainApi = axios.create({
  baseURL: MAIN_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// For Archive Jobs and Manifests (Render Backend)
export const archiveApi = axios.create({
  baseURL: ARCHIVE_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to add token to both
const addToken = (config: any) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

mainApi.interceptors.request.use(addToken, Promise.reject);
archiveApi.interceptors.request.use(addToken, Promise.reject);

// Alias internalApi to mainApi for easier refactor if needed, or just replace usages.
export const internalApi = mainApi; 

export default mainApi; 
