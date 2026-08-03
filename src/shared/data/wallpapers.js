/**
 * Wallpaper presets, in one place.
 *
 * These URLs were previously copy-pasted into four files: the settings picker
 * held the full catalogue, the onboarding tour held a hand-copied prefix of it
 * ("the first 8 of the 40 curated wallpapers in ThemesTab", said its comment),
 * and both app roots held their own flat rotation list. Adding or reordering a
 * wallpaper meant remembering all four.
 *
 * They are plain Unsplash CDN links — no API key, no request — so they work on
 * first run and get browser-cached after the first load.
 */

/**
 * The full picker catalogue: 40 entries with display metadata.
 * `url` is the 4K image; `thumbnail` is the small preview.
 */
export const WALLPAPER_CATALOG = [
  {
    id: 1,
    name: 'Misty Valley',
    url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=400&q=80',
    category: 'nature'
  },
  {
    id: 2,
    name: 'Northern Lights',
    url: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=400&q=80',
    category: 'space'
  },
  {
    id: 3,
    name: 'Starry Sky',
    url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=400&q=80',
    category: 'space'
  },
  {
    id: 4,
    name: 'Mountain Sunset',
    url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 5,
    name: 'Dark Cosmos',
    url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80',
    category: 'space'
  },
  {
    id: 6,
    name: 'Enchanted Forest',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&q=80',
    category: 'forest'
  },
  {
    id: 7,
    name: 'Minimal Workspace',
    url: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=400&q=80',
    category: 'minimal'
  },
  {
    id: 8,
    name: 'Mountain Mirror',
    url: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 9,
    name: 'Sunlit Forest',
    url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80',
    category: 'forest'
  },
  {
    id: 10,
    name: 'Foggy Pines',
    url: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?w=400&q=80',
    category: 'forest'
  },
  {
    id: 11,
    name: 'Alpine Lake',
    url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 12,
    name: 'Green Mountains',
    url: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 13,
    name: 'Forest Trail',
    url: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1447752875215-b2761acb3c5d?w=400&q=80',
    category: 'forest'
  },
  {
    id: 14,
    name: 'Rolling Hills',
    url: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1472214103451-9374bd1c798e?w=400&q=80',
    category: 'nature'
  },
  {
    id: 15,
    name: 'Valley River',
    url: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?w=400&q=80',
    category: 'nature'
  },
  {
    id: 16,
    name: 'Mountain Wanderer',
    url: 'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1497436072909-60f360e1d4b1?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 17,
    name: 'Ocean Waves',
    url: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?w=400&q=80',
    category: 'ocean'
  },
  {
    id: 18,
    name: 'Snowy Peaks',
    url: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1500534623283-312aade485b7?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 19,
    name: 'Waterfall Bridge',
    url: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=400&q=80',
    category: 'nature'
  },
  {
    id: 20,
    name: 'Blue Planet',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&q=80',
    category: 'space'
  },
  {
    id: 21,
    name: 'Milky Way',
    url: 'https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=400&q=80',
    category: 'space'
  },
  {
    id: 22,
    name: 'Tropical Beach',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=80',
    category: 'ocean'
  },
  {
    id: 23,
    name: 'City Heights',
    url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=400&q=80',
    category: 'urban'
  },
  {
    id: 24,
    name: 'Manhattan Nights',
    url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=400&q=80',
    category: 'urban'
  },
  {
    id: 25,
    name: 'City Aerial',
    url: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=400&q=80',
    category: 'urban'
  },
  {
    id: 26,
    name: 'Mirror Lake',
    url: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?w=400&q=80',
    category: 'mountains'
  },
  {
    id: 27,
    name: 'Highland',
    url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&q=80',
    category: 'nature'
  },
  {
    id: 28,
    name: 'Winter Night',
    url: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=400&q=80',
    category: 'space'
  },
  {
    id: 29,
    name: 'Coastal Cliffs',
    url: 'https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?w=400&q=80',
    category: 'ocean'
  },
  {
    id: 30,
    name: 'Serene Lake',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=400&q=80',
    category: 'nature'
  },
  {
    id: 31,
    name: 'Golden Leaves',
    url: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&q=80',
    category: 'nature'
  },
  {
    id: 32,
    name: 'Color Flow',
    url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=400&q=80',
    category: 'abstract'
  },
  {
    id: 33,
    name: 'Starlit Sky',
    url: 'https://images.unsplash.com/photo-1454372182658-c712e4c5a1db?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1454372182658-c712e4c5a1db?w=400&q=80',
    category: 'space'
  },
  {
    id: 34,
    name: 'Redwood Canopy',
    url: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1502082553048-f009c37129b9?w=400&q=80',
    category: 'forest'
  },
  {
    id: 35,
    name: 'Misty Woods',
    url: 'https://images.unsplash.com/photo-1470004914212-05527e49370b?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470004914212-05527e49370b?w=400&q=80',
    category: 'forest'
  },
  {
    id: 36,
    name: 'Open Sea',
    url: 'https://images.unsplash.com/photo-1444464666168-49d633b86797?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1444464666168-49d633b86797?w=400&q=80',
    category: 'ocean'
  },
  {
    id: 37,
    name: 'Cosmic Night',
    url: 'https://images.unsplash.com/photo-1470813740244-df37b8c1edcb?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1470813740244-df37b8c1edcb?w=400&q=80',
    category: 'space'
  },
  {
    id: 38,
    name: 'Aspen Grove',
    url: 'https://images.unsplash.com/photo-1441716844725-09cedc13a4e7?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1441716844725-09cedc13a4e7?w=400&q=80',
    category: 'forest'
  },
  {
    id: 39,
    name: 'Abstract Waves',
    url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=400&q=80',
    category: 'abstract'
  },
  {
    id: 40,
    name: 'Enchanted Woods',
    url: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?w=3840&q=90&fm=jpg',
    thumbnail: 'https://images.unsplash.com/photo-1523712999610-f77fbcfc3843?w=400&q=80',
    category: 'forest'
  },];

/** First N catalogue entries — what the onboarding tour offers. */
export const onboardingWallpapers = (n = 8) => WALLPAPER_CATALOG.slice(0, n);

/**
 * The rotation pool the app roots shuffle through for "random wallpaper".
 * Deliberately its own list rather than a slice of the catalogue: two of these
 * (`photo-1514565131…`, `photo-1557683316…`) are not in the picker at all.
 */
export const CURATED_WALLPAPER_URLS = [
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1483347756197-71ef80e95f73?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1448375240586-882707db888b?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1557683316-973673baf926?w=3840&q=90&fm=jpg',
  'https://images.unsplash.com/photo-1470770841072-f978cf4d019e?w=3840&q=90&fm=jpg',
];

/** Default wallpaper shown before the user picks one. */
export const DEFAULT_WALLPAPER_URL = WALLPAPER_CATALOG[0].url;
