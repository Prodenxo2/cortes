import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O processamento pesado roda no worker (processo separado), não no Next.
  // Estes pacotes só rodam no servidor e não devem ser empacotados.
  serverExternalPackages: ["@prisma/client", "@google/genai"],
};

export default nextConfig;
