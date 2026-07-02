import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Blunderbored',
    short_name: 'Blunderbored',
    description: 'Chess analysis board, trainers, and tools — works offline.',
    start_url: '/',
    display: 'standalone',
    // Match the logo artwork bg (public/icon-*.png) so the splash blends seamlessly.
    background_color: '#030919',
    theme_color: '#030919',
    // No `orientation` field: the installed PWA follows the device's own
    // rotation setting instead of force-rotating to landscape ('any' opts
    // out of the OS rotation lock on Android).
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
