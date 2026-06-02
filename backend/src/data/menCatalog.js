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

const womenMenu = [
  [
    {
      heading: 'Indian & Fusion Wear',
      groups: [
        { heading: 'Kurtas & Suits', items: ['Kurtas', 'Kurta Sets', 'Anarkali Suits', 'Churidar Sets'] },
        { heading: 'Sarees & Ethnic', items: ['Sarees', 'Lehenga Choli', 'Ethnic Dresses', 'Dupattas'] }
      ]
    }
  ],
  [
    { heading: 'Western Wear', items: ['Dresses', 'Tops', 'T-Shirts', 'Shirts', 'Jeans', 'Trousers', 'Skirts', 'Jumpsuits'] }
  ],
  [
    { heading: 'Winter Wear', items: ['Sweaters', 'Jackets', 'Sweatshirts', 'Shrugs'] }
  ],
  [
    { heading: 'Lingerie & Sleepwear', items: ['Bras', 'Briefs', 'Night Suits', 'Camisoles'] }
  ]
];

const kidsMenu = [
  [
    {
      heading: 'Boys Clothing',
      groups: [
        { heading: 'Topwear', items: ['Boys T-Shirts', 'Boys Shirts', 'Boys Sweatshirts'] },
        { heading: 'Bottomwear', items: ['Boys Jeans', 'Boys Shorts', 'Boys Track Pants'] }
      ]
    }
  ],
  [
    {
      heading: 'Girls Clothing',
      groups: [
        { heading: 'Dresses', items: ['Girls Frocks', 'Party Dresses', 'Girls Ethnic Wear'] },
        { heading: 'Everyday Wear', items: ['Girls Tops', 'Girls Leggings', 'Girls Jeans'] }
      ]
    }
  ],
  [
    { heading: 'Infants', items: ['Baby Rompers', 'Baby Sets', 'Baby Dresses'] }
  ],
  [
    { heading: 'Kids Winter Wear', items: ['Kids Jackets', 'Kids Sweaters', 'Kids Hoodies'] }
  ]
];

const genderMenus = {
  men: menMenu,
  women: womenMenu,
  kids: kidsMenu
};

const imageUrls = [
  'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1520975954732-35dd22299614?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1506629905607-d9c297d9bf95?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80'
];

const womenImageUrls = [
  'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1515372039744-b8f02a3ae446?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=900&q=80'
];

const kidsImageUrls = [
  'https://images.unsplash.com/photo-1503919545889-aef636e10ad4?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1522771930-78848d9293e8?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1471286174890-9c112ffca5b4?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1514090458221-65bb69cf63e6?auto=format&fit=crop&w=900&q=80',
  'https://images.unsplash.com/photo-1515488042361-ee00e0ddd4e4?auto=format&fit=crop&w=900&q=80'
];

function flattenCategories(gender = 'men') {
  const menu = genderMenus[gender] || menMenu;
  const rows = [];
  let sortOrder = 10;

  for (const column of menu) {
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

function productSeeds(category, index, gender = 'men') {
  const brandSets = {
    men: ['Roadster', 'Mast & Harbour', 'Highlander', 'HRX', 'DressShop'],
    women: ['Sangria', 'Anouk', 'DressBerry', 'Tokyo Talkies', 'DressShop'],
    kids: ['Tiny Tara', 'YK Kids', 'LilPicks', 'Cherry Crumble', 'DressShop']
  };
  const colorSets = {
    men: ['Black', 'Navy', 'Olive', 'White', 'Charcoal'],
    women: ['Rose', 'Maroon', 'Ivory', 'Lavender', 'Teal'],
    kids: ['Yellow', 'Sky Blue', 'Pink', 'Mint', 'Red']
  };
  const brands = brandSets[gender] || brandSets.men;
  const colors = colorSets[gender] || colorSets.men;
  const images = gender === 'women' ? womenImageUrls : gender === 'kids' ? kidsImageUrls : imageUrls;
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
      sizes: gender === 'kids' ? '2-3Y,4-5Y,6-7Y,8-9Y' : 'S,M,L,XL',
      color: colors[(index + offset) % colors.length],
      stock: 12 + offset * 6,
      imageUrl: images[(index + offset) % images.length],
      description: `Premium ${category.name.toLowerCase()} for ${gender} with everyday comfort, sharp fit and easy styling.`
    };
  });
}

module.exports = {
  menMenu,
  womenMenu,
  kidsMenu,
  genderMenus,
  flattenCategories,
  productSeeds,
  slugify
};
