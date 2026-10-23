// Does not start a listener or call any business handler.
export const handlers: unknown[] = [];
export function serve(handler: unknown) { handlers.push(handler); }
