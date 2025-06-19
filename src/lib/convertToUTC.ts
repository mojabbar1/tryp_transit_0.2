export function convertToUTC(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);

  const now = new Date();
  const destinationTime = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
  );

  // If it's already in the past, add 1 day
  if (destinationTime <= now) {
    destinationTime.setDate(destinationTime.getDate() + 1);
  }

  return destinationTime.toISOString();
}
