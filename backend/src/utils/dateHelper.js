const SUNDAY = 0;
const CUTOFF_HOUR = 14;

function startOfLocalDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isSunday(date) {
  return date.getDay() === SUNDAY;
}

function moveFromSunday(date) {
  const next = new Date(date);
  while (isSunday(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

function addBusinessDays(date, days) {
  const result = new Date(date);
  let remaining = Math.max(0, Number(days) || 0);

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (!isSunday(result)) {
      remaining -= 1;
    }
  }

  return moveFromSunday(result);
}

function estimateDeliveryDate(deliveryDays, now = new Date()) {
  const orderDate = startOfLocalDay(now);
  const afterCutoff = now.getHours() >= CUTOFF_HOUR;

  // Business rule: all orders need one processing day; after 2 PM starts processing the next working day.
  const processingDays = 1 + (afterCutoff ? 1 : 0);
  const totalBusinessDays = processingDays + Math.max(0, Number(deliveryDays) || 0);

  // Business rule: Sunday is not a delivery day, so delivery dates are shifted to the next working day.
  return addBusinessDays(orderDate, totalBusinessDays);
}

function formatDateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDeliveryMessage(date) {
  const weekday = date.toLocaleDateString('en-IN', { weekday: 'short' });
  const dayMonth = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return `Get it by ${weekday}, ${dayMonth}`;
}

module.exports = {
  addBusinessDays,
  estimateDeliveryDate,
  formatDateOnly,
  formatDeliveryMessage
};
