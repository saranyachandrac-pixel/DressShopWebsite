import { useState } from 'react';
import AdminTabs from '../../components/AdminTabs';
import AdminSuperCoinDashboard from './AdminSuperCoinDashboard';
import AdminSuperCoinRules from './AdminSuperCoinRules';
import AdminSuperCoinUsers from './AdminSuperCoinUsers';
import AdminSuperCoinTransactions from './AdminSuperCoinTransactions';

export default function SuperCoinAdmin() {
  const [tab, setTab] = useState('rules');

  return (
    <main>
      <p className="eyebrow">Admin dashboard</p>
      <h1>Super Coins</h1>
      <AdminTabs />
      <AdminSuperCoinDashboard />
      <div className="admin-tabs admin-sub-tabs">
        {[
          ['rules', 'Rules'],
          ['users', 'Users'],
          ['transactions', 'Transactions']
        ].map(([key, label]) => (
          <button className={tab === key ? 'active' : ''} type="button" onClick={() => setTab(key)} key={key}>{label}</button>
        ))}
      </div>
      {tab === 'rules' && <AdminSuperCoinRules />}
      {tab === 'users' && <AdminSuperCoinUsers />}
      {tab === 'transactions' && <AdminSuperCoinTransactions />}
    </main>
  );
}
