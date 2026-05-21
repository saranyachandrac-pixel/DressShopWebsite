import { ChevronDown, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

export default function MenMegaMenu({ open, mobile = false, onClose, onMouseEnter, onMouseLeave }) {
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!open || columns.length) return;
    setLoading(true);
    api.get('/men/menu')
      .then(({ data }) => setColumns(data.columns || []))
      .catch(() => setError('MEN menu load panna mudiyala.'))
      .finally(() => setLoading(false));
  }, [open, columns.length]);

  function toggle(key) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }));
  }

  function renderItems(items = []) {
    return (
      <ul className="men-mega-list">
        {items.map((item) => (
          <li key={item.slug}>
            <Link to={`/men/category/${item.slug}`} onClick={onClose}>
              <span>&gt;</span>
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  const content = (
    <>
      {loading && <p className="men-mega-state">Loading menu...</p>}
      {error && <p className="men-mega-state error">{error}</p>}
      {!loading && !error && columns.map((column, columnIndex) => (
        <div className="men-mega-column" key={columnIndex}>
          {column.map((section) => {
            const sectionKey = `${columnIndex}-${section.heading}`;
            const isExpanded = expanded[sectionKey] ?? true;
            return (
              <div className="men-mega-section" key={sectionKey}>
                <button className="men-mega-heading" type="button" onClick={() => mobile && toggle(sectionKey)}>
                  <span>{section.heading}</span>
                  {mobile && <ChevronDown size={16} className={isExpanded ? 'open' : ''} />}
                </button>
                {(!mobile || isExpanded) && (
                  <>
                    {section.groups?.map((group) => (
                      <div className="men-mega-group" key={group.heading}>
                        <h4>{group.heading}</h4>
                        {renderItems(group.items)}
                      </div>
                    ))}
                    {renderItems(section.items)}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );

  if (!open) return null;

  if (mobile) {
    return (
      <div className="men-drawer-backdrop">
        <aside className="men-drawer">
          <div className="men-drawer-head">
            <strong>MEN</strong>
            <button type="button" onClick={onClose} aria-label="Close MEN menu"><X size={20} /></button>
          </div>
          {content}
        </aside>
      </div>
    );
  }

  return (
    <div className="men-mega-wrap" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="men-mega-panel">{content}</div>
    </div>
  );
}
