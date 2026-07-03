import type { MetadataRoute } from "next";

/**
 * Web App Manifest — macht die App auf Android/iOS installierbar und
 * standalone lauffähig (kein Browser-Chrome, App-Store-Feel).
 * Wird von Next.js unter `/manifest.webmanifest` ausgeliefert.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "hAIway",
    short_name: "hAIway",
    description: "AI-Ready Knowledge & Operations Platform",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Blendet nahtlos mit dem App-Hintergrund (Light-Token --color-bg).
    background_color: "#f8fafc",
    theme_color: "#f8fafc",
    lang: "de",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/brand/logo-tile.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/logo.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/logo.png",
        sizes: "500x500",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
