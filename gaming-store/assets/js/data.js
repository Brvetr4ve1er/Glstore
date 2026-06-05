/* =================================================================
   GLAIVE — catalog data + inline SVG art library
   Self-contained: no external images, no copyrighted assets.
   Product silhouettes are original abstract SVGs per category.
   ================================================================= */

/* ---- SVG art per product archetype (original line-art) ---- */
const ART = {
  headset: `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M40 110V96a60 60 0 0 1 120 0v14" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
    <rect x="28" y="104" width="34" height="56" rx="14" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <rect x="138" y="104" width="34" height="56" rx="14" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <rect x="36" y="116" width="18" height="32" rx="9" fill="var(--c-brand)"/>
    <rect x="146" y="116" width="18" height="32" rx="9" fill="var(--c-brand)"/>
    <path d="M62 150v8a18 18 0 0 0 18 18h26" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>
    <circle cx="112" cy="176" r="6" fill="var(--c-brand)"/>
  </svg>`,
  mouse: `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="62" y="34" width="76" height="132" rx="38" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <path d="M100 34v52" stroke="currentColor" stroke-width="5"/>
    <rect x="92" y="50" width="16" height="26" rx="8" fill="var(--c-brand)"/>
    <path d="M62 86c12 6 64 6 76 0" stroke="currentColor" stroke-width="4" opacity=".5"/>
    <circle cx="100" cy="120" r="5" fill="var(--c-brand)"/>
  </svg>`,
  keyboard: `<svg viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="20" y="64" width="180" height="92" rx="12" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    ${[0,1,2].map(r=>[0,1,2,3,4,5,6,7,8,9].map(c=>`<rect x="${34+c*16}" y="${78+r*22}" width="11" height="11" rx="2" fill="${(r===2&&c>1&&c<8)?'var(--c-brand)':'#2a2a2f'}"/>`).join('')).join('')}
    <rect x="66" y="144" width="88" height="9" rx="3" fill="#2a2a2f"/>
  </svg>`,
  mousepad: `<svg viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="24" y="58" width="172" height="104" rx="10" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <rect x="24" y="58" width="172" height="104" rx="10" fill="url(#g)" opacity=".25"/>
    <path d="M24 150h172" stroke="var(--c-brand)" stroke-width="6"/>
    <defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="var(--c-brand)"/><stop offset="1" stop-color="transparent"/></linearGradient></defs>
  </svg>`,
  controller: `<svg viewBox="0 0 220 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M70 78h80c26 0 38 22 44 52 5 24-14 34-28 22l-16-14H70l-16 14c-14 12-33 2-28-22 6-30 18-52 44-52Z" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <circle cx="84" cy="112" r="9" fill="var(--c-brand)"/>
    <circle cx="140" cy="112" r="9" fill="#2a2a2f"/><circle cx="158" cy="112" r="9" fill="#2a2a2f"/>
    <rect x="76" y="106" width="6" height="18" rx="2" fill="currentColor" transform="translate(-8 -3)"/>
  </svg>`,
  accessory: `<svg viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="100" cy="100" r="58" fill="#18181b" stroke="currentColor" stroke-width="6"/>
    <circle cx="100" cy="100" r="26" fill="none" stroke="var(--c-brand)" stroke-width="6"/>
    <circle cx="100" cy="100" r="6" fill="var(--c-brand)"/>
  </svg>`,
};

/* ---- UI icons ---- */
const ICON = {
  search: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`,
  user: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  cart: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.4 12.2a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L23 7H6"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.3-10-10A5 5 0 0 1 12 6a5 5 0 0 1 10 5c-2 4.7-10 10-10 10Z"/></svg>`,
  menu: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>`,
  ship: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/></svg>`,
  headphones: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="7" rx="2"/><rect x="17" y="14" width="4" height="7" rx="2"/></svg>`,
  cpu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>`,
  bolt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M18 2h3l-7.5 8.6L22 22h-6.8l-5-6.6L4.4 22H1.3l8-9.2L2 2h7l4.5 6zM16.8 20h1.7L7.3 4H5.5z"/></svg>`,
  youtube: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23 12s0-3.5-.4-5a3 3 0 0 0-2-2C18.7 4.5 12 4.5 12 4.5s-6.7 0-8.6.5a3 3 0 0 0-2 2C1 8.5 1 12 1 12s0 3.5.4 5a3 3 0 0 0 2 2c1.9.5 8.6.5 8.6.5s6.7 0 8.6-.5a3 3 0 0 0 2-2c.4-1.5.4-5 .4-5ZM10 15.5v-7l6 3.5z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  twitch: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M4 2 3 6v13h4v3h3l3-3h4l5-5V2zm15 11-3 3h-4l-3 3v-3H6V4h13zM14 7h2v5h-2zm-5 0h2v5H9z"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  check: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  heartFill: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 21s-8-5.3-10-10A5 5 0 0 1 12 6a5 5 0 0 1 10 5c-2 4.7-10 10-10 10Z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
};

/* ---- Product catalog ---- */
const PRODUCTS = [
  // Headsets
  { id:'arctis-nova-elite', name:'Arctis Nova Elite', cat:'Headsets', type:'headset', price:599.99, rating:4.9, reviews:212, badge:'New',
    blurb:'The world’s first Hi-Res Wireless certified gaming headset. Audiophile-grade 40mm carbon-fiber drivers and a hot-swappable battery base station.',
    tag:['wireless','flagship'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Drivers':'40mm Carbon Fiber', 'Connection':'2.4GHz + Bluetooth 5.3', 'Frequency':'10–40,000 Hz', 'Battery':'Hot-swap dual cell', 'Mic':'ClearCast Gen 3 AI', 'Weight':'330 g' } },
  { id:'arctis-nova-7-gen2', name:'Arctis Nova 7 Gen 2', cat:'Headsets', type:'headset', price:179.99, rating:4.8, reviews:540, badge:'Best Seller',
    blurb:'Multiplatform wireless with 54 hours of battery and simultaneous 2.4GHz + Bluetooth. Plays everywhere — PC, PlayStation, Xbox, Switch.',
    tag:['wireless'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Drivers':'40mm Neodymium', 'Connection':'2.4GHz + Bluetooth', 'Battery':'54 hours', 'Mic':'ClearCast Gen 2', 'Platforms':'PC/PS/Xbox/Switch', 'Weight':'325 g' } },
  { id:'arctis-nova-pro-wireless', name:'Arctis Nova Pro Wireless', cat:'Headsets', type:'headset', price:349.99, sale:299.99, rating:4.7, reviews:1820, badge:'',
    blurb:'Infinity power system with two hot-swap batteries — never stop playing. Active noise cancellation and a GameDAC base station.',
    tag:['wireless','anc'], colors:['#0a0a0b'],
    specs:{ 'Drivers':'40mm High Fidelity', 'ANC':'Active + Transparency', 'Battery':'Infinity hot-swap', 'DAC':'GameDAC Gen 2', 'Weight':'338 g' } },
  { id:'arctis-nova-3', name:'Arctis Nova 3', cat:'Headsets', type:'headset', price:99.99, rating:4.6, reviews:760, badge:'',
    blurb:'Lightweight wired esports comfort with 360° Spatial Audio and a retractable noise-cancelling mic.',
    tag:['wired'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Drivers':'40mm Neodymium', 'Connection':'USB-C / 3.5mm', 'Audio':'360° Spatial', 'Mic':'Retractable ClearCast', 'Weight':'253 g' } },

  // Mice
  { id:'aerox-3-wireless-gen2', name:'Aerox 3 Wireless Gen 2', cat:'Mice', type:'mouse', price:99.99, rating:4.7, reviews:430, badge:'New',
    blurb:'Ultralight 66g honeycomb shell with a blazing 4000Hz polling rate and AquaBarrier water resistance.',
    tag:['wireless','lightweight'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Sensor':'TrueMove Air 18,000 CPI', 'Polling':'4000 Hz', 'Weight':'66 g', 'Switches':'Golden Micro IP54', 'Battery':'200 hours', 'Connection':'2.4GHz + Bluetooth' } },
  { id:'rival-3-gen5', name:'Rival 3 Gen 5', cat:'Mice', type:'mouse', price:39.99, sale:29.99, rating:4.5, reviews:980, badge:'',
    blurb:'Best-in-class value. Precision optical sensor, 80M-click switches and Prism RGB — the workhorse that started a rivalry.',
    tag:['wired'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Sensor':'TrueMove Core 8,500 CPI', 'Switches':'80M clicks', 'Weight':'77 g', 'RGB':'3-zone Prism', 'Connection':'Wired USB' } },
  { id:'prime-wireless', name:'Prime Wireless', cat:'Mice', type:'mouse', price:129.99, rating:4.8, reviews:355, badge:'Pro',
    blurb:'Built with and for esports pros. Prestige OM optical switches and Quantum 2.0 dual wireless for zero-compromise latency.',
    tag:['wireless','pro'], colors:['#0a0a0b'],
    specs:{ 'Sensor':'TrueMove Pro 18,000 CPI', 'Switches':'Prestige OM Optical', 'Weight':'80 g', 'Wireless':'Quantum 2.0', 'Battery':'100 hours' } },

  // Keyboards
  { id:'apex-pro-tkl-gen3', name:'Apex Pro TKL Gen 3', cat:'Keyboards', type:'keyboard', price:249.99, rating:4.9, reviews:610, badge:'New',
    blurb:'Adjustable OmniPoint 3.0 magnetic switches with Rapid Trigger, per-key actuation and an 8000Hz Quantum 2.0 wireless option.',
    tag:['mechanical','rapid-trigger'], colors:['#0a0a0b','#e8e8ea'],
    specs:{ 'Switches':'OmniPoint 3.0 Magnetic', 'Actuation':'0.1–4.0 mm adjustable', 'Polling':'8000 Hz', 'Display':'OLED Smart Display', 'Form':'Tenkeyless', 'Build':'Aircraft aluminum' } },
  { id:'apex-pro-mini', name:'Apex Pro Mini Gen 3', cat:'Keyboards', type:'keyboard', price:199.99, rating:4.7, reviews:288, badge:'',
    blurb:'60% competitive form factor with adjustable magnetic switches and Protection Mode — pure speed, minimal footprint.',
    tag:['mechanical','60%'], colors:['#0a0a0b'],
    specs:{ 'Switches':'OmniPoint 2.0 Magnetic', 'Actuation':'0.2–3.8 mm', 'Form':'60%', 'Polling':'1000 Hz', 'Keycaps':'Double-shot PBT' } },
  { id:'apex-3-tkl', name:'Apex 3 TKL', cat:'Keyboards', type:'keyboard', price:49.99, sale:39.99, rating:4.5, reviews:1120, badge:'',
    blurb:'Whisper-quiet gaming switches, 10-zone RGB and IP32 water resistance at an unbeatable entry price.',
    tag:['membrane'], colors:['#0a0a0b'],
    specs:{ 'Switches':'Whisper-Quiet Gaming', 'RGB':'10-zone', 'Resistance':'IP32 water', 'Form':'Tenkeyless', 'Cable':'Detachable' } },

  // Mousepads
  { id:'qck-heavy', name:'QcK Heavy', cat:'Mousepads', type:'mousepad', price:24.99, rating:4.9, reviews:5400, badge:'Best Seller',
    blurb:'The pro standard. Thick 6mm micro-woven cloth for a stable surface and pixel-precise tracking on any desk.',
    tag:['cloth'], colors:['#0a0a0b'],
    specs:{ 'Surface':'Micro-woven cloth', 'Thickness':'6 mm', 'Base':'Non-slip rubber', 'Sizes':'M / L / XXL' } },
  { id:'qck-prism-xl', name:'QcK Prism XL', cat:'Mousepads', type:'mousepad', price:59.99, sale:49.99, rating:4.8, reviews:920, badge:'',
    blurb:'Two-zone reactive RGB illumination synced to your game, with a dual-surface cloth top for control and speed.',
    tag:['rgb'], colors:['#0a0a0b'],
    specs:{ 'Surface':'Dual textured cloth', 'RGB':'2-zone reactive', 'Size':'900×300 mm', 'Sync':'GameSense' } },

  // Controllers
  { id:'stratus-plus', name:'Stratus+', cat:'Controllers', type:'controller', price:69.99, rating:4.6, reviews:410, badge:'',
    blurb:'Premium wireless controller for Android, PC and cloud gaming with hall-effect triggers and 90+ hours of play.',
    tag:['wireless'], colors:['#0a0a0b'],
    specs:{ 'Connection':'Bluetooth + 2.4GHz', 'Triggers':'Hall-effect', 'Battery':'90+ hours', 'Platforms':'Android/PC/Cloud' } },

  // Accessories
  { id:'gamedac-gen2', name:'GameDAC Gen 2', cat:'Accessories', type:'accessory', price:129.99, rating:4.7, reviews:240, badge:'',
    blurb:'Certified Hi-Res ESS Sabre DAC delivering 96kHz/24-bit audio with a hardware EQ and ChatMix dial.',
    tag:['audio'], colors:['#0a0a0b'],
    specs:{ 'DAC':'ESS Sabre Hi-Res', 'Audio':'96kHz/24-bit', 'Controls':'ChatMix + EQ', 'Connection':'USB-C' } },
  { id:'booster-pack', name:'Aerox Booster Pack', cat:'Accessories', type:'accessory', price:19.99, rating:4.4, reviews:160, badge:'',
    blurb:'Grip tape, PTFE glide skates and a USB-C charging dongle to keep your Aerox flying.',
    tag:['grip'], colors:['#0a0a0b'],
    specs:{ 'Includes':'Grip tape + skates', 'Skates':'100% PTFE', 'Compatibility':'Aerox series' } },
];

/* ---- Category metadata for the homepage rail ---- */
const CATEGORIES = [
  { name:'Headsets',    type:'headset',    tagline:'Hear everything' },
  { name:'Keyboards',   type:'keyboard',   tagline:'Adjustable speed' },
  { name:'Mice',        type:'mouse',      tagline:'Win lighter' },
  { name:'Mousepads',   type:'mousepad',   tagline:'Pro surfaces' },
  { name:'Controllers', type:'controller', tagline:'Play anywhere' },
  { name:'Accessories', type:'accessory',  tagline:'Level up' },
];

/* ---- Review snippets (synthesised UGC pool for PDP social proof) ---- */
const REVIEWS = [
  { n:'Karim B.', r:5, t:'Best purchase for my setup', b:'Build quality is insane and it just works out of the box. Genuinely competition-grade.' },
  { n:'Lina M.', r:5, t:'Worth every dinar', b:'Comfortable for 6-hour sessions and the software is actually useful, not bloatware.' },
  { n:'Yacine D.', r:4, t:'Great, minor nitpick', b:'Performance is elite. Took a star off because I wish the cable was a touch longer.' },
  { n:'Sara K.', r:5, t:'My aim improved overnight', b:'Lightweight and precise. Teammates noticed the difference in ranked immediately.' },
  { n:'Omar T.', r:5, t:'Pro-level for half the price', b:'Compared it to gear twice the cost and honestly could not tell the difference.' },
  { n:'Nadia R.', r:4, t:'Solid daily driver', b:'Looks clean on the desk and the RGB is tasteful. Battery lasts me a full week.' },
];

/* ---- Shipping zones (Algeria wilayas — mirrors the Ghir Laffaire order model) ---- */
const WILAYAS = [
  'Alger', 'Oran', 'Constantine', 'Annaba', 'Blida', 'Batna', 'Sétif', 'Tizi Ouzou',
  'Béjaïa', 'Tlemcen', 'Djelfa', 'Sidi Bel Abbès', 'Biskra', 'Tébessa', 'Ouargla',
  'Skikda', 'Mostaganem', 'Bordj Bou Arréridj', 'Chlef', 'Médéa', 'Ghardaïa', 'Tipaza',
];

if (typeof window !== 'undefined') { window.GLAIVE = { ART, ICON, PRODUCTS, CATEGORIES, WILAYAS, REVIEWS }; }
