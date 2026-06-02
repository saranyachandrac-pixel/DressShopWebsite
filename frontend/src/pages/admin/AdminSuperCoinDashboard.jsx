import { useEffect, useState } from 'react';
import api from '../../services/api';

export default function AdminSuperCoinDashboard() {
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    api.get('/admin/super-coins/dashboard').then(({ data }) => setDashboard(data)).catch(() => setDashboard(null));
  }, []);

  const summary = dashboard?.summary || {};

  return (
    <section className="super-coin-stats admin-super-coin-stats">
      <div><small>Total coins issued</small><strong>{summary.totalCoinsIssued || 0}</strong></div>
      <div><small>Total coins redeemed</small><strong>{summary.totalCoinsRedeemed || 0}</strong></div>
      <div><small>Total expired coins</small><strong>{summary.totalExpiredCoins || 0}</strong></div>
      <div><small>Active users with coins</small><strong>{summary.activeUsersWithCoins || 0}</strong></div>
    </section>
  );
}
