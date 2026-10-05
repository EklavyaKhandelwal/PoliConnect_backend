export const addWorkingDays = (from: Date, workingDays: number): Date => {
  const result = new Date(from);
  let remaining = workingDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
};

export const resumeSlaDeadline = (
  deadline: Date,
  pausedAt: Date,
  resumedAt: Date,
): Date => {
  let cursor = new Date(Date.UTC(
    pausedAt.getUTCFullYear(),
    pausedAt.getUTCMonth(),
    pausedAt.getUTCDate(),
  ));
  const end = Date.UTC(
    resumedAt.getUTCFullYear(),
    resumedAt.getUTCMonth(),
    resumedAt.getUTCDate(),
  );
  let pausedWorkingDays = 0;

  while (cursor.getTime() < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) pausedWorkingDays += 1;
  }

  return addWorkingDays(deadline, pausedWorkingDays);
};
