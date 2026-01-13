# Yummy Archive Manager

Frontend application for managing order archiving and deletion.

## Setup

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Environment Variables**
    Create a `.env.local` file if needed, though the API base URL is currently hardcoded in `src/services/api.ts` to `http://localhost:8000`.

3.  **Run Development Server**
    ```bash
    npm run dev
    ```

## Features

*   **Dashboard**: View daily stats, list orders by day.
*   **Archive**: Select orders to archive, view job status.
*   **Manifest**: View archive details (files, checksums).
*   **Viewer**: Browse archived data in a paginated table.
*   **Delete**: Irreversibly delete source data after export.
