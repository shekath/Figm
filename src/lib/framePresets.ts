/** Device and format frame presets (points / CSS px), similar in spirit to common design-tool presets. */
export interface FramePreset { name: string; w: number; h: number }
export interface PresetGroup { name: string; items: FramePreset[] }

export const FRAME_PRESETS: PresetGroup[] = [
  {
    name: 'Phone',
    items: [
      { name: 'iPhone 17 Pro Max', w: 440, h: 956 },
      { name: 'iPhone 17 Pro', w: 402, h: 874 },
      { name: 'iPhone 17', w: 402, h: 874 },
      { name: 'iPhone Air', w: 420, h: 912 },
      { name: 'iPhone 16e', w: 390, h: 844 },
      { name: 'iPhone 16 Plus', w: 430, h: 932 },
      { name: 'iPhone 16', w: 393, h: 852 },
      { name: 'iPhone SE', w: 375, h: 667 },
      { name: 'Google Pixel 10 Pro XL', w: 412, h: 921 },
      { name: 'Google Pixel 10 Pro', w: 410, h: 914 },
      { name: 'Google Pixel 10', w: 412, h: 923 },
      { name: 'Samsung Galaxy S25 Ultra', w: 412, h: 891 },
      { name: 'Samsung Galaxy S25', w: 360, h: 780 },
      { name: 'Galaxy Z Fold7 (folded)', w: 360, h: 884 },
      { name: 'Galaxy Z Fold7 (open)', w: 720, h: 805 },
      { name: 'Galaxy Z Flip7', w: 360, h: 880 },
      { name: 'Android Compact', w: 412, h: 917 },
      { name: 'Android Medium', w: 700, h: 840 },
    ],
  },
  {
    name: 'Tablet',
    items: [
      { name: 'iPad Pro 13"', w: 1032, h: 1376 },
      { name: 'iPad Pro 11"', w: 834, h: 1210 },
      { name: 'iPad Air 13"', w: 1024, h: 1366 },
      { name: 'iPad Air 11"', w: 820, h: 1180 },
      { name: 'iPad 11"', w: 820, h: 1180 },
      { name: 'iPad mini', w: 744, h: 1133 },
      { name: 'Galaxy Tab S10 Ultra', w: 924, h: 1480 },
      { name: 'Surface Pro 11', w: 1440, h: 960 },
      { name: 'Android Expanded', w: 1280, h: 800 },
    ],
  },
  {
    name: 'Desktop',
    items: [
      { name: 'Desktop', w: 1440, h: 1024 },
      { name: 'Desktop HD', w: 1920, h: 1080 },
      { name: 'MacBook Air 13"', w: 1280, h: 832 },
      { name: 'MacBook Air 15"', w: 1440, h: 932 },
      { name: 'MacBook Pro 14"', w: 1512, h: 982 },
      { name: 'MacBook Pro 16"', w: 1728, h: 1117 },
      { name: 'iMac 24"', w: 2240, h: 1260 },
      { name: 'Surface Laptop', w: 1504, h: 1003 },
      { name: 'Wide (1366)', w: 1366, h: 768 },
      { name: 'TV', w: 1280, h: 720 },
      { name: 'Wireframe', w: 1440, h: 1024 },
    ],
  },
  {
    name: 'Watch',
    items: [
      { name: 'Apple Watch Ultra 3', w: 205, h: 251 },
      { name: 'Apple Watch Series 11 46mm', w: 208, h: 248 },
      { name: 'Apple Watch Series 11 42mm', w: 187, h: 223 },
      { name: 'Apple Watch SE 44mm', w: 184, h: 224 },
      { name: 'Wear OS (round)', w: 227, h: 227 },
    ],
  },
  {
    name: 'Presentation',
    items: [
      { name: 'Slide 16:9', w: 1920, h: 1080 },
      { name: 'Slide 4:3', w: 1024, h: 768 },
    ],
  },
  {
    name: 'Social media',
    items: [
      { name: 'Instagram post (4:5)', w: 1080, h: 1350 },
      { name: 'Instagram post (square)', w: 1080, h: 1080 },
      { name: 'Instagram / TikTok story', w: 1080, h: 1920 },
      { name: 'X post', w: 1200, h: 675 },
      { name: 'X header', w: 1500, h: 500 },
      { name: 'Facebook post', w: 1200, h: 630 },
      { name: 'Facebook cover', w: 1640, h: 624 },
      { name: 'LinkedIn post', w: 1200, h: 627 },
      { name: 'LinkedIn banner', w: 1584, h: 396 },
      { name: 'YouTube thumbnail', w: 1280, h: 720 },
      { name: 'YouTube banner', w: 2560, h: 1440 },
      { name: 'Dribbble shot', w: 1600, h: 1200 },
    ],
  },
  {
    name: 'Paper',
    items: [
      { name: 'A4', w: 595, h: 842 },
      { name: 'A5', w: 420, h: 595 },
      { name: 'A6', w: 297, h: 420 },
      { name: 'Letter', w: 612, h: 792 },
      { name: 'Legal', w: 612, h: 1008 },
      { name: 'Tabloid', w: 792, h: 1224 },
    ],
  },
];

export function matchPreset(w: number, h: number): { group: string; preset: FramePreset; landscape: boolean } | null {
  for (const g of FRAME_PRESETS)
    for (const p of g.items) {
      if (Math.round(w) === p.w && Math.round(h) === p.h) return { group: g.name, preset: p, landscape: false };
      if (Math.round(w) === p.h && Math.round(h) === p.w) return { group: g.name, preset: p, landscape: true };
    }
  return null;
}
