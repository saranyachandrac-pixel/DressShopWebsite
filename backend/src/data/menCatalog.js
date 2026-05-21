function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const menMenu = [
  [
    {
      heading: 'Clothing',
      groups: [
        { heading: 'Top wear', items: ['T-Shirts', 'Formal Shirts', 'Casual Shirts'] },
        { heading: 'Bottom wear', items: ['Jeans', 'Casual Trousers', 'Formal Trousers', 'Track pants', 'Shorts', 'Cargos', 'Three Fourths', 'Suits Blazers & Waistcoats'] }
      ]
    }
  ],
  [
    { heading: 'Winter Wear', items: ['Sweatshirts', 'Jackets', 'Sweater', 'Tracksuits'] }
  ],
  [
    { heading: 'Ethnic wear', items: ['Kurta', 'Ethnic Sets', 'Sherwanis', 'Ethnic Pyjama', 'Dhoti', 'Lungi'] }
  ],
  [
    { heading: 'Innerwear & Loungewear', items: ['Briefs & Trunks', 'Vests', 'Boxers', 'Pyjamas and Lounge Pants', 'Thermals'] }
  ]
];

const imageUrls = [
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1506629905607-d9c297d9bf95?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80'
];

function flattenCategories() {
  const rows = [];
  let sortOrder = 10;

  for (const column of menMenu) {
    for (const section of column) {
      const sectionSlug = slugify(section.heading);
      rows.push({ name: section.heading, slug: sectionSlug, parentSlug: null, sortOrder: sortOrder++, isLeaf: !section.groups });

      if (section.groups) {
        for (const group of section.groups) {
          const groupSlug = slugify(group.heading);
          rows.push({ name: group.heading, slug: groupSlug, parentSlug: sectionSlug, sortOrder: sortOrder++, isLeaf: false });
          for (const item of group.items) {
            rows.push({ name: item, slug: slugify(item), parentSlug: groupSlug, sortOrder: sortOrder++, isLeaf: true });
          }
        }
      } else {
        for (const item of section.items) {
          rows.push({ name: item, slug: slugify(item), parentSlug: sectionSlug, sortOrder: sortOrder++, isLeaf: true });
        }
      }
    }
  }

  return rows;
}

function productSeeds(category, index) {
  const brands = ['Roadster', 'Mast & Harbour', 'Highlander', 'HRX', 'DressShop'];
  const colors = ['Black', 'Navy', 'Olive', 'White', 'Charcoal'];
  const baseMrp = 1299 + (index % 7) * 300;

  return [0, 1, 2].map((offset) => {
    const brand = brands[(index + offset) % brands.length];
    const discount = [35, 45, 30][offset];
    const mrp = baseMrp + offset * 360;
    return {
      brand,
      name: `${brand} ${category.name} ${['Essential', 'Slim Fit', 'Premium'][offset]}`,
      slug: slugify(`${category.slug}-${brand}-${offset + 1}`),
      price: Math.round(mrp * (1 - discount / 100)),
      mrp,
      discount,
      rating: Number((4.1 + ((index + offset) % 7) / 10).toFixed(1)),
      sizes: 'S,M,L,XL',
      color: colors[(index + offset) % colors.length],
      stock: 12 + offset * 6,
      imageUrl: imageUrls[(index + offset) % imageUrls.length],
      description: `Premium ${category.name.toLowerCase()} for men with everyday comfort, sharp fit and easy styling.`
    };
  });
}

module.exports = {
  menMenu,
  flattenCategories,
  productSeeds,
  slugify
};
