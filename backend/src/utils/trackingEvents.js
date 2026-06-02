const DELIVERY_STEPS = [
  ['ORDER_CONFIRMED', 'Order Confirmed'],
  ['PACKED', 'Packed'],
  ['SHIPPED', 'Shipped'],
  ['REACHED_NEARBY_HUB', 'Reached Nearby Hub'],
  ['OUT_FOR_DELIVERY', 'Out For Delivery'],
  ['DELIVERED', 'Delivered']
];

const DELIVERY_ALIASES = {
  PLACED: 'ORDER_CONFIRMED',
  CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  PACKED: 'PACKED',
  SHIPPED: 'SHIPPED',
  REACHED_NEARBY_HUB: 'REACHED_NEARBY_HUB',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED'
};

function value(row, snakeKey, camelKey) {
  return row?.[snakeKey] ?? row?.[camelKey] ?? null;
}

function dateParts(dateValue) {
  if (!dateValue) return { date_time: null, event_date: null, event_time: null };
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return { date_time: null, event_date: null, event_time: null };
  return {
    date_time: date.toISOString(),
    event_date: date.toISOString(),
    event_time: date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  };
}

function event(title, description, status, dateValue, type, extra = {}) {
  return {
    title,
    description,
    status,
    ...dateParts(dateValue),
    type,
    ...extra
  };
}

function isCod(order) {
  const method = String(order?.payment_method || order?.paymentMethod || '').trim().toUpperCase();
  return method === 'COD' || method === 'CASH ON DELIVERY';
}

function firstReturn(items = []) {
  return items.find((item) => String(value(item, 'request_type', 'requestType') || '').toUpperCase() === 'RETURN'
    && Boolean(value(item, 'post_delivery_request_id', 'postDeliveryRequestId')));
}

function firstCancellation(items = []) {
  return items.find((item) => Boolean(value(item, 'cancellation_id', 'cancellationId'))
    || ['CANCELLED', 'REFUNDED'].includes(String(value(item, 'item_status', 'itemStatus') || '').toUpperCase()));
}

function refundDetails(row) {
  if (!row) return null;
  return {
    amount: value(row, 'refund_amount', 'refundAmount'),
    paymentMethod: value(row, 'refund_payment_method', 'refundPaymentMethod') || '',
    transactionId: value(row, 'refund_transaction_id', 'refundTransactionId') || '',
    completedAt: value(row, 'refund_completed_at', 'refundCompletedAt') || null
  };
}

function nextStatus(hasDate, started, currentTaken) {
  if (hasDate) return { status: 'completed', currentTaken };
  if (started && !currentTaken) return { status: 'current', currentTaken: true };
  return { status: 'pending', currentTaken };
}

function deliveryEvents(order) {
  const deliveryStatus = DELIVERY_ALIASES[String(order?.delivery_status || '').toUpperCase()] || 'ORDER_CONFIRMED';
  const activeIndex = Math.max(0, DELIVERY_STEPS.findIndex(([key]) => key === deliveryStatus));
  const deliveredAt = order?.delivered_at || order?.delivered_on || null;
  return DELIVERY_STEPS.map(([key, title], index) => {
    const completed = deliveryStatus === 'DELIVERED' || index < activeIndex;
    const current = index === activeIndex && deliveryStatus !== 'DELIVERED';
    const dateValue = key === 'ORDER_CONFIRMED' ? order?.created_at : key === 'DELIVERED' ? deliveredAt : null;
    return event(
      title,
      key === 'DELIVERED' ? 'Order delivered successfully.' : `${title} status update.`,
      completed ? 'completed' : current ? 'current' : 'pending',
      dateValue,
      'delivery'
    );
  });
}

function returnEvents(returnItem) {
  const requestStatus = String(value(returnItem, 'request_status', 'requestStatus') || '').toUpperCase();
  const refundStatus = String(value(returnItem, 'post_delivery_refund_status', 'postDeliveryRefundStatus')
    || value(returnItem, 'refund_status', 'refundStatus') || '').toUpperCase();
  const requestedAt = value(returnItem, 'requested_at', 'requestedAt');
  const updatedAt = value(returnItem, 'updated_at', 'updatedAt');
  const pickedAt = value(returnItem, 'return_picked_up_at', 'returnPickedUpAt')
    || (['RETURN_PICKED_UP', 'RETURN_COMPLETED', 'REFUNDED'].includes(requestStatus) ? updatedAt : null);
  const completedAt = value(returnItem, 'return_completed_at', 'returnCompletedAt')
    || (['RETURN_COMPLETED', 'REFUNDED'].includes(requestStatus) ? updatedAt : null);
  const refundProcessingAt = value(returnItem, 'refund_processing_at', 'refundProcessingAt')
    || (['PROCESSING', 'COMPLETED', 'REFUNDED'].includes(refundStatus) ? updatedAt : null);
  const refundCompletedAt = value(returnItem, 'refund_completed_at', 'refundCompletedAt')
    || (['COMPLETED', 'REFUNDED'].includes(refundStatus) ? updatedAt : null);
  const reason = value(returnItem, 'request_reason', 'requestReason');
  const refund = refundDetails(returnItem);
  let currentTaken = false;
  const started = Boolean(requestedAt);

  return [
    event('Return Requested', reason ? `You returned this order because ${reason}.` : 'Return request created.', 'completed', requestedAt, 'return'),
    event('Return Picked Up', 'Return pickup completed by courier partner.', '', pickedAt, 'return'),
    event('Return Completed', 'Returned product received and verified.', '', completedAt, 'return'),
    event('Refund Processing', 'Refund is being processed.', '', refundProcessingAt, 'refund', { refund }),
    event('Refund Completed', 'Refund paid successfully.', '', refundCompletedAt, 'refund', { refund })
  ].map((item, index) => {
    if (index === 0) return item;
    const next = nextStatus(Boolean(item.date_time), started, currentTaken);
    currentTaken = next.currentTaken;
    return { ...item, status: next.status };
  });
}

function cancellationEvents(order, cancellation) {
  const refundStatus = String(value(cancellation, 'refund_status', 'refundStatus') || '').toUpperCase();
  const cancelledAt = value(cancellation, 'cancelled_at', 'cancelledAt') || order?.updated_at || order?.created_at;
  const reason = value(cancellation, 'cancel_reason', 'cancelReason');
  const prepaid = !isCod(order);
  const refundCompleted = ['REFUNDED', 'COMPLETED'].includes(refundStatus);
  const refundProcessing = prepaid && ['PENDING', 'PROCESSING', 'REFUNDED', 'COMPLETED'].includes(refundStatus);
  const events = [
    event('Order Confirmed', 'Order placed successfully.', 'completed', order?.created_at, 'delivery'),
    event('Cancellation Requested', reason ? `Cancellation requested because ${reason}.` : 'Cancellation request created.', 'completed', cancelledAt, 'cancellation'),
    event('Cancellation Approved', 'Cancellation approved.', 'completed', cancelledAt, 'cancellation')
  ];

  if (!prepaid) {
    events.push(event('Cancellation Completed', 'COD order cancelled. No refund required.', 'completed', cancelledAt, 'cancellation'));
    return events;
  }

  events.push(event('Cancelled', 'Order cancelled successfully.', 'completed', cancelledAt, 'cancellation'));
  events.push(event('Refund Processing', 'Refund is being processed.', refundCompleted ? 'completed' : refundProcessing ? 'current' : 'pending', refundCompleted ? cancelledAt : null, 'refund'));
  events.push(event('Refund Completed', 'Refund paid successfully.', refundCompleted ? 'completed' : 'pending', refundCompleted ? cancelledAt : null, 'refund'));
  return events;
}

function buildTrackingEvents(order, items = []) {
  const cancellation = firstCancellation(items);
  if (cancellation) return cancellationEvents(order, cancellation);

  const returnedItem = firstReturn(items);
  if (returnedItem) return deliveryEvents({ ...order, delivery_status: 'DELIVERED' }).concat(returnEvents(returnedItem));

  return deliveryEvents(order);
}

module.exports = { buildTrackingEvents };
