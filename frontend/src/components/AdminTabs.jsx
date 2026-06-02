import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

const adminSections = [
  { section: 'products', href: '/admin/products', label: 'Products' },
  { section: 'genders', href: '/admin/genders', label: 'Genders' },
  { section: 'categories', href: '/admin/categories', label: 'Categories' },
  { section: 'product-types', href: '/admin/product-types', label: 'Product Types' },
  { section: 'orders', href: '/admin/orders', label: 'Orders' },
  { section: 'guest-orders', href: '/admin/guest-orders', label: 'Guest Orders' },
  { section: 'hubs', href: '/admin/hubs', label: 'Hubs' },
  { section: 'sale', href: '/admin/sale', label: 'Sale' },
  { section: 'coupons', href: '/admin/coupons', label: 'Coupons' },
  { section: 'super-coins', href: '/admin/super-coins', label: 'Super Coins' },
  { section: 'logo', href: '/admin/logo', label: 'Logo Management' },
  { section: 'company', href: '/admin/company-name', label: 'Company Name Management' },
  { section: 'chatbot', href: '/admin/chatbot', label: 'Chatbot Support' },
  { section: 'help', href: '/admin/help', label: 'Help Center' }
];

const helpSubSections = [
  { href: '/admin/help', label: 'Articles' },
  { href: '/admin/help/tickets', label: 'Tickets' }
];

function sectionFromPath(pathname) {
  if (pathname.startsWith('/admin/help')) return 'help';
  if (pathname === '/admin/genders') return 'genders';
  if (pathname === '/admin/categories') return 'categories';
  if (pathname === '/admin/product-types') return 'product-types';
  if (pathname.startsWith('/admin/guest-orders')) return 'guest-orders';
  if (pathname.startsWith('/admin/orders')) return 'orders';
  if (pathname === '/admin' || pathname === '/admin/dashboard' || pathname.startsWith('/admin/products')) return 'products';
  if (pathname === '/admin/sale') return 'sale';
  if (pathname === '/admin/coupons') return 'coupons';
  if (pathname === '/admin/super-coins') return 'super-coins';
  if (pathname === '/admin/replacement-settings') return 'replacement';
  if (pathname === '/admin/logo') return 'logo';
  if (pathname === '/admin/company-name') return 'company';
  if (pathname === '/admin/chatbot') return 'chatbot';
  if (pathname === '/admin/hubs') return 'hubs';
  return 'products';
}

export default function AdminTabs() {
  const location = useLocation();
  const [activeAdminSection, setActiveAdminSection] = useState('all');

  useEffect(() => {
    setActiveAdminSection(sectionFromPath(location.pathname));
  }, [location.pathname]);

  return (
    <>
      <div className="admin-tabs">
        {adminSections.map((item) => (
          <Link
            className={item.section === activeAdminSection ? 'active' : ''}
            to={item.href}
            key={item.section}
          >
            {item.label}
          </Link>
        ))}
      </div>
      {activeAdminSection === 'help' && (
        <div className="admin-tabs admin-sub-tabs">
          {helpSubSections.map((item) => (
            <Link className={location.pathname === item.href ? 'active' : ''} to={item.href} key={item.href}>
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
