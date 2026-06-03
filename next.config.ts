import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'unspoiled-prancing-resisting.ngrok-free.dev',
    '192.168.110.202',
  ],
  async headers() {
    return [
      {
        // Engine wasm lives at /engine/*.wasm — serve it with the correct MIME
        // type so WebAssembly.instantiateStreaming works.
        source: "/engine/:path*.wasm",
        headers: [
          {
            key: "Content-Type",
            value: "application/wasm",
          },
        ],
      },
      {
        // The vendored Stockfish files never change — cache them aggressively.
        source: "/engine/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        // The service worker must always be revalidated so updates ship.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
