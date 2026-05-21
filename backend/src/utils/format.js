function orderNumber() {
  return `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

module.exports = { orderNumber, money };
