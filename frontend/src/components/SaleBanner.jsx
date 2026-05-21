export default function SaleBanner({ onClick }) {
  return (
    <button className="sale-banner" type="button" onClick={onClick}>
      <strong>Summer Blast Sale:</strong> Up to 50% OFF and Buy 1 Get 1 Free | 1st June - 31st Aug 2026 | DED Permit: 123456
    </button>
  );
}
