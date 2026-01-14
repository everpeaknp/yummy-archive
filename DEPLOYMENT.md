# Vercel Deployment Guide

To deploy this project to Vercel, follow these steps.

## 1. Prerequisites
- A **GitHub**, GitLab, or Bitbucket account.
- A **Vercel** account.
- Your project pushed to a repository.

## 2. Environment Variables
You need to set the following environment variables in Vercel's **Settings > Environment Variables**:

| Variable Name | Value | Description |
|---|---|---|
| `NEXT_PUBLIC_MAIN_API_URL` | `https://yummy-321287803064.asia-south1.run.app` | The URL of your Main Backend (Cloud Run). |

> **Note:** The Archive Backend URL is currently hardcoded in `next.config.mjs` to `https://ymmuy2.onrender.com`. If you change your archive backend deploy, you must update `next.config.mjs` and redeploy.

## 3. Configuration Files

### `next.config.mjs` (Current)
Your current config handles the proxy for archive requests:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
      return [
        {
          source: '/api/proxy/archive/:path*',
          destination: 'https://ymmuy2.onrender.com/:path*',
        },
      ];
    },
};
export default nextConfig;
```
This is fully compatible with Vercel.

### `package.json`
Your build script is standard:
```json
"build": "next build"
```
Vercel will detect this automatically.

## 4. Deployment Steps

1.  **Push to GitHub**: Commit all your current changes and push to your remote repository.
    ```bash
    git add .
    git commit -m "Ready for deploy"
    git push origin main
    ```
2.  **Import to Vercel**:
    - Go to Vercel Dashboard -> **Add New...** -> **Project**.
    - Select your `yummy-frontend` repository.
3.  **Configure**:
    - **Framework Preset**: Next.js (Auto-detected).
    - **Root Directory**: `./` (default).
    - **Environment Variables**: Add `NEXT_PUBLIC_MAIN_API_URL`.
4.  **Deploy**: Click **Deploy**.

## 5. (Optional) Make Archive URL Configurable
To make the archive URL configurable via Env Vars (like the main API), update `next.config.mjs`:

```javascript
const ARCHIVE_URL = process.env.ARCHIVE_BACKEND_URL || 'https://ymmuy2.onrender.com';

const nextConfig = {
    async rewrites() {
      return [
        {
          source: '/api/proxy/archive/:path*',
          destination: `${ARCHIVE_URL}/:path*`, // Dynamic destination
        },
      ];
    },
};
```
Then adds `ARCHIVE_BACKEND_URL` to Vercel env vars.
