import { createDownloadService } from './service';

/** App-wide downloads service singleton (test suites create their own). */
export const downloadService = createDownloadService();
