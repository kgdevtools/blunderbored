import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    'unspoiled-prancing-resisting.ngrok-free.dev',
  ],
  async headers() {
    return [
      {
        source: "/stockfish/:path*.wasm",
        headers: [
          {
            key: "Content-Type",
            value: "application/wasm",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
