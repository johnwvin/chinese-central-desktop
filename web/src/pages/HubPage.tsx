import { useEffect, type ReactNode } from "react";
import { installContextMenu } from "./ccmenu";
import { installVolume } from "./volume";
import { installBackToTop } from "./totop";
import "./hub.css";

/**
 * The frame every one of Central's own pages sits in.
 *
 * A hub page carries no navigation: it opens inside a tab, and the strip above
 * it is the navigation. All it does is set the width its kind of page wants.
 *
 * The two library stylesheets these pages are built on are <link>s in
 * index.html rather than anything this does. They were added here once, from
 * an effect, which is after the browser has already painted: the page came up
 * in the app's bare styles and was restyled from top to bottom when they
 * landed. In the head they are fetched before the first paint and the page is
 * drawn once.
 */
export function HubPage({ name, children, scrollRegionId }: {
  name: string;
  children: ReactNode;
  scrollRegionId?: string;
}) {
  useEffect(installContextMenu, []);
  useEffect(installVolume, []);
  useEffect(() => name === "books" ? undefined : installBackToTop(
    scrollRegionId ? document.getElementById(scrollRegionId) ?? undefined : undefined,
  ), [name, scrollRegionId]);
  return <div className={`wrap wrap-${name}`}>{children}</div>;
}

/**
 * Read one of the app's own pages into a tab.
 *
 * Central's pages are opened by the strip, so a link inside a page has to say
 * which tab it means. A plain link would replace the page in this tab, which
 * is what the old pages did and what these keep doing.
 */
export function go(url: string) {
  window.location.href = url;
}
