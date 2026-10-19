import type { Metadata, Viewport } from "next";

/** VK Mini App клиники: закрыт от поисковиков, светлая тема, экран смартфона. */
export const metadata: Metadata = {
  title: { absolute: "Демо-Мед — запись к врачу" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#f3f6f9",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function MiniAppLayout({ children }: LayoutProps<"/miniapp">) {
  return children;
}
