/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Mock tech-product catalogue for the Floema storefront rebuild.
 *
 * Activated by VITE_MOCK=1. Shaped to match the real API responses
 * defined in `./api.ts` so the storefront pages render exactly the
 * same way they would against the FastAPI backend.
 *
 * Product images are generated inline as data-URI SVGs so the
 * storefront renders cleanly in any network environment (including
 * sandboxed dev containers).
 */

import type {
  ProductDetail,
  ProductListItem,
  OfferOut,
  MediaItem,
  CategoryItem,
  BrandItem,
  PriceBounds,
  ProductListResult,
} from './api'

export type Collection = 'laptops' | 'audio' | 'gaming' | 'smart-home' | 'accessories'

interface Seed {
  slug: string
  name: string
  brand: string
  category: string         // surfaces in nav / Catalog
  collection: Collection
  model?: string
  price: number
  available: number
  image: string            // primary
  gallery?: string[]
  blurb: string
  specs: Record<string, string | number>
}

/* ───────────────────────────────────────────────────────────────
 * Product imagery — generated as inline data-URI SVGs so they
 * always render, regardless of network. Each helper accepts a
 * background tint (matched to the collection accent) and produces
 * a flat, editorial silhouette of the product.
 * ──────────────────────────────────────────────────────────── */

type Shape =
  | 'laptop' | 'desktop' | 'minipc'
  | 'headphones' | 'earbuds' | 'speaker' | 'mic' | 'dac' | 'neckband'
  | 'keyboard' | 'mouse' | 'console' | 'handheld' | 'monitor' | 'ultrawide'
  | 'thermostat' | 'doorbell' | 'router' | 'bulb' | 'camera'
  | 'sleeve' | 'tracker' | 'clutch' | 'dock' | 'stand' | 'cables' | 'eartips'
  | 'glasses' | 'watch'

const SHAPES: Record<Shape, string> = {
  // Laptops & desktops
  laptop:    '<rect x="60" y="120" width="280" height="170" rx="8" fill="#241F21"/><rect x="74" y="134" width="252" height="142" fill="#F2EFEA"/><rect x="40" y="290" width="320" height="14" rx="6" fill="#241F21"/>',
  desktop:   '<rect x="80" y="80" width="240" height="220" rx="6" fill="#241F21"/><rect x="94" y="94" width="212" height="180" fill="#F2EFEA"/><circle cx="200" cy="290" r="6" fill="#F2EFEA"/>',
  minipc:    '<rect x="120" y="180" width="160" height="80" rx="10" fill="#241F21"/><circle cx="155" cy="220" r="6" fill="#F2EFEA"/><rect x="180" y="216" width="80" height="8" rx="2" fill="#F2EFEA"/>',
  // Audio
  headphones: '<path d="M100 220 Q200 80 300 220" fill="none" stroke="#241F21" stroke-width="14" stroke-linecap="round"/><rect x="80" y="200" width="50" height="80" rx="14" fill="#241F21"/><rect x="270" y="200" width="50" height="80" rx="14" fill="#241F21"/>',
  earbuds:    '<circle cx="160" cy="200" r="32" fill="#241F21"/><rect x="148" y="220" width="24" height="60" rx="10" fill="#241F21"/><circle cx="240" cy="200" r="32" fill="#241F21"/><rect x="228" y="220" width="24" height="60" rx="10" fill="#241F21"/>',
  speaker:    '<rect x="130" y="80" width="140" height="240" rx="10" fill="#241F21"/><circle cx="200" cy="140" r="22" fill="#F2EFEA"/><circle cx="200" cy="230" r="44" fill="#F2EFEA"/>',
  mic:        '<rect x="170" y="80" width="60" height="120" rx="30" fill="#241F21"/><rect x="190" y="200" width="20" height="60" fill="#241F21"/><rect x="160" y="260" width="80" height="14" rx="4" fill="#241F21"/>',
  dac:        '<rect x="70" y="170" width="260" height="80" rx="6" fill="#241F21"/><circle cx="120" cy="210" r="16" fill="#F2EFEA"/><circle cx="170" cy="210" r="16" fill="#F2EFEA"/><rect x="200" y="200" width="120" height="20" rx="4" fill="#F2EFEA"/>',
  neckband:   '<path d="M80 200 Q200 320 320 200" fill="none" stroke="#241F21" stroke-width="14" stroke-linecap="round"/><circle cx="80" cy="200" r="14" fill="#241F21"/><circle cx="320" cy="200" r="14" fill="#241F21"/>',
  // Gaming
  keyboard:   '<rect x="40" y="160" width="320" height="100" rx="10" fill="#241F21"/><g fill="#F2EFEA"><rect x="55" y="175" width="22" height="22" rx="3"/><rect x="85" y="175" width="22" height="22" rx="3"/><rect x="115" y="175" width="22" height="22" rx="3"/><rect x="145" y="175" width="22" height="22" rx="3"/><rect x="175" y="175" width="22" height="22" rx="3"/><rect x="205" y="175" width="22" height="22" rx="3"/><rect x="235" y="175" width="22" height="22" rx="3"/><rect x="265" y="175" width="22" height="22" rx="3"/><rect x="295" y="175" width="50" height="22" rx="3"/><rect x="65" y="205" width="270" height="22" rx="3"/><rect x="120" y="232" width="150" height="22" rx="3"/></g>',
  mouse:      '<path d="M140 130 Q200 90 260 130 L270 240 Q270 290 200 290 Q130 290 130 240 Z" fill="#241F21"/><rect x="195" y="150" width="10" height="40" rx="5" fill="#F2EFEA"/>',
  console:    '<rect x="80" y="140" width="240" height="120" rx="6" fill="#241F21"/><rect x="100" y="160" width="180" height="80" rx="4" fill="#F2EFEA"/><circle cx="120" cy="270" r="6" fill="#241F21"/><circle cx="280" cy="270" r="6" fill="#241F21"/>',
  handheld:   '<rect x="60" y="130" width="280" height="160" rx="30" fill="#241F21"/><rect x="120" y="150" width="160" height="120" rx="6" fill="#F2EFEA"/><circle cx="90" cy="210" r="14" fill="#F2EFEA"/><circle cx="310" cy="210" r="14" fill="#F2EFEA"/>',
  monitor:    '<rect x="40" y="80" width="320" height="200" rx="8" fill="#241F21"/><rect x="56" y="96" width="288" height="160" fill="#F2EFEA"/><rect x="170" y="290" width="60" height="14" rx="4" fill="#241F21"/><rect x="120" y="304" width="160" height="10" rx="4" fill="#241F21"/>',
  ultrawide:  '<path d="M40 100 Q200 80 360 100 L360 280 Q200 300 40 280 Z" fill="#241F21"/><path d="M56 116 Q200 98 344 116 L344 264 Q200 282 56 264 Z" fill="#F2EFEA"/>',
  // Smart home
  thermostat: '<circle cx="200" cy="200" r="100" fill="#241F21"/><circle cx="200" cy="200" r="70" fill="#F2EFEA"/><text x="200" y="216" text-anchor="middle" fill="#241F21" font-family="Inter,sans-serif" font-weight="600" font-size="42">21°</text>',
  doorbell:   '<rect x="150" y="90" width="100" height="220" rx="30" fill="#241F21"/><circle cx="200" cy="160" r="18" fill="#F2EFEA"/><circle cx="200" cy="160" r="9" fill="#241F21"/><circle cx="200" cy="240" r="14" fill="#F2EFEA"/>',
  router:     '<rect x="80" y="170" width="240" height="80" rx="10" fill="#241F21"/><circle cx="120" cy="240" r="4" fill="#E9E777"/><circle cx="140" cy="240" r="4" fill="#85A1C5"/><circle cx="160" cy="240" r="4" fill="#BACFA3"/><rect x="120" y="120" width="6" height="60" fill="#241F21"/><rect x="160" y="100" width="6" height="80" fill="#241F21"/><rect x="200" y="120" width="6" height="60" fill="#241F21"/>',
  bulb:       '<path d="M170 110 Q170 60 200 60 Q230 60 230 110 Q260 130 260 180 Q260 230 200 240 Q140 230 140 180 Q140 130 170 110 Z" fill="#241F21"/><rect x="178" y="240" width="44" height="14" fill="#241F21"/><rect x="184" y="254" width="32" height="20" rx="2" fill="#241F21"/>',
  camera:     '<rect x="110" y="140" width="180" height="120" rx="12" fill="#241F21"/><circle cx="200" cy="200" r="40" fill="#F2EFEA"/><circle cx="200" cy="200" r="26" fill="#241F21"/><circle cx="208" cy="192" r="6" fill="#F2EFEA"/>',
  // Accessories
  sleeve:     '<rect x="80" y="100" width="240" height="200" rx="12" fill="#241F21"/><rect x="96" y="116" width="208" height="168" fill="#F2EFEA"/><circle cx="200" cy="200" r="14" fill="#241F21"/>',
  tracker:    '<circle cx="200" cy="200" r="60" fill="#241F21"/><circle cx="200" cy="200" r="14" fill="#F2EFEA"/>',
  clutch:     '<rect x="60" y="140" width="280" height="160" rx="12" fill="#241F21"/><line x1="60" y1="190" x2="340" y2="190" stroke="#F2EFEA" stroke-width="3"/><rect x="170" y="120" width="60" height="40" rx="6" fill="#241F21"/>',
  dock:       '<ellipse cx="200" cy="240" rx="120" ry="20" fill="#241F21"/><rect x="180" y="120" width="40" height="120" rx="6" fill="#241F21"/><circle cx="200" cy="120" r="18" fill="#F2EFEA"/>',
  stand:      '<rect x="80" y="180" width="240" height="20" rx="4" fill="#241F21"/><polygon points="80,200 320,200 300,240 100,240" fill="#241F21"/>',
  cables:     '<path d="M80 130 Q200 220 320 130" fill="none" stroke="#241F21" stroke-width="10"/><path d="M80 180 Q200 270 320 180" fill="none" stroke="#241F21" stroke-width="10"/><path d="M80 230 Q200 320 320 230" fill="none" stroke="#241F21" stroke-width="10"/>',
  eartips:    '<circle cx="130" cy="170" r="22" fill="#241F21"/><circle cx="200" cy="170" r="22" fill="#241F21"/><circle cx="270" cy="170" r="22" fill="#241F21"/><circle cx="130" cy="240" r="22" fill="#241F21"/><circle cx="200" cy="240" r="22" fill="#241F21"/><circle cx="270" cy="240" r="22" fill="#241F21"/>',
  glasses:    '<rect x="60" y="170" width="120" height="60" rx="20" fill="#241F21"/><rect x="220" y="170" width="120" height="60" rx="20" fill="#241F21"/><line x1="180" y1="200" x2="220" y2="200" stroke="#241F21" stroke-width="8"/>',
  watch:      '<rect x="160" y="60" width="80" height="40" fill="#241F21"/><rect x="160" y="280" width="80" height="40" fill="#241F21"/><rect x="140" y="100" width="120" height="180" rx="20" fill="#241F21"/><rect x="156" y="116" width="88" height="148" rx="10" fill="#F2EFEA"/><text x="200" y="206" text-anchor="middle" font-family="Inter,sans-serif" font-weight="600" font-size="36" fill="#241F21">10:08</text>',
}

const COLLECTION_TINTS: Record<Collection, string> = {
  laptops:      '#D9E1ED',  // pale replastic
  audio:        '#DEE9CF',  // pale nature
  gaming:       '#FBD8CC',  // pale urban
  'smart-home': '#E6DDC9',  // pale golf/sand
  accessories:  '#EAE5DC',  // pale details
}

function svgUri(shape: Shape, tint: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">` +
      `<rect width="400" height="400" fill="${tint}"/>` +
      SHAPES[shape] +
    `</svg>`
  // URL-encode so the SVG is safe in src/srcSet/CSS without base64
  // (works the same way in browser and SSR, no Buffer/btoa needed).
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

const img = (shape: Shape, collection: Collection) => svgUri(shape, COLLECTION_TINTS[collection])

const SEEDS: Seed[] = [
  // ── Laptops ────────────────────────────────────────────────
  {
    slug: 'aurora-14-pro',
    name: 'Aurora 14 Pro',
    brand: 'Northwind',
    category: 'Laptops',
    collection: 'laptops',
    model: 'NW-AUR14P-M3',
    price: 189000,
    available: 12,
    image: img('laptop', 'laptops'),
    gallery: undefined,
    blurb: 'A featherlight 14" machined-aluminium notebook tuned for editorial work. Twelve hours on a charge, no fan in sight.',
    specs: { 'CPU': 'M-class 12-core', 'RAM': '16 GB unified', 'Storage': '1 TB NVMe', 'Display': '14.2" Liquid Retina', 'Battery': '12 h' },
  },
  {
    slug: 'meridian-16-studio',
    name: 'Meridian 16 Studio',
    brand: 'Halcyon',
    category: 'Laptops',
    collection: 'laptops',
    model: 'HC-MER16-S',
    price: 285000,
    available: 6,
    image: img('laptop', 'laptops'),
    blurb: 'A 16-inch workstation built for colour-graded video. Mini-LED panel, 1600-nit highlight peaks, silent under load.',
    specs: { 'CPU': '12-core / 24-thread', 'RAM': '32 GB', 'Storage': '2 TB NVMe', 'GPU': 'RTX 4070 Mobile', 'Display': '16" Mini-LED' },
  },
  {
    slug: 'fieldbook-13-air',
    name: 'Fieldbook 13 Air',
    brand: 'Northwind',
    category: 'Laptops',
    collection: 'laptops',
    price: 132000,
    available: 18,
    image: img('laptop', 'laptops'),
    blurb: 'The most-recommended ultra-portable on the market — 1.1 kg, fanless, and survives a 4-foot drop.',
    specs: { 'Weight': '1.1 kg', 'Battery': '14 h', 'CPU': 'Quad-core efficiency class', 'RAM': '16 GB', 'Storage': '512 GB' },
  },
  {
    slug: 'compass-15-everyday',
    name: 'Compass 15 Everyday',
    brand: 'Lighthouse',
    category: 'Laptops',
    collection: 'laptops',
    price: 84000,
    available: 22,
    image: img('laptop', 'laptops'),
    blurb: 'The reliable workhorse — 15.6" matte panel, full-size keyboard with a numpad, and a price that does not surprise you.',
    specs: { 'CPU': 'Octa-core', 'RAM': '16 GB', 'Storage': '512 GB SSD', 'Display': '15.6" FHD matte' },
  },
  {
    slug: 'pebble-mini-pc',
    name: 'Pebble Mini PC',
    brand: 'Halcyon',
    category: 'Desktops',
    collection: 'laptops',
    price: 98000,
    available: 9,
    image: img('minipc', 'laptops'),
    blurb: 'A 120 mm cube of silent desktop. Plug a monitor in, plug a keyboard in, get back to work.',
    specs: { 'Footprint': '120 × 120 × 38 mm', 'CPU': '8-core', 'RAM': '32 GB', 'Storage': '1 TB', 'Ports': '2× TB4, HDMI, 2× USB-A' },
  },
  {
    slug: 'atlas-tower-pro',
    name: 'Atlas Tower Pro',
    brand: 'Halcyon',
    category: 'Desktops',
    collection: 'laptops',
    price: 412000,
    available: 4,
    image: img('desktop', 'laptops'),
    blurb: 'A glass-sided workstation tower for serious rendering — 24-core CPU, dual-slot GPU, tool-free chassis.',
    specs: { 'CPU': '24-core / 48-thread', 'RAM': '64 GB ECC', 'GPU': 'RTX 4080', 'Storage': '4 TB NVMe + 8 TB HDD' },
  },

  // ── Audio ──────────────────────────────────────────────────
  {
    slug: 'tide-over-ear',
    name: 'Tide Over-Ear',
    brand: 'Marrow',
    category: 'Headphones',
    collection: 'audio',
    price: 48000,
    available: 27,
    image: img('headphones', 'audio'),
    gallery: undefined,
    blurb: 'Calm, accurate, closed-back wireless headphones. The kind you forget you are wearing after the first song.',
    specs: { 'Drivers': '40 mm dynamic', 'Battery': '40 h ANC on', 'Weight': '244 g', 'Codecs': 'aptX Lossless / LDAC', 'Charging': 'USB-C, 10-min → 6 h' },
  },
  {
    slug: 'kiln-iem',
    name: 'Kiln IEM',
    brand: 'Marrow',
    category: 'Earbuds',
    collection: 'audio',
    price: 22000,
    available: 41,
    image: img('earbuds', 'audio'),
    blurb: 'Three balanced-armature drivers in a hand-poured resin shell. Comes in a leather pouch and four ear-tip sizes.',
    specs: { 'Drivers': '3 BA per side', 'Impedance': '18 Ω', 'Cable': '2-pin OFC, detachable' },
  },
  {
    slug: 'paper-bookshelf',
    name: 'Paper Bookshelf Speakers',
    brand: 'Folio',
    category: 'Speakers',
    collection: 'audio',
    price: 96000,
    available: 7,
    image: img('speaker', 'audio'),
    blurb: 'A pair of two-way bookshelves wrapped in unbleached paper-pulp composite. Warm tweeter, taut bass.',
    specs: { 'Type': 'Two-way passive', 'Power handling': '80 W', 'Sensitivity': '87 dB', 'Crossover': '2.6 kHz' },
  },
  {
    slug: 'lantern-portable',
    name: 'Lantern Portable Speaker',
    brand: 'Folio',
    category: 'Speakers',
    collection: 'audio',
    price: 18500,
    available: 33,
    image: img('speaker', 'audio'),
    blurb: 'A 360-degree desk speaker the size of a coffee mug. Honest sound, twenty hours per charge, optional leather sling.',
    specs: { 'Battery': '20 h', 'Output': '20 W RMS', 'Rating': 'IP55' },
  },
  {
    slug: 'forge-dac-amp',
    name: 'Forge DAC / Amp',
    brand: 'Marrow',
    category: 'Audio Gear',
    collection: 'audio',
    price: 56000,
    available: 11,
    image: img('dac', 'audio'),
    blurb: 'A desktop DAC and headphone amplifier in a single matte-black brick. Quiet stage, balanced 4.4 mm output.',
    specs: { 'Outputs': '6.35 mm SE + 4.4 mm balanced', 'DAC': 'ESS 9038PRO', 'Power': '1.2 W into 32 Ω' },
  },
  {
    slug: 'studio-condenser-mic',
    name: 'Studio Condenser Mic',
    brand: 'Folio',
    category: 'Audio Gear',
    collection: 'audio',
    price: 36000,
    available: 14,
    image: img('mic', 'audio'),
    blurb: 'A side-address large-diaphragm condenser. Looks like 1960s broadcast gear, sounds like 2024 studio gear.',
    specs: { 'Pattern': 'Cardioid / Omni / Fig-8', 'Capsule': '32 mm gold-sputtered', 'Connection': 'XLR, 48 V phantom' },
  },

  // ── Gaming ─────────────────────────────────────────────────
  {
    slug: 'arena-78-keyboard',
    name: 'Arena 78 Keyboard',
    brand: 'Switchsmith',
    category: 'Keyboards',
    collection: 'gaming',
    price: 32000,
    available: 19,
    image: img('keyboard', 'gaming'),
    blurb: 'A 75% hot-swap mechanical keyboard with brass plates, gasket-mounted, sounds like a marble fountain.',
    specs: { 'Layout': '75%', 'Switches': 'Hot-swap, 5-pin', 'Plate': 'Brass', 'Connection': 'USB-C + 2.4 GHz + BT5.1' },
  },
  {
    slug: 'arena-65-tkl',
    name: 'Arena 65 TKL',
    brand: 'Switchsmith',
    category: 'Keyboards',
    collection: 'gaming',
    price: 26000,
    available: 24,
    image: img('keyboard', 'gaming'),
    blurb: 'The 65-key sibling — smaller footprint, same gasket mount, same satisfying thock.',
    specs: { 'Layout': '65%', 'Switches': 'Hot-swap, 5-pin', 'Battery': '4000 mAh' },
  },
  {
    slug: 'precision-mouse-x',
    name: 'Precision Mouse X',
    brand: 'Switchsmith',
    category: 'Mice',
    collection: 'gaming',
    price: 18000,
    available: 38,
    image: img('mouse', 'gaming'),
    blurb: '54 g symmetrical wireless mouse with a 30K-DPI sensor and PTFE skates. Built for first-person shooters.',
    specs: { 'Weight': '54 g', 'Sensor': '30K DPI', 'Polling': '8000 Hz', 'Battery': '80 h' },
  },
  {
    slug: 'console-pro-9',
    name: 'Console Pro 9',
    brand: 'Pixelarc',
    category: 'Consoles',
    collection: 'gaming',
    price: 84000,
    available: 8,
    image: img('console', 'gaming'),
    blurb: 'The current-generation home console — 4K HDR, ray tracing, 1 TB internal SSD, controller included.',
    specs: { 'Storage': '1 TB NVMe', 'Resolution': '4K @ 120 Hz', 'HDR': 'HDR10 + Dolby Vision' },
  },
  {
    slug: 'handheld-pocket-7',
    name: 'Handheld Pocket 7',
    brand: 'Pixelarc',
    category: 'Consoles',
    collection: 'gaming',
    price: 62000,
    available: 13,
    image: img('handheld', 'gaming'),
    blurb: '7-inch 120 Hz handheld gaming PC. Hall-effect sticks, vapour chamber, runs your whole Steam library.',
    specs: { 'Display': '7" 1200p 120 Hz VRR', 'APU': '8-core RDNA 3', 'RAM': '16 GB LPDDR5', 'Storage': '1 TB' },
  },
  {
    slug: 'arena-monitor-27',
    name: 'Arena 27" 240 Hz Monitor',
    brand: 'Pixelarc',
    category: 'Monitors',
    collection: 'gaming',
    price: 78000,
    available: 10,
    image: img('monitor', 'gaming'),
    blurb: 'A 27-inch QD-OLED gaming monitor with 1440p resolution and a 0.03 ms response time.',
    specs: { 'Panel': 'QD-OLED 27"', 'Resolution': '2560 × 1440', 'Refresh': '240 Hz', 'Response': '0.03 ms' },
  },
  {
    slug: 'arena-ultrawide-34',
    name: 'Arena 34" Ultrawide',
    brand: 'Pixelarc',
    category: 'Monitors',
    collection: 'gaming',
    price: 132000,
    available: 5,
    image: img('ultrawide', 'gaming'),
    blurb: 'A 34-inch curved ultrawide with 165 Hz refresh and DisplayHDR 600. Two PCs over one cable with KVM.',
    specs: { 'Panel': 'Nano-IPS 34" 1800R', 'Resolution': '3440 × 1440', 'Refresh': '165 Hz', 'HDR': 'DisplayHDR 600' },
  },

  // ── Smart Home ─────────────────────────────────────────────
  {
    slug: 'hearth-thermostat',
    name: 'Hearth Smart Thermostat',
    brand: 'Glow',
    category: 'Smart Home',
    collection: 'smart-home',
    price: 24000,
    available: 16,
    image: img('thermostat', 'smart-home'),
    blurb: 'A learning thermostat in a turned-aluminium puck. Knows when you are home, holds a steady temperature, looks like sculpture.',
    specs: { 'Display': '2.4" OLED', 'Comms': 'Thread / Wi-Fi 6', 'Sensors': 'Temperature, humidity, occupancy' },
  },
  {
    slug: 'beacon-doorbell',
    name: 'Beacon Video Doorbell',
    brand: 'Glow',
    category: 'Smart Home',
    collection: 'smart-home',
    price: 19000,
    available: 21,
    image: img('doorbell', 'smart-home'),
    blurb: '180-degree HDR video doorbell with on-device person detection. No cloud sub required.',
    specs: { 'Resolution': '1600p HDR', 'Field of view': '180° diagonal', 'Power': 'Wired or battery' },
  },
  {
    slug: 'lighthouse-router-6e',
    name: 'Lighthouse Wi-Fi 6E Router',
    brand: 'Lighthouse',
    category: 'Networking',
    collection: 'smart-home',
    price: 48000,
    available: 9,
    image: img('router', 'smart-home'),
    blurb: 'A tri-band Wi-Fi 6E router that disappears into a bookshelf. 2.5 Gbps WAN, four 1 Gbps LAN, parental controls included.',
    specs: { 'Bands': 'Tri-band 2.4 / 5 / 6 GHz', 'WAN': '2.5 Gbps', 'Antennas': '8 internal' },
  },
  {
    slug: 'lighthouse-mesh-pack',
    name: 'Lighthouse Mesh 3-Pack',
    brand: 'Lighthouse',
    category: 'Networking',
    collection: 'smart-home',
    price: 96000,
    available: 6,
    image: img('router', 'smart-home'),
    blurb: 'Three nodes that quietly cover a 6,000 sq-ft house. Backhaul over wired or wireless, your choice.',
    specs: { 'Coverage': '6,000 sq ft', 'Bands': 'Tri-band', 'Backhaul': 'Wired 2.5 GbE or wireless' },
  },
  {
    slug: 'glow-bulb-pack',
    name: 'Glow Bulb Pack (4)',
    brand: 'Glow',
    category: 'Smart Home',
    collection: 'smart-home',
    price: 12000,
    available: 44,
    image: img('bulb', 'smart-home'),
    blurb: 'Four smart bulbs in matte glass. Tunable white from 2200 K candlelight to 6500 K daylight, no hub needed.',
    specs: { 'Lumens': '1100 lm', 'Colour': '2200–6500 K tunable white', 'Comms': 'Thread + Matter' },
  },
  {
    slug: 'cinder-camera',
    name: 'Cinder Security Camera',
    brand: 'Glow',
    category: 'Smart Home',
    collection: 'smart-home',
    price: 16500,
    available: 18,
    image: img('camera', 'smart-home'),
    blurb: 'A weatherproof outdoor camera in cast aluminium. 4K sensor, on-device AI, encrypted local storage.',
    specs: { 'Resolution': '4K UHD', 'Field of view': '160°', 'Rating': 'IP66', 'Storage': 'microSD up to 512 GB' },
  },

  // ── Accessories ────────────────────────────────────────────
  {
    slug: 'gallery-leather-sleeve-14',
    name: 'Gallery Leather Sleeve 14"',
    brand: 'Folio',
    category: 'Accessories',
    collection: 'accessories',
    price: 7800,
    available: 32,
    image: img('sleeve', 'accessories'),
    blurb: 'Full-grain vegetable-tanned leather laptop sleeve. Wool felt interior, brass closure, ages beautifully.',
    specs: { 'Material': 'Full-grain leather', 'Fits': '14" laptop / tablet', 'Closure': 'Brass turn-lock' },
  },
  {
    slug: 'wayfinder-tracker',
    name: 'Wayfinder Item Tracker',
    brand: 'Glow',
    category: 'Accessories',
    collection: 'accessories',
    price: 3400,
    available: 60,
    image: img('tracker', 'accessories'),
    blurb: 'A coin-sized item tracker that works on Find My, with a replaceable battery and a leather keyring loop.',
    specs: { 'Battery': '12 months, CR2032 replaceable', 'Range': 'Find My network', 'Water rating': 'IP67' },
  },
  {
    slug: 'gallery-clutch-charger',
    name: 'Gallery Travel Clutch',
    brand: 'Folio',
    category: 'Accessories',
    collection: 'accessories',
    price: 14000,
    available: 12,
    image: img('clutch', 'accessories'),
    blurb: 'A flat leather clutch that holds a passport, two phones, a 65 W GaN charger, and three cables in dedicated loops.',
    specs: { 'Capacity': 'Passport + 2 phones + GaN + 3 cables', 'Material': 'Leather + recycled felt' },
  },
  {
    slug: 'compass-dock',
    name: 'Compass 3-in-1 Charger',
    brand: 'Lighthouse',
    category: 'Accessories',
    collection: 'accessories',
    price: 11000,
    available: 28,
    image: img('dock', 'accessories'),
    blurb: 'Folding three-coil charger for phone, watch, and earbuds. The hinge clicks shut into a pocket-sized puck.',
    specs: { 'Output': 'Phone 15 W + Watch + Earbuds', 'Footprint folded': '80 × 80 × 22 mm' },
  },
  {
    slug: 'mantle-keyboard-stand',
    name: 'Mantle Keyboard Stand',
    brand: 'Switchsmith',
    category: 'Accessories',
    collection: 'accessories',
    price: 4800,
    available: 41,
    image: img('stand', 'accessories'),
    blurb: 'A solid-walnut tray that lifts your keyboard 7 degrees and leaves your wrists honest.',
    specs: { 'Material': 'Solid walnut', 'Angle': '7°', 'Fits': 'Up to 60% / 65% / 75%' },
  },
  {
    slug: 'beacon-cable-pack',
    name: 'Beacon Braided Cables (3)',
    brand: 'Lighthouse',
    category: 'Accessories',
    collection: 'accessories',
    price: 2400,
    available: 88,
    image: img('cables', 'accessories'),
    blurb: 'A 1 m + 1 m + 2 m USB-C cable set in braided cotton. 240 W rated, with leather ties.',
    specs: { 'Rating': 'USB-PD 240 W', 'Data': 'USB 2.0 high-speed', 'Lengths': '1 m × 2 + 2 m' },
  },
  {
    slug: 'kiln-ear-tips-set',
    name: 'Kiln Ear-Tips Set',
    brand: 'Marrow',
    category: 'Accessories',
    collection: 'accessories',
    price: 1800,
    available: 120,
    image: img('eartips', 'accessories'),
    blurb: 'Twelve pairs of foam, silicone, and hybrid ear-tips in a labelled card. Goodbye loose seal.',
    specs: { 'Sizes': 'XS / S / M / L', 'Materials': 'Memory foam, silicone, hybrid' },
  },

  // ── A couple of "future" / hero products ───────────────────
  {
    slug: 'orbit-ar-glasses',
    name: 'Orbit AR Glasses',
    brand: 'Halcyon',
    category: 'Wearables',
    collection: 'accessories',
    price: 168000,
    available: 3,
    image: img('glasses', 'accessories'),
    blurb: 'A pair of lightweight AR glasses with a 50-degree field of view and tethered compute over USB-C.',
    specs: { 'Field of view': '50° diagonal', 'Brightness': '4000 nits', 'Weight': '79 g' },
  },
  {
    slug: 'tide-collar-headphones',
    name: 'Tide Collar Headphones',
    brand: 'Marrow',
    category: 'Headphones',
    collection: 'audio',
    price: 8800,
    available: 36,
    image: img('neckband', 'audio'),
    blurb: 'A neckband-style wireless headphone for runners. Twenty-two hour battery, IP67, magnetic earbuds.',
    specs: { 'Battery': '22 h', 'Rating': 'IP67', 'Weight': '34 g' },
  },
  {
    slug: 'pebble-watch-7',
    name: 'Pebble Watch 7',
    brand: 'Halcyon',
    category: 'Wearables',
    collection: 'accessories',
    price: 32000,
    available: 22,
    image: img('watch', 'accessories'),
    blurb: 'An e-paper smartwatch with a two-week battery and a steel case the size of a quarter.',
    specs: { 'Display': '1.5" e-paper', 'Battery': '14 days', 'Case': '316L stainless' },
  },
]

/** Collection metadata used by Home + Catalog. */
export const COLLECTIONS: {
  slug: Collection
  label: string
  blurb: string
  tone: string                // matches fl-pill data-tone values
  cssVar: string              // matches CSS custom property
}[] = [
  { slug: 'laptops',      label: 'Laptops & Desktops', blurb: 'Computers tuned for editorial, studio, and field work.', tone: 'replastic', cssVar: '--color-replastic' },
  { slug: 'audio',        label: 'Audio',              blurb: 'Headphones, IEMs, and speakers from independent makers.', tone: 'nature',    cssVar: '--color-nature' },
  { slug: 'gaming',       label: 'Gaming',             blurb: 'Keyboards, mice, monitors, and consoles for the long haul.', tone: 'urban',  cssVar: '--color-urban' },
  { slug: 'smart-home',   label: 'Smart Home',         blurb: 'Thermostats, doorbells, and lights — quiet, local, Matter-ready.', tone: 'golf', cssVar: '--color-golf' },
  { slug: 'accessories',  label: 'Accessories',        blurb: 'The leather, the cables, the cases. Built to last.',         tone: 'details',  cssVar: '--color-details' },
]

export const MOCK_BRANDS = ['Northwind', 'Halcyon', 'Lighthouse', 'Marrow', 'Folio', 'Switchsmith', 'Pixelarc', 'Glow']

/** Convert a Seed into the shape served by `/api/v1/products`. */
function toListItem(s: Seed): ProductListItem {
  return {
    id: s.slug,
    sku: `${s.brand.slice(0, 3).toUpperCase()}-${s.slug.toUpperCase()}`,
    slug: s.slug,
    name: s.name,
    brand: s.brand,
    category: s.category,
    specs: s.specs,
    completeness_score: 0.95,
    primary_image: s.image,
    min_price: s.price,
    available: s.available,
    status: 'active',
  }
}

/** Convert a Seed into the shape served by `/api/v1/products/:slug`. */
function toDetail(s: Seed): ProductDetail {
  const offer: OfferOut = {
    id: `${s.slug}-offer`,
    variant_sku: `${s.slug.toUpperCase()}-DEFAULT`,
    variant_attrs: {},
    retail_price: s.price,
    sale_price: null,
    currency: 'DZD',
    available: s.available,
    stock_quantity: s.available,
    is_active: true,
  }
  const media: MediaItem[] = (s.gallery ?? [s.image]).map((url, i) => ({
    id: `${s.slug}-m${i}`,
    url,
    kind: 'image',
    is_primary: i === 0,
    alt: s.name,
    position: i,
  }))
  return {
    ...toListItem(s),
    model: s.model ?? null,
    subcategory: null,
    description: s.blurb,
    status: 'active',
    updated_at: new Date().toISOString(),
    barcode: null,
    mpn: s.model ?? null,
    offers: [offer],
    media,
  }
}

export const MOCK_LIST: ProductListItem[] = SEEDS.map(toListItem)
export const MOCK_DETAILS: Record<string, ProductDetail> = Object.fromEntries(
  SEEDS.map(s => [s.slug, toDetail(s)]),
)
export const MOCK_SEEDS = SEEDS

// ── List / filter / search helpers ────────────────────────────
export function mockCategories(): { items: CategoryItem[]; total: number } {
  const counts = new Map<string, number>()
  for (const p of MOCK_LIST) {
    if (!p.category) continue
    counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  }
  const items = Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
  return { items, total: items.length }
}

export function mockBrands(): { items: BrandItem[] } {
  const counts = new Map<string, number>()
  for (const p of MOCK_LIST) {
    if (!p.brand) continue
    counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1)
  }
  return {
    items: Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  }
}

export function mockPriceBounds(): PriceBounds {
  const prices = MOCK_LIST.map(p => p.min_price ?? 0).filter(Boolean)
  return { min: Math.min(...prices), max: Math.max(...prices) }
}

export function mockFeatured(limit = 12): { items: ProductListItem[] } {
  return { items: MOCK_LIST.slice(0, limit) }
}

const COLLECTION_SLUGS = new Set<string>(COLLECTIONS.map(c => c.slug))
const SLUG_BY_SEED = new Map<string, Collection>(SEEDS.map(s => [s.slug, s.collection]))

export function mockProducts(params: Record<string, any>): ProductListResult {
  const page = Math.max(1, Number(params.page ?? 1))
  const pageSize = Math.max(1, Math.min(60, Number(params.page_size ?? 24)))
  const q = String(params.q ?? '').trim().toLowerCase()
  const cat = String(params.category ?? '').trim().toLowerCase()
  const brand = String(params.brand ?? '').trim().toLowerCase()
  const sort = String(params.sort ?? '')
  const min = params.price_min != null ? Number(params.price_min) : null
  const max = params.price_max != null ? Number(params.price_max) : null

  let items = MOCK_LIST.slice()
  if (q && q !== 'all') {
    items = items.filter(p =>
      [p.name, p.brand, p.category, p.sku].some(v => v && String(v).toLowerCase().includes(q)),
    )
  }
  if (cat && cat !== 'all') {
    if (COLLECTION_SLUGS.has(cat)) {
      // Treat as a collection (e.g. `audio` → all Headphones / Earbuds / Speakers)
      items = items.filter(p => SLUG_BY_SEED.get(p.slug) === cat)
    } else {
      items = items.filter(p => p.category?.toLowerCase() === cat)
    }
  }
  if (brand) items = items.filter(p => p.brand?.toLowerCase() === brand)
  if (min != null) items = items.filter(p => (p.min_price ?? 0) >= min)
  if (max != null) items = items.filter(p => (p.min_price ?? 0) <= max)

  switch (sort) {
    case 'price_asc':  items.sort((a, b) => (a.min_price ?? 0) - (b.min_price ?? 0)); break
    case 'price_desc': items.sort((a, b) => (b.min_price ?? 0) - (a.min_price ?? 0)); break
    case 'name_asc':   items.sort((a, b) => a.name.localeCompare(b.name)); break
    default: break
  }

  const total = items.length
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), page, page_size: pageSize, total }
}

export function mockProduct(idOrSlug: string): ProductDetail | null {
  return MOCK_DETAILS[idOrSlug] ?? MOCK_LIST.find(p => p.id === idOrSlug)?.slug
    ? MOCK_DETAILS[MOCK_LIST.find(p => p.id === idOrSlug)!.slug]
    : null
}
