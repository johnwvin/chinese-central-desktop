import { useEffect, useState } from "react";
import { Frames } from "./Frames";
import { TabStrip } from "./TabStrip";
import { useShell } from "./useShell";
import { installTabBarShortcut, onTabBarToggle } from "./tabBarShortcut";
import "./shell.css";

/**
 * Chinese Central: a strip of tabs, and the pages open in them.
 *
 * The app is the strip. Each page opens inside a tab.
 */
export function Shell() {
  const shell = useShell();
  const [tabBarVisible, setTabBarVisible] = useState(() => localStorage.getItem("cc-tab-bar-visible") !== "false");

  useEffect(() => {
    installTabBarShortcut(document);
    return onTabBarToggle(() => setTabBarVisible((visible) => !visible));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("cc-tabbar-hidden", !tabBarVisible);
    localStorage.setItem("cc-tab-bar-visible", String(tabBarVisible));
    return () => document.documentElement.classList.remove("cc-tabbar-hidden");
  }, [tabBarVisible]);

  useEffect(() => {
    document.body.classList.add("shell");
    return () => document.body.classList.remove("shell");
  }, []);
  if (!shell.ready) {
    // The strip is drawn empty rather than flashing a wrong set of tabs and
    // then replacing them.
    return <div id="strip" />;
  }

  return (
    <>
      <TabStrip shell={shell} />
      <div className="shell-workspace">
        <Frames shell={shell} />
      </div>
    </>
  );
}
