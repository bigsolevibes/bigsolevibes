export interface Product {
  id: string
  name: string
  description: string
  price: string
  // Replace with your Amazon Associates or affiliate URL
  affiliateUrl: string
  imageAlt: string
}

export const products: Product[] = [
  {
    id: 'heel-repair-balm',
    name: 'Heel Repair Balm',
    description:
      'Intense overnight hydration for cracked, dry heels. Wake up with noticeably softer feet.',
    price: '$24.99',
    // Replace with your Amazon Associates or affiliate URL
    affiliateUrl: '#affiliate',
    imageAlt: 'Heel repair balm for men',
  },
  {
    id: 'exfoliating-foot-scrub',
    name: 'Exfoliating Foot Scrub',
    description:
      'Removes dead skin and calluses fast. Menthol-infused for a clean, fresh finish.',
    price: '$19.99',
    // Replace with your Amazon Associates or affiliate URL
    affiliateUrl: '#affiliate',
    imageAlt: "Men's exfoliating foot scrub",
  },
  {
    id: 'moisturizing-gel-socks',
    name: 'Moisturizing Gel Socks',
    description:
      'Wear overnight to lock in moisture. Silky smooth results with zero effort.',
    price: '$14.99',
    // Replace with your Amazon Associates or affiliate URL
    affiliateUrl: '#affiliate',
    imageAlt: 'Moisturizing gel socks for men',
  },
]
