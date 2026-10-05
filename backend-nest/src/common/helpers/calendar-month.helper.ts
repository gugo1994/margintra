export const utcCalendarMonth = (instant = new Date()): { start: Date; end: Date } => {
  const start = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 1)) };
};
