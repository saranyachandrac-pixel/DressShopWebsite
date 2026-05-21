export default function Coupons() {
  const coupons = [
    { code: 'FASHION70', title: 'Big Fashion Festival', detail: 'Up to 70% off on trending dresses' },
    { code: 'STYLE500', title: 'Premium style reward', detail: 'Extra Rs.500 off on orders above Rs.2999' },
    { code: 'NEWLOOK', title: 'New season edit', detail: 'Extra 15% off on new arrivals' }
  ];

  return (
    <main className="account-page">
      <section className="account-header">
        <p className="eyebrow">Coupons</p>
        <h1>Available offers</h1>
        <p className="helper-text">Fashion offers you can use while shopping.</p>
      </section>

      <section className="coupon-grid">
        {coupons.map((coupon) => (
          <article className="coupon-card" key={coupon.code}>
            <span>{coupon.code}</span>
            <h2>{coupon.title}</h2>
            <p>{coupon.detail}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
