import { ErrorHandler, Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ChunkErrorHandler implements ErrorHandler {
  handleError(error: any): void {
    const errorMsg = error?.message || error?.toString?.() || '';
    const isChunkError = /Failed to (fetch|load) dynamically imported module|ChunkLoadError|Loading chunk [\d]+ failed/i.test(errorMsg);

    if (isChunkError) {
      const storageKey = 'app_chunk_reload_timestamp';
      const lastReload = parseInt(sessionStorage.getItem(storageKey) || '0', 10);
      const now = Date.now();

      // Only reload if we haven't reloaded in the last 10 seconds to prevent reload loops
      if (now - lastReload > 10000) {
        sessionStorage.setItem(storageKey, now.toString());
        console.warn('New deployment detected (outdated chunk). Refreshing application...', errorMsg);
        window.location.reload();
        return;
      }
    }

    console.error('Unhandled Application Error:', error);
  }
}
