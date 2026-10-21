export const APP_FOREGROUND_EVENT: string = 'appForeground';
/**
 * Emitted when the ability leaves the foreground. Pages use it to stop timers
 * that only keep an on-screen view fresh. The tunnel and its recovery watchdog
 * do not listen to it and keep running.
 */
export const APP_BACKGROUND_EVENT: string = 'appBackground';